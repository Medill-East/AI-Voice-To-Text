import { copyFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, parse } from 'node:path';
import type { HistoryEntry, InputMode, Lexicon, PromptFiles, Settings, UsageAggregate, UsageStatistics } from './types';
import { naturalPrompt, structuredPrompt } from './postProcessor';

interface StoreOptions {
  deviceId: string;
}

type JsonFile = 'settings.json' | 'lexicon.json';

const DEFAULT_SETTINGS: Settings = {
  schemaVersion: 1,
  defaultMode: 'natural',
  appearance: {
    theme: 'system'
  },
  paths: {},
  startup: {
    openAtLogin: false
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
      includeHistory: false,
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
    return this.readJsonTracked<Lexicon>('lexicon.json');
  }

  async saveLexicon(lexicon: Lexicon): Promise<void> {
    await this.writeJsonTracked('lexicon.json', lexicon);
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
      .map((line) => JSON.parse(line) as HistoryEntry);
  }

  async readRecentHistory(limit = 30): Promise<HistoryEntry[]> {
    const historyDir = join(this.baseDir, 'history', this.deviceId);
    if (!existsSync(historyDir)) {
      return [];
    }

    const files = (await readdir(historyDir))
      .filter((file) => /^\d{4}-\d{2}\.jsonl$/.test(file))
      .sort()
      .reverse();
    const entries: HistoryEntry[] = [];

    for (const file of files) {
      const content = await readFile(join(historyDir, file), 'utf8');
      entries.push(
        ...content
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => JSON.parse(line) as HistoryEntry)
      );
      if (entries.length >= limit) {
        break;
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

    for (const entry of entries) {
      addEntry(totals, entry);
      const asrKey = entry.asrModelId ?? entry.asrProviderKind ?? 'legacy-unrecorded-asr';
      const asrLabel = entry.asrModelName ?? entry.asrModelId ?? entry.asrProviderKind ?? '旧记录：未记录模型';
      addEntry(getAccumulator(byAsr, asrKey, asrLabel), entry);
      const processorKey = entry.postProcessorEngine ?? 'local-rules';
      addEntry(getAccumulator(byPostProcessor, processorKey, postProcessorLabel(processorKey)), entry);
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
      postProcessors: [...byPostProcessor.values()].map(toUsageAggregate).sort(sortUsageAggregate)
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
    const historyDir = join(this.baseDir, 'history', this.deviceId);
    if (!existsSync(historyDir)) {
      return [];
    }

    const files = (await readdir(historyDir)).filter((file) => /^\d{4}-\d{2}\.jsonl$/.test(file)).sort();
    const entries: HistoryEntry[] = [];
    for (const file of files) {
      const content = await readFile(join(historyDir, file), 'utf8');
      entries.push(
        ...content
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => JSON.parse(line) as HistoryEntry)
      );
    }
    return entries;
  }

  getBaseDir(): string {
    return this.baseDir;
  }

  private async ensureDefaults(): Promise<void> {
    await mkdir(this.baseDir, { recursive: true });
    await mkdir(join(this.baseDir, 'prompts'), { recursive: true });
    await mkdir(join(this.baseDir, 'history', this.deviceId), { recursive: true });
    await mkdir(join(this.baseDir, 'conflicts'), { recursive: true });

    await this.ensureFile('settings.json', DEFAULT_SETTINGS);
    await this.ensureFile('lexicon.json', DEFAULT_LEXICON);
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

function oppositeMode(mode: InputMode): InputMode {
  return mode === 'natural' ? 'structured' : 'natural';
}
