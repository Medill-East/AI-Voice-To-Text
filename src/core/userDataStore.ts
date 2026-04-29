import { copyFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, parse } from 'node:path';
import type { HistoryEntry, InputMode, Lexicon, LexiconTextFiles, LexiconTextKind, PromptFiles, Settings, UsageAggregate, UsageStatistics } from './types';
import { lexiconPatchFromText, lexiconText, normalizeLexicon } from './lexiconTools';
import { naturalPrompt, structuredPrompt } from './postProcessor';

interface StoreOptions {
  deviceId: string;
}

type JsonFile = 'settings.json' | 'lexicon.json';
type SyncedUsageSummary = UsageStatistics & {
  generatedAt?: string;
  importedAt?: string;
  source?: string;
  sourceDeviceIds?: string[];
};

const DEFAULT_SETTINGS: Settings = {
  schemaVersion: 1,
  defaultMode: 'natural',
  appearance: {
    theme: 'system'
  },
  recording: {
    muteSystemAudio: false,
    maxDurationMinutes: 10
  },
  paths: {},
  startup: {
    openAtLogin: false,
    silentOpenAtLogin: true
  },
  hotkey: {
    accelerator: 'CommandOrControl+Shift+Space',
    longPressMs: 350,
    fallbackAccelerator: 'CommandOrControl+Alt+Space',
    singleClickMode: 'natural',
    doubleClickMode: 'structured'
  },
  providers: {
    asr: {
      kind: 'local-sherpa-onnx',
      language: 'zh'
    },
    llm: {
      engine: 'off',
      enabled: false,
      kind: 'openai-compatible',
      baseUrl: 'http://127.0.0.1:11434/v1',
      model: 'qwen2.5:7b',
      apiKeyRef: 'system-keychain:v2t/openai-compatible',
      fastMode: true,
      timeoutMs: 30000,
      fallback: {
        enabled: false,
        baseUrl: '',
        model: '',
        apiKeyRef: 'system-keychain:v2t/openai-compatible-fallback',
        timeoutMs: 30000
      }
    }
  },
  sync: {
    kind: 'local-folder',
    github: {
      branch: 'main',
      includeHistory: true,
      autoSync: false
    }
  },
  updates: {
    autoCheck: true,
    autoDownload: true
  }
};

const DEFAULT_LEXICON: Lexicon = {
  version: 1,
  terms: [],
  replacements: [],
  blocked: []
};

export class UserDataStore {
  private readonly baseDir: string;
  private readonly deviceId: string;
  private readonly knownMtimes = new Map<string, number>();

  private constructor(baseDir: string, options: StoreOptions) {
    this.baseDir = baseDir;
    this.deviceId = options.deviceId;
  }

  static async create(baseDir: string, options: StoreOptions): Promise<UserDataStore> {
    const store = new UserDataStore(baseDir, options);
    await store.ensureDefaults();
    return store;
  }

  async loadSettings(): Promise<Settings> {
    return normalizeSettings(await this.readJsonTracked<Partial<Settings>>('settings.json'));
  }

  async saveSettings(settings: Settings): Promise<void> {
    await this.writeJsonTracked('settings.json', settings);
  }

  async loadLexicon(): Promise<Lexicon> {
    return normalizeLexicon(await this.readJsonTracked<Lexicon>('lexicon.json'));
  }

  async saveLexicon(lexicon: Lexicon): Promise<void> {
    const normalized = normalizeLexicon(lexicon);
    await this.writeJsonTracked('lexicon.json', normalized);
    await this.writeLexiconTextFiles(normalized);
  }

  getLexiconTextPaths(): Record<LexiconTextKind, string> {
    return {
      terms: this.lexiconTextPath('terms'),
      replacements: this.lexiconTextPath('replacements'),
      blocked: this.lexiconTextPath('blocked')
    };
  }

  async readLexiconTextFiles(): Promise<LexiconTextFiles> {
    return {
      terms: await this.readLexiconTextFile('terms'),
      replacements: await this.readLexiconTextFile('replacements'),
      blocked: await this.readLexiconTextFile('blocked')
    };
  }

