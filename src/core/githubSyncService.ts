import { copyFile, cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, parse, relative } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { GitHubSyncStatus, HistoryEntry, Lexicon, LexiconTextKind, SyncImportStrategy, UsageAggregate, UsageStatistics } from './types';
import { lexiconPatchFromText, lexiconText, mergeLexicon, normalizeLexicon } from './lexiconTools';

const execFileAsync = promisify(execFile);
const LEXICON_JSON = 'lexicon.json';
const USAGE_SUMMARY = 'stats/usage-summary.json';
const REMOTE_USAGE_SUMMARY = 'stats/remote-usage-summary.json';
const LEXICON_TEXT_FILES: Array<[LexiconTextKind, string]> = [
  ['terms', 'lexicon/terms.txt'],
  ['replacements', 'lexicon/replacements.txt'],
  ['blocked', 'lexicon/blocked.txt']
];

type GitRunner = (args: string[], cwd?: string) => Promise<string>;

interface GitHubSyncServiceOptions {
  dataDir: string;
  repoDir: string;
  branch?: string;
  repoUrl?: string;
  includeHistory?: boolean;
  defaultRepoPath?: string;
  git?: GitRunner;
}

export class GitHubSyncService {
  private readonly dataDir: string;
  private readonly repoDir: string;
  private readonly branch: string;
  private repoUrl?: string;
  private readonly includeHistory: boolean;
  private readonly defaultRepoPath?: string;
  private readonly git: GitRunner;

  constructor(options: GitHubSyncServiceOptions) {
    this.dataDir = options.dataDir;
    this.repoDir = options.repoDir;
    this.branch = options.branch ?? 'main';
    this.repoUrl = options.repoUrl;
    this.includeHistory = options.includeHistory ?? true;
    this.defaultRepoPath = options.defaultRepoPath;
    this.git = options.git ?? runGit;
  }

  async connect(repoUrl: string, importPolicy: SyncImportStrategy = 'none'): Promise<GitHubSyncStatus> {
    validateGitRepoUrl(repoUrl);
    this.repoUrl = repoUrl;

    if (!existsSync(join(this.repoDir, '.git'))) {
      await rm(this.repoDir, { recursive: true, force: true });
      await mkdir(dirname(this.repoDir), { recursive: true });
      await this.git(['clone', repoUrl, this.repoDir]);
      await this.ensureBranch();
    } else {
      await this.git(['remote', 'set-url', 'origin', repoUrl], this.repoDir);
    }

    const remoteFiles = await this.listRepoSyncFiles();
    if (remoteFiles.length > 0) {
      if (importPolicy === 'none') {
        return this.status('远端已有同步文件，请选择导入方式', {
          needsImportDecision: true,
          remoteFiles
        });
      }
      return this.resolveImport(importPolicy);
    }

    await this.exportSyncFiles();
    return this.status();
  }

  async resolveImport(strategy: SyncImportStrategy): Promise<GitHubSyncStatus> {
    await this.ensureRepo();
    if (strategy === 'none') {
      return this.status('远端已有同步文件，请选择导入方式', {
        needsImportDecision: true,
        remoteFiles: await this.listRepoSyncFiles()
      });
    }

    if (strategy === 'remote-over-local') {
      await this.importSyncFiles();
      return this.status('已导入远端同步文件', {
        conflictFiles: await this.listConflictBackups()
      });
    }

    if (strategy === 'local-over-remote') {
      await this.exportSyncFiles();
      await this.git(['add', ...syncFileAllowlist(this.includeHistory), '.gitignore'], this.repoDir);
      if (await this.isDirty()) {
        await this.git(['commit', '-m', 'sync: initialize v2t settings'], this.repoDir);
      }
      try {
        await this.git(['push', '-u', 'origin', this.branch], this.repoDir);
      } catch {
        // Local path and test repos may not have a real remote. Exporting files is still the key action.
      }
      return this.status('已使用本机覆盖远端');
    }

    await this.mergeRepoFilesIntoDataKeepingLocalPrompts();
    await this.exportSyncFiles();
    return this.status('已智能合并同步文件', {
      conflictFiles: await this.listConflictBackups()
    });
  }

