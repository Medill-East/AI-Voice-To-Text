import { copyFile, cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, parse, relative } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { GitHubSyncStatus, Lexicon } from './types';

const execFileAsync = promisify(execFile);

type GitRunner = (args: string[], cwd?: string) => Promise<string>;

interface GitHubSyncServiceOptions {
  dataDir: string;
  repoDir: string;
  branch?: string;
  repoUrl?: string;
  includeHistory?: boolean;
  git?: GitRunner;
}

export class GitHubSyncService {
  private readonly dataDir: string;
  private readonly repoDir: string;
  private readonly branch: string;
  private repoUrl?: string;
  private readonly includeHistory: boolean;
  private readonly git: GitRunner;

  constructor(options: GitHubSyncServiceOptions) {
    this.dataDir = options.dataDir;
    this.repoDir = options.repoDir;
    this.branch = options.branch ?? 'main';
    this.repoUrl = options.repoUrl;
    this.includeHistory = options.includeHistory ?? false;
    this.git = options.git ?? runGit;
  }

  async connect(repoUrl: string): Promise<GitHubSyncStatus> {
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

    if (await this.repoHasSyncFiles()) {
      await this.importSyncFiles();
    } else {
      await this.exportSyncFiles();
    }
    return this.status();
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

  async status(message?: string): Promise<GitHubSyncStatus> {
    const dirty = existsSync(join(this.repoDir, '.git')) ? await this.isDirty() : false;
    return {
      configured: Boolean(this.repoUrl || existsSync(join(this.repoDir, '.git'))),
      repoUrl: this.repoUrl,
      localPath: this.repoDir,
      branch: this.branch,
      dirty,
      message
    };
  }

  async exportSyncFiles(): Promise<void> {
    await mkdir(this.repoDir, { recursive: true });
    await this.writeRepoIgnore();

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
    for (const relativePath of syncFileAllowlist(this.includeHistory)) {
      if (relativePath === 'history/') {
        await this.importHistoryFiles();
        continue;
      }
      const source = join(this.repoDir, relativePath);
      const target = join(this.dataDir, relativePath);
      if (!existsSync(source)) {
        continue;
      }

      const incoming = await readFile(source, 'utf8');
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
    return syncFileAllowlist(this.includeHistory).some((relativePath) => existsSync(join(this.repoDir, relativePath)));
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
    for (const [relativePath, incoming] of remoteFiles) {
      if (relativePath === 'lexicon.json') {
        await mergeLexiconFile(join(this.dataDir, relativePath), incoming);
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
}

export function syncFileAllowlist(includeHistory = false): string[] {
  const files = ['settings.json', 'lexicon.json', 'prompts/natural.md', 'prompts/structured.md'];
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

async function mergeLexiconFile(filePath: string, incoming: string): Promise<void> {
  const remote = JSON.parse(incoming) as Lexicon;
  if (!existsSync(filePath)) {
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify(remote, null, 2)}\n`, 'utf8');
    return;
  }
  const local = JSON.parse(await readFile(filePath, 'utf8')) as Lexicon;
  const merged: Lexicon = {
    version: Math.max(local.version ?? 1, remote.version ?? 1),
    terms: mergeTerms(local.terms, remote.terms),
    replacements: mergeReplacements(local.replacements, remote.replacements),
    blocked: uniqueStrings([...local.blocked, ...remote.blocked])
  };
  await writeFile(filePath, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
}

function mergeTerms(local: Lexicon['terms'], remote: Lexicon['terms']): Lexicon['terms'] {
  const byPhrase = new Map<string, Lexicon['terms'][number]>();
  for (const term of [...remote, ...local]) {
    const current = byPhrase.get(term.phrase);
    byPhrase.set(term.phrase, {
      ...current,
      ...term,
      aliases: uniqueStrings([...(current?.aliases ?? []), ...(term.aliases ?? [])])
    });
  }
  return [...byPhrase.values()];
}

function mergeReplacements(local: Lexicon['replacements'], remote: Lexicon['replacements']): Lexicon['replacements'] {
  const rules = new Map<string, Lexicon['replacements'][number]>();
  for (const rule of [...remote, ...local]) {
    rules.set(`${rule.from}\u0000${rule.to}`, { ...rules.get(`${rule.from}\u0000${rule.to}`), ...rule });
  }
  return [...rules.values()];
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

async function writeConflictBackup(filePath: string, dataDir: string, content: string, kind: 'conflict' | 'remote'): Promise<void> {
  const parsed = parse(filePath);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const conflictsDir = join(dataDir, 'conflicts');
  await mkdir(conflictsDir, { recursive: true });
  await writeFile(join(conflictsDir, `${parsed.name}.${stamp}.${kind}${parsed.ext}`), content, 'utf8');
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

async function runGit(args: string[], cwd?: string): Promise<string> {
  const { stdout } = await execFileAsync('git', args, cwd ? { cwd } : undefined);
  return String(stdout);
}