  async saveLexiconTextFiles(files: LexiconTextFiles): Promise<{ lexicon: Lexicon; files: LexiconTextFiles }> {
    await Promise.all(
      (['terms', 'replacements', 'blocked'] as const).map((kind) => this.writeTextTracked(this.lexiconTextPath(kind), files[kind]?.content ?? ''))
    );
    const lexicon = await this.importLexiconTextFiles();
    return { lexicon, files: await this.readLexiconTextFiles() };
  }

  async importLexiconTextFiles(): Promise<Lexicon> {
    const patches = await Promise.all(
      (['terms', 'replacements', 'blocked'] as const).map(async (kind) => {
        const filePath = this.lexiconTextPath(kind);
        if (!existsSync(filePath)) {
          return {};
        }
        return lexiconPatchFromText(kind, await readFile(filePath, 'utf8'));
      })
    );
    const next = normalizeLexicon({
      version: 1,
      terms: patches.flatMap((patch) => patch.terms ?? []),
      replacements: patches.flatMap((patch) => patch.replacements ?? []),
      blocked: patches.flatMap((patch) => patch.blocked ?? [])
    });
    await this.writeJsonTracked('lexicon.json', next);
    await this.writeLexiconTextFiles(next);
    return next;
  }

  async readPrompt(mode: InputMode): Promise<string> {
    return this.readTextTracked(this.promptPath(mode));
  }

  async savePrompt(mode: InputMode, content: string): Promise<void> {
    await this.writeTextTracked(this.promptPath(mode), content.endsWith('\n') ? content : `${content}\n`);
  }

  async resetPrompt(mode: InputMode): Promise<void> {
    await this.savePrompt(mode, defaultPrompt(mode));
  }

  async loadPrompts(): Promise<PromptFiles> {
    const paths = this.getPromptPaths();
    return {
      natural: await this.readPrompt('natural'),
      structured: await this.readPrompt('structured'),
      paths
    };
  }

  getPromptPaths(): PromptFiles['paths'] {
    return {
      natural: this.promptPath('natural'),
      structured: this.promptPath('structured')
    };
  }

  async appendHistory(entry: HistoryEntry): Promise<void> {
    const month = entry.createdAt.slice(0, 7);
    const historyPath = join(this.baseDir, 'history', this.deviceId, `${month}.jsonl`);
    await mkdir(dirname(historyPath), { recursive: true });
    const line = `${JSON.stringify(entry)}\n`;
    await writeFile(historyPath, line, { encoding: 'utf8', flag: 'a' });
  }