  async pull(): Promise<GitHubSyncStatus> {
    await this.ensureRepo();
    await this.git(['pull', '--ff-only', 'origin', this.branch], this.repoDir);
    await this.importSyncFiles();
    return this.status('已拉取同步');
  }

  async push(message = 'sync: update v2t settings'): Promise<GitHubSyncStatus> {
    await this.ensureRepo();
    await this.exportSyncFiles();
    await this.git(['add', ...syncFileAllowlist(this.includeHistory), '.gitignore'], this.repoDir);
    const dirty = await this.isDirty();
    if (dirty) {
      await this.git(['commit', '-m', message], this.repoDir);
    }
    await this.git(['push', '-u', 'origin', this.branch], this.repoDir);
    return this.status('已推送同步');
  }

  async smartSync(message = 'sync: update v2t settings'): Promise<GitHubSyncStatus> {
    await this.ensureRepo();
    const remoteRef = await this.fetchRemoteRef();
    const remoteFiles = remoteRef ? await this.readRemoteSyncFiles(remoteRef) : new Map<string, string>();
    await this.mergeRemoteFilesIntoData(remoteFiles);
    if (remoteRef) {
      await this.git(['reset', '--hard', remoteRef], this.repoDir);
    }
    await this.exportSyncFiles();
    await this.git(['add', ...syncFileAllowlist(this.includeHistory), '.gitignore'], this.repoDir);
    if (await this.isDirty()) {
      await this.git(['commit', '-m', message], this.repoDir);
    }
    await this.git(['push', '-u', 'origin', this.branch], this.repoDir);
    return this.status('已完成一键同步');
  }

  async status(message?: string, patch: Partial<GitHubSyncStatus> = {}): Promise<GitHubSyncStatus> {
    const dirty = existsSync(join(this.repoDir, '.git')) ? await this.isDirty() : false;
    const usageSummaryStatus = await readUsageSummarySyncStatus(this.dataDir);
    return {
      configured: Boolean(this.repoUrl || existsSync(join(this.repoDir, '.git'))),
      repoUrl: this.repoUrl,
      localPath: this.repoDir,
      branch: this.branch,
      dirty,
      message,
      defaultRepoPath: this.defaultRepoPath,
      usingDefaultRepoPath: this.defaultRepoPath ? this.repoDir === this.defaultRepoPath : undefined,
      ...usageSummaryStatus,
      ...patch
    };
  }

  async exportSyncFiles(): Promise<void> {
    await mkdir(this.repoDir, { recursive: true });
    await this.writeRepoIgnore();
    await writeLexiconTextFilesFromJson(this.dataDir);
    await writeUsageSummaryFile(this.dataDir);

    for (const relativePath of syncFileAllowlist(this.includeHistory)) {
      if (relativePath === 'history/') {
        await this.exportHistoryFiles();
        continue;
      }
      const source = join(this.dataDir, relativePath);
      const target = join(this.repoDir, relativePath);
      if (!existsSync(source)) {
        continue;
      }
      await mkdir(dirname(target), { recursive: true });
      if (relativePath === 'settings.json') {
        await writePortableSettings(source, target);
      } else {
        await copyFile(source, target);
      }
    }
  }

