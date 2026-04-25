import { copyFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, parse } from 'node:path';
import type { HistoryEntry, InputMode, Lexicon, PromptFiles, Settings } from './types';
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
      enabled: false,
      kind: 'openai-compatible',
      baseUrl: 'http://127.0.0.1:11434/v1',
      model: 'qwen2.5:7b',
      apiKeyRef: 'system-keychain:v2t/openai-compatible'
    }
  },
  sync: {
    kind: 'local-folder',
    github: {
      branch: 'main',
      includeHistory: false,
      autoSync: false
    }
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

  async listConflicts(): Promise<string[]> {
    const conflictsDir = join(this.baseDir, 'conflicts');
    if (!existsSync(conflictsDir)) {
      return [];
    }

    return readdir(conflictsDir);
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
        ...rawLlm
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
    }
  };
}

function defaultPrompt(mode: InputMode): string {
  return mode === 'natural' ? naturalPrompt() : structuredPrompt();
}

function oppositeMode(mode: InputMode): InputMode {
  return mode === 'natural' ? 'structured' : 'natural';
}