  async readHistoryMonth(deviceId: string, month: string): Promise<HistoryEntry[]> {
    const historyPath = join(this.baseDir, 'history', deviceId, `${month}.jsonl`);
    if (!existsSync(historyPath)) {
      return [];
    }

    const content = await readFile(historyPath, 'utf8');
    return content
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => withSourceDevice(JSON.parse(line) as HistoryEntry, deviceId));
  }

  async readRecentHistory(limit = 30): Promise<HistoryEntry[]> {
    const entries: HistoryEntry[] = [];

    for (const deviceId of await this.listHistoryDeviceIds()) {
      const historyDir = join(this.baseDir, 'history', deviceId);
      const files = (await readdir(historyDir))
        .filter((file) => /^\d{4}-\d{2}\.jsonl$/.test(file))
        .sort()
        .reverse();

      for (const file of files) {
        const content = await readFile(join(historyDir, file), 'utf8');
        entries.push(
          ...content
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean)
            .map((line) => withSourceDevice(JSON.parse(line) as HistoryEntry, deviceId))
        );
      }
    }

    return entries.sort((left, right) => right.createdAt.localeCompare(left.createdAt)).slice(0, limit);
  }

  async readUsageStatistics(days = 30): Promise<UsageStatistics> {
    const cutoff = Date.now() - Math.max(1, days) * 24 * 60 * 60 * 1000;
    const entries = (await this.readAllDeviceHistory()).filter((entry) => Date.parse(entry.createdAt) >= cutoff);
    const totals = createAggregate('total', '全部输入');
    const byAsr = new Map<string, UsageAccumulator>();
    const byPostProcessor = new Map<string, UsageAccumulator>();
    const localDeviceIds = new Set<string>();

    for (const entry of entries) {
      if (entry.sourceDeviceId) {
        localDeviceIds.add(entry.sourceDeviceId);
      }
      addEntry(totals, entry);
      const asrKey = entry.asrModelId ?? entry.asrProviderKind ?? 'legacy-unrecorded-asr';
      const asrLabel = entry.asrModelName ?? entry.asrModelId ?? entry.asrProviderKind ?? '旧记录：未记录模型';
      addEntry(getAccumulator(byAsr, asrKey, asrLabel), entry);
      const processorKey = entry.postProcessorEngine ?? 'local-rules';
      addEntry(getAccumulator(byPostProcessor, processorKey, postProcessorLabel(processorKey)), entry);
    }

    const remoteSummary = await this.readRemoteUsageSummary();
    const includeRemoteSummary = shouldIncludeRemoteUsageSummary(remoteSummary, days, localDeviceIds, totals.count);
    if (remoteSummary && includeRemoteSummary) {
      addUsageSummary(totals, remoteSummary);
      for (const row of remoteSummary.asrModels ?? []) {
        addUsageAggregate(getAccumulator(byAsr, row.key, row.label), row);
      }
      for (const row of remoteSummary.postProcessors ?? []) {
        addUsageAggregate(getAccumulator(byPostProcessor, row.key, row.label), row);
      }
    }

    const sourceDeviceIds = new Set(localDeviceIds);
    if (includeRemoteSummary) {
      for (const deviceId of remoteSummary?.sourceDeviceIds ?? []) {
        sourceDeviceIds.add(deviceId);
      }
    }

    return {
      days,
      totalCount: totals.count,
      totalAudioSeconds: round(totals.audioDurationSeconds),
      totalOutputChars: totals.outputCharCount,
      averageTotalMs: average(totals.totalMs, totals.totalMsCount),
      averageAsrMs: average(totals.asrMs, totals.asrMsCount),
      averagePostProcessMs: average(totals.postProcessMs, totals.postProcessMsCount),
      asrModels: [...byAsr.values()].map(toUsageAggregate).sort(sortUsageAggregate),
      postProcessors: [...byPostProcessor.values()].map(toUsageAggregate).sort(sortUsageAggregate),
      sourceDeviceIds: [...sourceDeviceIds].sort(),
      localDeviceCount: localDeviceIds.size,
      remoteGeneratedAt: remoteSummary?.generatedAt,
      remoteImportedAt: remoteSummary?.importedAt,
      remoteDeviceCount: remoteSummary?.sourceDeviceIds?.length,
      remoteSummaryIncluded: includeRemoteSummary
    };
  }

  async listConflicts(): Promise<string[]> {
    const conflictsDir = join(this.baseDir, 'conflicts');
    if (!existsSync(conflictsDir)) {
      return [];
    }

    return readdir(conflictsDir);
  }

  private async readAllDeviceHistory(): Promise<HistoryEntry[]> {
    const entries: HistoryEntry[] = [];
    for (const deviceId of await this.listHistoryDeviceIds()) {
      const historyDir = join(this.baseDir, 'history', deviceId);
      const files = (await readdir(historyDir)).filter((file) => /^\d{4}-\d{2}\.jsonl$/.test(file)).sort();
      for (const file of files) {
        const content = await readFile(join(historyDir, file), 'utf8');
        entries.push(
          ...content
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean)
            .map((line) => withSourceDevice(JSON.parse(line) as HistoryEntry, deviceId))
        );
      }
    }
    return entries;
  }

  private async listHistoryDeviceIds(): Promise<string[]> {
    const historyRoot = join(this.baseDir, 'history');
    if (!existsSync(historyRoot)) {
      return [];
    }

    const entries = await readdir(historyRoot, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((left, right) => (left === this.deviceId ? -1 : right === this.deviceId ? 1 : left.localeCompare(right)));
  }

  private async readRemoteUsageSummary(): Promise<SyncedUsageSummary | undefined> {
    const filePath = join(this.baseDir, 'stats', 'remote-usage-summary.json');
    if (!existsSync(filePath)) {
      return undefined;
    }
    try {
      return JSON.parse(await readFile(filePath, 'utf8')) as SyncedUsageSummary;
    } catch {
      return undefined;
    }
  }

  getBaseDir(): string {
    return this.baseDir;
  }

  private async ensureDefaults(): Promise<void> {
    await mkdir(this.baseDir, { recursive: true });
    await mkdir(join(this.baseDir, 'prompts'), { recursive: true });
    await mkdir(join(this.baseDir, 'lexicon'), { recursive: true });
    await mkdir(join(this.baseDir, 'history', this.deviceId), { recursive: true });
    await mkdir(join(this.baseDir, 'conflicts'), { recursive: true });
    await mkdir(join(this.baseDir, 'stats'), { recursive: true });

    await this.ensureFile('settings.json', DEFAULT_SETTINGS);
    await this.ensureFile('lexicon.json', DEFAULT_LEXICON);
    await this.ensureTextFile(this.lexiconTextPath('terms'), '');
    await this.ensureTextFile(this.lexiconTextPath('replacements'), '');
    await this.ensureTextFile(this.lexiconTextPath('blocked'), '');
    await this.ensureTextFile(join(this.baseDir, 'prompts', 'natural.md'), `${naturalPrompt()}\n`);
    await this.ensureTextFile(join(this.baseDir, 'prompts', 'structured.md'), `${structuredPrompt()}\n`);
  }

  private async ensureFile<T>(fileName: JsonFile, value: T): Promise<void> {
    const filePath = join(this.baseDir, fileName);
    if (!existsSync(filePath)) {
      await writeJson(filePath, value);
    }
  }

  private async ensureTextFile(filePath: string, value: string): Promise<void> {
    if (!existsSync(filePath)) {
      await writeFile(filePath, value, 'utf8');
    }
  }

  private promptPath(mode: InputMode): string {
    return join(this.baseDir, 'prompts', `${mode}.md`);
  }

  private lexiconTextPath(kind: LexiconTextKind): string {
    return join(this.baseDir, 'lexicon', `${kind}.txt`);
  }

  private async readLexiconTextFile(kind: LexiconTextKind): Promise<LexiconTextFiles[LexiconTextKind]> {
    const filePath = this.lexiconTextPath(kind);
    return {
      path: filePath,
      content: existsSync(filePath) ? await this.readTextTracked(filePath) : ''
    };
  }

  private async writeLexiconTextFiles(lexicon: Lexicon): Promise<void> {
    await Promise.all(
      (['terms', 'replacements', 'blocked'] as const).map((kind) => this.writeTextTracked(this.lexiconTextPath(kind), lexiconText(kind, lexicon)))
    );
  }

  private async readJsonTracked<T>(fileName: JsonFile): Promise<T> {
    const filePath = join(this.baseDir, fileName);
    const content = await readFile(filePath, 'utf8');
    const fileStat = await stat(filePath);
    this.knownMtimes.set(filePath, fileStat.mtimeMs);
    return JSON.parse(content) as T;
  }

  private async writeJsonTracked<T>(fileName: JsonFile, value: T): Promise<void> {
    const filePath = join(this.baseDir, fileName);
    await this.backupIfExternallyChanged(filePath);
    await writeJson(filePath, value);
    const fileStat = await stat(filePath);
    this.knownMtimes.set(filePath, fileStat.mtimeMs);
  }

  private async readTextTracked(filePath: string): Promise<string> {
    const content = await readFile(filePath, 'utf8');
    const fileStat = await stat(filePath);
    this.knownMtimes.set(filePath, fileStat.mtimeMs);
    return content;
  }

  private async writeTextTracked(filePath: string, value: string): Promise<void> {
    await this.backupIfExternallyChanged(filePath);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, value, 'utf8');
    const fileStat = await stat(filePath);
    this.knownMtimes.set(filePath, fileStat.mtimeMs);
  }

  private async backupIfExternallyChanged(filePath: string): Promise<void> {
    if (!existsSync(filePath) || !this.knownMtimes.has(filePath)) {
      return;
    }

    const currentMtime = (await stat(filePath)).mtimeMs;
    const knownMtime = this.knownMtimes.get(filePath);
    if (knownMtime === currentMtime) {
      return;
    }

    const conflictsDir = join(this.baseDir, 'conflicts');
    await mkdir(conflictsDir, { recursive: true });
    const parsed = parse(filePath);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    await copyFile(filePath, join(conflictsDir, `${parsed.name}.${stamp}.conflict${parsed.ext}`));
  }
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function normalizeSettings(raw: Partial<Settings>): Settings {
  const rawProviders = raw.providers ?? DEFAULT_SETTINGS.providers;
  const rawAsr = rawProviders.asr ?? DEFAULT_SETTINGS.providers.asr;
  const rawLlm = rawProviders.llm ?? DEFAULT_SETTINGS.providers.llm;

  return {
    ...DEFAULT_SETTINGS,
    ...raw,
    hotkey: {
      ...DEFAULT_SETTINGS.hotkey,
      ...(raw.hotkey ?? {}),
      longPressMs: Math.max(raw.hotkey?.longPressMs ?? DEFAULT_SETTINGS.hotkey.longPressMs, DEFAULT_SETTINGS.hotkey.longPressMs),
      singleClickMode: raw.hotkey?.singleClickMode ?? DEFAULT_SETTINGS.hotkey.singleClickMode,
      doubleClickMode: raw.hotkey?.doubleClickMode ?? oppositeMode(raw.hotkey?.singleClickMode ?? DEFAULT_SETTINGS.hotkey.singleClickMode)
    },
    providers: {
      asr: {
        ...DEFAULT_SETTINGS.providers.asr,
        ...rawAsr,
        kind: rawAsr.kind ?? DEFAULT_SETTINGS.providers.asr.kind,
        language: rawAsr.language ?? DEFAULT_SETTINGS.providers.asr.language
      },
      llm: {
        ...DEFAULT_SETTINGS.providers.llm,
        ...rawLlm,
        engine: normalizeLlmEngine(rawLlm),
        fallback: {
          ...DEFAULT_SETTINGS.providers.llm.fallback,
          ...(rawLlm.fallback ?? {})
        }
      }
    },
    sync: {
      ...DEFAULT_SETTINGS.sync,
      ...(raw.sync ?? {}),
      github: {
        ...DEFAULT_SETTINGS.sync.github,
        ...(raw.sync?.github ?? {})
      }
    },
    appearance: {
      ...DEFAULT_SETTINGS.appearance,
      ...(raw.appearance ?? {})
    },
    recording: {
      ...DEFAULT_SETTINGS.recording,
      ...(raw.recording ?? {}),
      maxDurationMinutes: normalizeRecordingDuration(raw.recording?.maxDurationMinutes)
    },
    paths: {
      ...DEFAULT_SETTINGS.paths,
      ...(raw.paths ?? {})
    },
    startup: {
      ...DEFAULT_SETTINGS.startup,
      ...(raw.startup ?? {})
    },
    updates: {
      ...DEFAULT_SETTINGS.updates,
      ...(raw.updates ?? {})
    }
  };
}