  async importSyncFiles(): Promise<void> {
    await this.importLexiconSyncFiles();
    for (const relativePath of syncFileAllowlist(this.includeHistory)) {
      if (relativePath === 'history/') {
        await this.importHistoryFiles();
        continue;
      }
      if (isLexiconSyncPath(relativePath)) {
        continue;
      }
      const source = join(this.repoDir, relativePath);
      const target = join(this.dataDir, relativePath);
      if (!existsSync(source)) {
        continue;
      }

      const incoming = await readFile(source, 'utf8');
      if (relativePath === USAGE_SUMMARY) {
        await importRemoteUsageSummary(this.dataDir, incoming);
        continue;
      }
      await backupIfChanged(target, this.dataDir, incoming);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, incoming, 'utf8');
    }
  }

  async listConflictBackups(): Promise<string[]> {
    const conflictsDir = join(this.dataDir, 'conflicts');
    if (!existsSync(conflictsDir)) {
      return [];
    }
    return readdir(conflictsDir);
  }

  private async ensureRepo(): Promise<void> {
    if (!existsSync(join(this.repoDir, '.git'))) {
      if (!this.repoUrl) {
        throw new Error('尚未连接 GitHub 同步仓库');
      }
      await this.connect(this.repoUrl);
    }
  }

  private async ensureBranch(): Promise<void> {
    try {
      await this.git(['checkout', this.branch], this.repoDir);
    } catch {
      await this.git(['checkout', '-b', this.branch], this.repoDir);
    }
  }

  private async isDirty(): Promise<boolean> {
    const output = await this.git(['status', '--porcelain'], this.repoDir);
    return output.trim().length > 0;
  }

  private async writeRepoIgnore(): Promise<void> {
    const ignored = ['models/', '*.log', '.env', '.env.*'];
    if (!this.includeHistory) {
      ignored.unshift('history/');
    }
    await writeFile(join(this.repoDir, '.gitignore'), [...ignored, ''].join('\n'), 'utf8');
  }

  private async repoHasSyncFiles(): Promise<boolean> {
    return (await this.listRepoSyncFiles()).length > 0;
  }

  private async listRepoSyncFiles(): Promise<string[]> {
    const files: string[] = [];
    for (const relativePath of syncFileAllowlist(this.includeHistory)) {
      if (relativePath === 'history/') {
        if (existsSync(join(this.repoDir, 'history'))) {
          files.push(relativePath);
        }
        continue;
      }
      if (existsSync(join(this.repoDir, relativePath))) {
        files.push(relativePath);
      }
    }
    return files;
  }

  private async importLexiconSyncFiles(): Promise<void> {
    const files = await this.readRepoLexiconFiles();
    const incoming = lexiconFromSyncFiles(files);
    if (!incoming) {
      return;
    }

    await writeLexiconBundleReplacingLocal(this.dataDir, incoming);
  }

  private async exportHistoryFiles(): Promise<void> {
    const source = join(this.dataDir, 'history');
    const target = join(this.repoDir, 'history');
    await rm(target, { recursive: true, force: true });
    if (existsSync(source)) {
      await cp(source, target, { recursive: true, force: true });
    }
  }

  private async importHistoryFiles(): Promise<void> {
    const repoHistory = join(this.repoDir, 'history');
    if (!existsSync(repoHistory)) {
      return;
    }
    const files = await listFiles(repoHistory);
    for (const file of files.filter((item) => item.endsWith('.jsonl'))) {
      const relativePath = relative(this.repoDir, file);
      await mergeHistoryFile(join(this.dataDir, relativePath), await readFile(file, 'utf8'));
    }
  }

  private async fetchRemoteRef(): Promise<string | undefined> {
    try {
      await this.git(['fetch', 'origin', this.branch], this.repoDir);
      await this.git(['rev-parse', '--verify', `origin/${this.branch}`], this.repoDir);
      return `origin/${this.branch}`;
    } catch {
      return undefined;
    }
  }

  private async readRemoteSyncFiles(remoteRef: string): Promise<Map<string, string>> {
    const files = new Map<string, string>();
    for (const relativePath of syncFileAllowlist(false)) {
      try {
        files.set(relativePath, await this.git(['show', `${remoteRef}:${relativePath}`], this.repoDir));
      } catch {
        // Remote may not have every optional file yet.
      }
    }
    if (this.includeHistory) {
      try {
        const historyFiles = (await this.git(['ls-tree', '-r', '--name-only', remoteRef, 'history'], this.repoDir))
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line.endsWith('.jsonl'));
        for (const file of historyFiles) {
          files.set(file, await this.git(['show', `${remoteRef}:${file}`], this.repoDir));
        }
      } catch {
        // No remote history yet.
      }
    }
    return files;
  }

  private async mergeRemoteFilesIntoData(remoteFiles: Map<string, string>): Promise<void> {
    await mergeLexiconBundleIntoData(this.dataDir, remoteFiles);
    for (const [relativePath, incoming] of remoteFiles) {
      if (isLexiconSyncPath(relativePath)) {
        continue;
      }
      if (relativePath === USAGE_SUMMARY) {
        await importRemoteUsageSummary(this.dataDir, incoming);
        continue;
      }

      if (relativePath.startsWith('history/')) {
        await mergeHistoryFile(join(this.dataDir, relativePath), incoming);
        continue;
      }

      const target = join(this.dataDir, relativePath);
      if (!existsSync(target)) {
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, incoming, 'utf8');
        continue;
      }

      const current = await readFile(target, 'utf8');
      if (current !== incoming) {
        await writeConflictBackup(relativePath, this.dataDir, incoming, 'remote');
      }
    }
  }

  private async mergeRepoFilesIntoDataKeepingLocalPrompts(): Promise<void> {
    const files = await this.readRepoSyncFiles();
    await mergeLexiconBundleIntoData(this.dataDir, files);
    for (const [relativePath, incoming] of files) {
      if (isLexiconSyncPath(relativePath)) {
        continue;
      }
      if (relativePath === USAGE_SUMMARY) {
        await importRemoteUsageSummary(this.dataDir, incoming);
        continue;
      }
      if (relativePath.startsWith('prompts/')) {
        const target = join(this.dataDir, relativePath);
        if (!existsSync(target) || (await readFile(target, 'utf8')) !== incoming) {
          await writeConflictBackup(relativePath, this.dataDir, incoming, 'remote');
        }
        continue;
      }

      if (relativePath.startsWith('history/')) {
        await mergeHistoryFile(join(this.dataDir, relativePath), incoming);
        continue;
      }

      const target = join(this.dataDir, relativePath);
      if (!existsSync(target)) {
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, incoming, 'utf8');
      }
    }
  }

  private async readRepoSyncFiles(): Promise<Map<string, string>> {
    const files = new Map<string, string>();
    for (const relativePath of syncFileAllowlist(false)) {
      const source = join(this.repoDir, relativePath);
      if (existsSync(source)) {
        files.set(relativePath, await readFile(source, 'utf8'));
      }
    }
    if (this.includeHistory && existsSync(join(this.repoDir, 'history'))) {
      for (const file of await listFiles(join(this.repoDir, 'history'))) {
        if (file.endsWith('.jsonl')) {
          files.set(relative(this.repoDir, file), await readFile(file, 'utf8'));
        }
      }
    }
    return files;
  }

  private async readRepoLexiconFiles(): Promise<Map<string, string>> {
    const files = new Map<string, string>();
    for (const relativePath of lexiconSyncPaths()) {
      const source = join(this.repoDir, relativePath);
      if (existsSync(source)) {
        files.set(relativePath, await readFile(source, 'utf8'));
      }
    }
    return files;
  }
}

export function syncFileAllowlist(includeHistory = true): string[] {
  const files = ['settings.json', LEXICON_JSON, ...LEXICON_TEXT_FILES.map(([, path]) => path), 'prompts/natural.md', 'prompts/structured.md', USAGE_SUMMARY];
  return includeHistory ? [...files, 'history/'] : files;
}

export function validateGitRepoUrl(repoUrl: string): void {
  const trimmed = repoUrl.trim();
  if (!trimmed) {
    throw new Error('请填写 GitHub 仓库 URL');
  }

  const isSsh = /^git@github\.com:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\.git$/.test(trimmed);
  const isHttps = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/.test(trimmed);
  const isLocalPath = trimmed.startsWith('/') || trimmed.startsWith('file://');

  if (!isSsh && !isHttps && !isLocalPath) {
    throw new Error('GitHub 仓库 URL 格式不正确');
  }
}

async function writePortableSettings(source: string, target: string): Promise<void> {
  const settings = JSON.parse(await readFile(source, 'utf8')) as {
    dataDir?: string;
    sync?: {
      github?: {
        localPath?: string;
        lastSyncAt?: string;
      };
    };
  };
  delete settings.dataDir;
  delete settings.sync?.github?.localPath;
  delete settings.sync?.github?.lastSyncAt;
  await writeFile(target, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
}

async function backupIfChanged(filePath: string, dataDir: string, incoming: string): Promise<void> {
  if (!existsSync(filePath)) {
    return;
  }

  const current = await readFile(filePath, 'utf8');
  if (current === incoming) {
    return;
  }

  await writeConflictBackup(filePath, dataDir, current, 'conflict');
}

async function writeLexiconTextFilesFromJson(dataDir: string): Promise<void> {
  const lexiconPath = join(dataDir, LEXICON_JSON);
  if (!existsSync(lexiconPath)) {
    return;
  }

  const lexicon = normalizeLexicon(JSON.parse(await readFile(lexiconPath, 'utf8')) as Lexicon);
  await writeLexiconBundleFiles(dataDir, lexicon);
}

async function writeLexiconBundleReplacingLocal(dataDir: string, incoming: Lexicon): Promise<void> {
  const normalized = normalizeLexicon(incoming);
  const target = join(dataDir, LEXICON_JSON);
  const serialized = `${JSON.stringify(normalized, null, 2)}\n`;
  await backupIfChanged(target, dataDir, serialized);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, serialized, 'utf8');
  await writeLexiconBundleFiles(dataDir, normalized);
}