function withSourceDevice(entry: HistoryEntry, deviceId: string): HistoryEntry {
  return {
    ...entry,
    sourceDeviceId: entry.sourceDeviceId ?? deviceId
  };
}

function defaultPrompt(mode: InputMode): string {
  return mode === 'natural' ? naturalPrompt() : structuredPrompt();
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

function createAggregate(key: string, label: string): UsageAccumulator {
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

function getAccumulator(map: Map<string, UsageAccumulator>, key: string, label: string): UsageAccumulator {
  const existing = map.get(key);
  if (existing) {
    return existing;
  }
  const next = createAggregate(key, label);
  map.set(key, next);
  return next;
}

function addEntry(accumulator: UsageAccumulator, entry: HistoryEntry): void {
  accumulator.count += 1;
  accumulator.audioDurationSeconds += entry.audioDurationSeconds ?? 0;
  accumulator.outputCharCount += entry.outputCharCount ?? [...entry.outputText.replace(/\s+/g, '')].length;
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

function shouldIncludeRemoteUsageSummary(
  summary: SyncedUsageSummary | undefined,
  days: number,
  localDeviceIds: Set<string>,
  localCount: number
): summary is SyncedUsageSummary {
  if (!summary || summary.days !== days || summary.totalCount <= 0) {
    return false;
  }
  const remoteDeviceIds = new Set(summary.sourceDeviceIds ?? []);
  if (remoteDeviceIds.size === 0) {
    return localCount === 0;
  }
  for (const deviceId of remoteDeviceIds) {
    if (localDeviceIds.has(deviceId)) {
      return false;
    }
  }
  return true;
}

function addUsageSummary(accumulator: UsageAccumulator, summary: UsageStatistics): void {
  accumulator.count += summary.totalCount;
  accumulator.audioDurationSeconds += summary.totalAudioSeconds;
  accumulator.outputCharCount += summary.totalOutputChars;
  addAverage(accumulator, 'totalMs', 'totalMsCount', summary.averageTotalMs, summary.totalCount);
  addAverage(accumulator, 'asrMs', 'asrMsCount', summary.averageAsrMs, summary.totalCount);
  addAverage(accumulator, 'postProcessMs', 'postProcessMsCount', summary.averagePostProcessMs, summary.totalCount);
}

function addUsageAggregate(accumulator: UsageAccumulator, aggregate: UsageAggregate): void {
  accumulator.count += aggregate.count;
  accumulator.audioDurationSeconds += aggregate.audioDurationSeconds;
  accumulator.outputCharCount += aggregate.outputCharCount;
  addAverage(accumulator, 'totalMs', 'totalMsCount', aggregate.averageTotalMs, aggregate.count);
  addAverage(accumulator, 'asrMs', 'asrMsCount', aggregate.averageAsrMs, aggregate.count);
  addAverage(accumulator, 'postProcessMs', 'postProcessMsCount', aggregate.averagePostProcessMs, aggregate.count);
  if (!accumulator.lastUsedAt || (aggregate.lastUsedAt ?? '') > accumulator.lastUsedAt) {
    accumulator.lastUsedAt = aggregate.lastUsedAt;
  }
}

function addAverage(
  accumulator: UsageAccumulator,
  totalKey: 'totalMs' | 'asrMs' | 'postProcessMs',
  countKey: 'totalMsCount' | 'asrMsCount' | 'postProcessMsCount',
  averageValue: number | undefined,
  count: number
): void {
  if (typeof averageValue !== 'number' || count <= 0) {
    return;
  }
  accumulator[totalKey] += averageValue * count;
  accumulator[countKey] += count;
}

function toUsageAggregate(accumulator: UsageAccumulator): UsageAggregate {
  return {
    key: accumulator.key,
    label: accumulator.label,
    count: accumulator.count,
    audioDurationSeconds: round(accumulator.audioDurationSeconds),
    outputCharCount: accumulator.outputCharCount,
    averageTotalMs: average(accumulator.totalMs, accumulator.totalMsCount),
    averageAsrMs: average(accumulator.asrMs, accumulator.asrMsCount),
    averagePostProcessMs: average(accumulator.postProcessMs, accumulator.postProcessMsCount),
    averageRealTimeFactor:
      accumulator.audioDurationSeconds > 0 && accumulator.asrMs > 0 ? round(accumulator.audioDurationSeconds / (accumulator.asrMs / 1000)) : undefined,
    lastUsedAt: accumulator.lastUsedAt
  };
}

function sortUsageAggregate(left: UsageAggregate, right: UsageAggregate): number {
  return right.count - left.count || (right.lastUsedAt ?? '').localeCompare(left.lastUsedAt ?? '');
}

function average(total: number, count: number): number | undefined {
  return count > 0 ? Math.round(total / count) : undefined;
}

function round(value: number): number {
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

function normalizeLlmEngine(rawLlm: Partial<Settings['providers']['llm']>): Settings['providers']['llm']['engine'] {
  if (rawLlm.engine === 'off' || rawLlm.engine === 'local' || rawLlm.engine === 'cloud' || rawLlm.engine === 'local-with-cloud-fallback') {
    return rawLlm.engine;
  }
  if (rawLlm.enabled && rawLlm.fallback?.enabled) {
    return 'local-with-cloud-fallback';
  }
  if (rawLlm.enabled) {
    return 'local';
  }
  return 'off';
}

function normalizeRecordingDuration(value: Settings['recording']['maxDurationMinutes'] | undefined): Settings['recording']['maxDurationMinutes'] {
  return value === 5 || value === 10 || value === 20 || value === null ? value : 10;
}

function oppositeMode(mode: InputMode): InputMode {
  return mode === 'natural' ? 'structured' : 'natural';
}