async function mergeLexiconBundleIntoData(dataDir: string, files: Map<string, string>): Promise<void> {
  const incoming = lexiconFromSyncFiles(files);
  if (!incoming) {
    return;
  }

  const target = join(dataDir, LEXICON_JSON);
  const local = existsSync(target) ? normalizeLexicon(JSON.parse(await readFile(target, 'utf8')) as Lexicon) : emptyLexicon();
  const merged = normalizeLexicon(mergeLexicon(local, incoming));
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
  await writeLexiconBundleFiles(dataDir, merged);
}

async function writeLexiconBundleFiles(dataDir: string, lexicon: Lexicon): Promise<void> {
  await Promise.all(
    LEXICON_TEXT_FILES.map(async ([kind, relativePath]) => {
      const target = join(dataDir, relativePath);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, lexiconText(kind, lexicon), 'utf8');
    })
  );
}

function lexiconFromSyncFiles(files: Map<string, string>): Lexicon | undefined {
  if (!lexiconSyncPaths().some((relativePath) => files.has(relativePath))) {
    return undefined;
  }

  let lexicon = files.has(LEXICON_JSON) ? normalizeLexicon(JSON.parse(files.get(LEXICON_JSON) ?? '{}') as Lexicon) : emptyLexicon();
  for (const [kind, relativePath] of LEXICON_TEXT_FILES) {
    const content = files.get(relativePath);
    if (content !== undefined) {
      lexicon = mergeLexicon(lexicon, lexiconPatchFromText(kind, content));
    }
  }
  return normalizeLexicon(lexicon);
}

function emptyLexicon(): Lexicon {
  return { version: 1, terms: [], replacements: [], blocked: [] };
}

function lexiconSyncPaths(): string[] {
  return [LEXICON_JSON, ...LEXICON_TEXT_FILES.map(([, relativePath]) => relativePath)];
}

function isLexiconSyncPath(relativePath: string): boolean {
  return relativePath === LEXICON_JSON || LEXICON_TEXT_FILES.some(([, path]) => path === relativePath);
}

async function mergeHistoryFile(filePath: string, incoming: string): Promise<void> {
  const local = existsSync(filePath) ? await readFile(filePath, 'utf8') : '';
  const records = new Map<string, string>();
  for (const line of [...incoming.split('\n'), ...local.split('\n')].map((item) => item.trim()).filter(Boolean)) {
    records.set(historyLineId(line), line);
  }
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${[...records.values()].join('\n')}\n`, 'utf8');
}

function historyLineId(line: string): string {
  try {
    const parsed = JSON.parse(line) as { id?: string };
    return parsed.id ?? line;
  } catch {
    return line;
  }
}

async function listFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(fullPath)));
    } else {
      files.push(fullPath);
    }
  }
  return files;
}

async function writeUsageSummaryFile(dataDir: string): Promise<void> {
  const summary = await buildUsageSummary(dataDir);
  const target = join(dataDir, USAGE_SUMMARY);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
}

async function importRemoteUsageSummary(dataDir: string, incoming: string): Promise<void> {
  const parsed = JSON.parse(incoming) as UsageStatistics & { generatedAt?: string; source?: string; sourceDeviceIds?: string[] };
  const target = join(dataDir, REMOTE_USAGE_SUMMARY);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(
    target,
    `${JSON.stringify(
      {
        ...parsed,
        importedAt: new Date().toISOString(),
        source: parsed.source ?? 'v2t-remote-summary'
      },
      null,
      2
    )}\n`,
    'utf8'
  );
}

async function readUsageSummarySyncStatus(dataDir: string): Promise<Pick<GitHubSyncStatus, 'statsLocalGeneratedAt' | 'statsRemoteImportedAt' | 'statsDeviceCount'>> {
  const local = await readOptionalJson<UsageStatistics & { generatedAt?: string; sourceDeviceIds?: string[] }>(join(dataDir, USAGE_SUMMARY));
  const remote = await readOptionalJson<UsageStatistics & { importedAt?: string; sourceDeviceIds?: string[] }>(join(dataDir, REMOTE_USAGE_SUMMARY));
  const deviceIds = new Set<string>();
  for (const id of local?.sourceDeviceIds ?? []) {
    deviceIds.add(id);
  }
  for (const id of remote?.sourceDeviceIds ?? []) {
    deviceIds.add(id);
  }
  return {
    statsLocalGeneratedAt: local?.generatedAt,
    statsRemoteImportedAt: remote?.importedAt,
    statsDeviceCount: deviceIds.size || undefined
  };
}

async function readOptionalJson<T>(filePath: string): Promise<T | undefined> {
  if (!existsSync(filePath)) {
    return undefined;
  }
  try {
    return JSON.parse(await readFile(filePath, 'utf8')) as T;
  } catch {
    return undefined;
  }
}

async function buildUsageSummary(dataDir: string, days = 30): Promise<UsageStatistics & { generatedAt: string; source: string; sourceDeviceIds: string[] }> {
  const cutoff = Date.now() - Math.max(1, days) * 24 * 60 * 60 * 1000;
  const entries = (await readAllHistoryEntries(join(dataDir, 'history'))).filter((entry) => Date.parse(entry.createdAt) >= cutoff);
  const sourceDeviceIds = [...new Set(entries.map((entry) => entry.sourceDeviceId).filter((value): value is string => Boolean(value)))].sort();
  const totals = createUsageAccumulator('total', '全部输入');
  const byAsr = new Map<string, UsageAccumulator>();
  const byPostProcessor = new Map<string, UsageAccumulator>();

  for (const entry of entries) {
    addHistoryEntry(totals, entry);
    const asrKey = entry.asrModelId ?? entry.asrProviderKind ?? 'legacy-unrecorded-asr';
    const asrLabel = entry.asrModelName ?? entry.asrModelId ?? entry.asrProviderKind ?? '旧记录：未记录模型';
    addHistoryEntry(getUsageAccumulator(byAsr, asrKey, asrLabel), entry);

    const processorKey = entry.postProcessorEngine ?? 'local-rules';
    addHistoryEntry(getUsageAccumulator(byPostProcessor, processorKey, postProcessorLabel(processorKey)), entry);
  }

  return {
    generatedAt: new Date().toISOString(),
    source: 'v2t-local-history',
    sourceDeviceIds,
    localDeviceCount: sourceDeviceIds.length,
    days,
    totalCount: totals.count,
    totalAudioSeconds: roundUsage(totals.audioDurationSeconds),
    totalOutputChars: totals.outputCharCount,
    averageTotalMs: averageUsage(totals.totalMs, totals.totalMsCount),
    averageAsrMs: averageUsage(totals.asrMs, totals.asrMsCount),
    averagePostProcessMs: averageUsage(totals.postProcessMs, totals.postProcessMsCount),
    asrModels: [...byAsr.values()].map(toUsageAggregate).sort(sortUsageAggregate),
    postProcessors: [...byPostProcessor.values()].map(toUsageAggregate).sort(sortUsageAggregate)
  };
}

async function readAllHistoryEntries(historyRoot: string): Promise<HistoryEntry[]> {
  if (!existsSync(historyRoot)) {
    return [];
  }
  const entries: HistoryEntry[] = [];
  for (const file of (await listFiles(historyRoot)).filter((item) => item.endsWith('.jsonl'))) {
    const content = await readFile(file, 'utf8');
    const sourceDeviceId = relative(historyRoot, file).split(/[\\/]/)[0];
    for (const line of content.split('\n').map((item) => item.trim().replace(/\\n$/, '')).filter(Boolean)) {
      try {
        const parsed = JSON.parse(line) as HistoryEntry;
        entries.push({ ...parsed, sourceDeviceId: parsed.sourceDeviceId ?? sourceDeviceId });
      } catch {
        // Ignore malformed historical lines instead of blocking sync.
      }
    }
  }
  return entries;
}

interface UsageAccumulator {
  key: string;
  label: string;
  count: number;
  audioDurationSeconds: number;
  outputCharCount: number;
  totalMs: number;
  totalMsCount: number;
  asrMs: number;
  asrMsCount: number;
  postProcessMs: number;
  postProcessMsCount: number;
  lastUsedAt?: string;
}

function createUsageAccumulator(key: string, label: string): UsageAccumulator {
  return {
    key,
    label,
    count: 0,
    audioDurationSeconds: 0,
    outputCharCount: 0,
    totalMs: 0,
    totalMsCount: 0,
    asrMs: 0,
    asrMsCount: 0,
    postProcessMs: 0,
    postProcessMsCount: 0
  };
}

function getUsageAccumulator(map: Map<string, UsageAccumulator>, key: string, label: string): UsageAccumulator {
  const existing = map.get(key);
  if (existing) {
    return existing;
  }
  const next = createUsageAccumulator(key, label);
  map.set(key, next);
  return next;
}

function addHistoryEntry(accumulator: UsageAccumulator, entry: HistoryEntry): void {
  accumulator.count += 1;
  accumulator.audioDurationSeconds += entry.audioDurationSeconds ?? 0;
  accumulator.outputCharCount += entry.outputCharCount ?? [...(entry.outputText ?? '').replace(/\s+/g, '')].length;
  if (typeof entry.totalDurationMs === 'number') {
    accumulator.totalMs += entry.totalDurationMs;
    accumulator.totalMsCount += 1;
  }
  if (typeof entry.asrDurationMs === 'number') {
    accumulator.asrMs += entry.asrDurationMs;
    accumulator.asrMsCount += 1;
  }
  if (typeof entry.postProcessDurationMs === 'number') {
    accumulator.postProcessMs += entry.postProcessDurationMs;
    accumulator.postProcessMsCount += 1;
  }
  if (!accumulator.lastUsedAt || entry.createdAt > accumulator.lastUsedAt) {
    accumulator.lastUsedAt = entry.createdAt;
  }
}

function toUsageAggregate(accumulator: UsageAccumulator): UsageAggregate {
  return {
    key: accumulator.key,
    label: accumulator.label,
    count: accumulator.count,
    audioDurationSeconds: roundUsage(accumulator.audioDurationSeconds),
    outputCharCount: accumulator.outputCharCount,
    averageTotalMs: averageUsage(accumulator.totalMs, accumulator.totalMsCount),
    averageAsrMs: averageUsage(accumulator.asrMs, accumulator.asrMsCount),
    averagePostProcessMs: averageUsage(accumulator.postProcessMs, accumulator.postProcessMsCount),
    averageRealTimeFactor:
      accumulator.audioDurationSeconds > 0 && accumulator.asrMs > 0 ? roundUsage(accumulator.audioDurationSeconds / (accumulator.asrMs / 1000)) : undefined,
    lastUsedAt: accumulator.lastUsedAt
  };
}

function sortUsageAggregate(left: UsageAggregate, right: UsageAggregate): number {
  return right.count - left.count || (right.lastUsedAt ?? '').localeCompare(left.lastUsedAt ?? '');
}

function averageUsage(total: number, count: number): number | undefined {
  return count > 0 ? Math.round(total / count) : undefined;
}

function roundUsage(value: number): number {
  return Math.round(value * 100) / 100;
}

function postProcessorLabel(engine: string): string {
  if (engine === 'llm-local') {
    return '本地 LLM';
  }
  if (engine === 'llm-cloud') {
    return '云端 LLM';
  }
  if (engine === 'llm-fallback') {
    return '云端兜底';
  }
  return '本地规则';
}

async function writeConflictBackup(filePath: string, dataDir: string, content: string, kind: 'conflict' | 'remote'): Promise<void> {
  const parsed = parse(filePath);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const conflictsDir = join(dataDir, 'conflicts');
  await mkdir(conflictsDir, { recursive: true });
  await writeFile(join(conflictsDir, `${parsed.name}.${stamp}.${kind}${parsed.ext}`), content, 'utf8');
}

async function runGit(args: string[], cwd?: string): Promise<string> {
  const { stdout } = await execFileAsync('git', args, cwd ? { cwd } : undefined);
  return String(stdout);
}
