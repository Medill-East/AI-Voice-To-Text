import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { UserDataStore } from '../src/core/userDataStore';

describe('UserDataStore', () => {
  it('creates syncable defaults without storing secrets', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'v2t-store-'));
    const store = await UserDataStore.create(dir, { deviceId: 'test-device' });

    const settings = await store.loadSettings();
    const lexicon = await store.loadLexicon();

    expect(settings.hotkey.accelerator).toBe('CommandOrControl+Shift+Space');
    expect(settings.providers.asr.kind).toBe('local-sherpa-onnx');
    expect(settings.providers.asr.modelId).toBeUndefined();
    expect(settings.providers.asr.runtime).toEqual({ provider: 'cpu', numThreads: 'auto', cudaExperimental: false });
    expect(settings.sync.kind).toBe('local-folder');
    expect(settings.sync.github.includeHistory).toBe(true);
    expect(settings.sync.github.autoSync).toBe(false);
    expect(settings.startup.openAtLogin).toBe(false);
    expect(settings.startup.silentOpenAtLogin).toBe(true);
    expect(settings.recording.maxDurationMinutes).toBe(10);
    expect(settings.updates.autoCheck).toBe(true);
    expect(settings.updates.autoDownload).toBe(true);
    expect(settings.appearance.theme).toBe('system');
    expect(settings.providers.llm.engine).toBe('off');
    expect(settings.providers.llm.apiKeyRef).toBe('system-keychain:v2t/openai-compatible');
    expect(settings.providers.llm.fastMode).toBe(true);
    expect(settings.providers.llm.timeoutMs).toBe(30000);
    expect(settings.providers.llm.fallback).toMatchObject({
      enabled: false,
      apiKeyRef: 'system-keychain:v2t/openai-compatible-fallback',
      timeoutMs: 30000
    });
    expect(settings.providers.llm).not.toHaveProperty('apiKey');
    expect(lexicon.terms).toEqual([]);
  });

  it('migrates ASR runtime settings to automatic CPU threads by default', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'v2t-store-asr-runtime-'));
    await writeFile(
      join(dir, 'settings.json'),
      JSON.stringify({
        schemaVersion: 1,
        defaultMode: 'natural',
        providers: {
          asr: { kind: 'local-sherpa-onnx', language: 'zh' },
          llm: { enabled: false, kind: 'openai-compatible', baseUrl: '', model: '', apiKeyRef: 'system-keychain:v2t/openai-compatible' }
        }
      }),
      'utf8'
    );

    const store = await UserDataStore.create(dir, { deviceId: 'device-a' });
    await expect(store.loadSettings()).resolves.toMatchObject({
      providers: {
        asr: {
          runtime: { provider: 'cpu', numThreads: 'auto', cudaExperimental: false }
        }
      }
    });
  });

  it('migrates legacy recording settings to a 10 minute limit', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'v2t-store-recording-limit-'));
    await writeFile(
      join(dir, 'settings.json'),
      JSON.stringify({
        schemaVersion: 1,
        defaultMode: 'natural',
        recording: { muteSystemAudio: true },
        providers: {
          asr: { kind: 'local-sherpa-onnx', language: 'zh' },
          llm: { enabled: false, kind: 'openai-compatible', baseUrl: '', model: '', apiKeyRef: 'system-keychain:v2t/openai-compatible' }
        }
      }),
      'utf8'
    );

    const store = await UserDataStore.create(dir, { deviceId: 'device-a' });
    const settings = await store.loadSettings();

    expect(settings.recording.muteSystemAudio).toBe(true);
    expect(settings.recording.maxDurationMinutes).toBe(10);
  });

  it('migrates legacy sync settings to include text history by default while preserving explicit opt-out', async () => {
    const legacyDir = await mkdtemp(join(tmpdir(), 'v2t-store-sync-history-default-'));
    await writeFile(
      join(legacyDir, 'settings.json'),
      JSON.stringify({
        schemaVersion: 1,
        defaultMode: 'natural',
        sync: { kind: 'github', github: { branch: 'main' } },
        providers: {
          asr: { kind: 'local-sherpa-onnx', language: 'zh' },
          llm: { enabled: false, kind: 'openai-compatible', baseUrl: '', model: '', apiKeyRef: 'system-keychain:v2t/openai-compatible' }
        }
      }),
      'utf8'
    );
    const legacyStore = await UserDataStore.create(legacyDir, { deviceId: 'device-a' });
    await expect(legacyStore.loadSettings()).resolves.toMatchObject({ sync: { github: { includeHistory: true } } });

    const optOutDir = await mkdtemp(join(tmpdir(), 'v2t-store-sync-history-optout-'));
    await writeFile(
      join(optOutDir, 'settings.json'),
      JSON.stringify({
        schemaVersion: 1,
        defaultMode: 'natural',
        sync: { kind: 'github', github: { branch: 'main', includeHistory: false } },
        providers: {
          asr: { kind: 'local-sherpa-onnx', language: 'zh' },
          llm: { enabled: false, kind: 'openai-compatible', baseUrl: '', model: '', apiKeyRef: 'system-keychain:v2t/openai-compatible' }
        }
      }),
      'utf8'
    );
    const optOutStore = await UserDataStore.create(optOutDir, { deviceId: 'device-a' });
    await expect(optOutStore.loadSettings()).resolves.toMatchObject({ sync: { github: { includeHistory: false } } });
  });

  it('keeps editable lexicon text files in sync with lexicon.json', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'v2t-store-lexicon-text-'));
    const store = await UserDataStore.create(dir, { deviceId: 'device-a' });

    await store.saveLexicon({
      version: 1,
      terms: [{ phrase: '王小波', aliases: ['王小博'] }],
      replacements: [{ from: 'Github', to: 'GitHub' }],
      blocked: ['嗯']
    });

    const paths = store.getLexiconTextPaths();
    expect(await readFile(paths.terms, 'utf8')).toContain('王小波, 王小博');
    expect(await readFile(paths.replacements, 'utf8')).toContain('Github -> GitHub');

    await writeFile(paths.terms, '许知远，许之远\n', 'utf8');
    await writeFile(paths.replacements, '错别词 -> 正确词\n', 'utf8');
    await writeFile(paths.blocked, '呃，啊\n', 'utf8');

    const imported = await store.importLexiconTextFiles();
    expect(imported.terms).toEqual([{ phrase: '许知远', aliases: ['许之远'], tags: undefined, caseSensitive: undefined }]);
    expect(imported.replacements).toEqual([{ from: '错别词', to: '正确词', enabled: true }]);
    expect(imported.blocked).toEqual(['呃', '啊']);
  });

  it('reads and saves editable lexicon text files as the primary editing surface', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'v2t-store-lexicon-text-edit-'));
    const store = await UserDataStore.create(dir, { deviceId: 'device-a' });

    await store.saveLexiconTextFiles({
      terms: {
        path: '',
        content: '王小波, 王小博\n许知远，许之远\n'
      },
      replacements: {
        path: '',
        content: 'Github => GitHub\n错别词 -> 正确词\nGithub -> GitHub\n'
      },
      blocked: {
        path: '',
        content: '嗯，呃\n啊\n嗯\n'
      }
    });

    const lexicon = await store.loadLexicon();
    expect(lexicon.terms).toEqual([
      { phrase: '王小波', aliases: ['王小博'], tags: undefined, caseSensitive: undefined },
      { phrase: '许知远', aliases: ['许之远'], tags: undefined, caseSensitive: undefined }
    ]);
    expect(lexicon.replacements).toEqual([
      { from: 'Github', to: 'GitHub', enabled: true },
      { from: '错别词', to: '正确词', enabled: true }
    ]);
    expect(lexicon.blocked).toEqual(['嗯', '呃', '啊']);

    const textFiles = await store.readLexiconTextFiles();
    expect(textFiles.terms.content).toBe('王小波, 王小博\n许知远, 许之远\n');
    expect(textFiles.replacements.content).toBe('Github -> GitHub\n错别词 -> 正确词\n');
    expect(textFiles.blocked.content).toBe('嗯\n呃\n啊\n');
    expect(textFiles.terms.path).toBe(join(dir, 'lexicon', 'terms.txt'));
  });

  it('migrates legacy HTTP-only ASR settings to advanced HTTP mode', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'v2t-store-'));
    await writeFile(
      join(dir, 'settings.json'),
      JSON.stringify({
        schemaVersion: 1,
        defaultMode: 'natural',
        hotkey: { accelerator: 'CommandOrControl+Shift+Space', longPressMs: 250 },
        providers: {
          asr: { kind: 'funasr-http', endpoint: 'http://127.0.0.1:10095/transcribe', language: 'zh' },
          llm: {
            enabled: false,
            kind: 'openai-compatible',
            baseUrl: 'http://127.0.0.1:11434/v1',
            model: 'qwen2.5:7b',
            apiKeyRef: 'system-keychain:v2t/openai-compatible'
          }
        }
      }),
      'utf8'
    );

    const store = await UserDataStore.create(dir, { deviceId: 'device-a' });
    const settings = await store.loadSettings();

    expect(settings.providers.asr.kind).toBe('funasr-http');
    expect(settings.providers.asr.endpoint).toBe('http://127.0.0.1:10095/transcribe');
    expect(settings.providers.asr.modelId).toBeUndefined();
    expect(settings.providers.llm.engine).toBe('off');
  });

  it('migrates legacy enabled LLM settings to explicit engine modes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'v2t-store-'));
    await writeFile(
      join(dir, 'settings.json'),
      JSON.stringify({
        schemaVersion: 1,
        defaultMode: 'structured',
        providers: {
          llm: {
            enabled: true,
            kind: 'lm-studio',
            baseUrl: 'http://127.0.0.1:1234/v1',
            model: 'qwen-local',
            fallback: {
              enabled: true,
              baseUrl: 'https://openrouter.ai/api/v1',
              model: 'openrouter/free'
            }
          }
        }
      }),
      'utf8'
    );

    const store = await UserDataStore.create(dir, { deviceId: 'device-a' });
    const settings = await store.loadSettings();

    expect(settings.providers.llm.engine).toBe('local-with-cloud-fallback');
    expect(settings.providers.llm.fallback.model).toBe('openrouter/free');
  });

  it('appends text-only history records under the current device id', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'v2t-store-'));
    const store = await UserDataStore.create(dir, { deviceId: 'device-a' });

    await store.appendHistory({
      id: 'entry-1',
      createdAt: '2026-04-25T10:20:30.000Z',
      mode: 'natural',
      rawText: '原始文本',
      outputText: '最终文本',
      targetApp: 'Notes',
      injectionMethod: 'cursor'
    });

    const historyPath = join(dir, 'history', 'device-a', '2026-04.jsonl');
    const history = await readFile(historyPath, 'utf8');

    expect(history).toContain('"rawText":"原始文本"');
    expect(history).toContain('"outputText":"最终文本"');
    expect(history).not.toContain('audioData');
  });

  it('aggregates usage statistics from text-only history metadata', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'v2t-store-'));
    const store = await UserDataStore.create(dir, { deviceId: 'device-a' });

    await store.appendHistory({
      id: 'entry-1',
      createdAt: new Date().toISOString(),
      mode: 'structured',
      rawText: '原始文本',
      outputText: '最终文本',
      injectionMethod: 'cursor',
      postProcessorEngine: 'llm-cloud',
      audioDurationSeconds: 12,
      outputCharCount: 4,
      asrModelId: 'sensevoice',
      asrDurationMs: 3000,
      postProcessDurationMs: 700,
      totalDurationMs: 4100
    });

    const stats = await store.readUsageStatistics(30);

    expect(stats).toMatchObject({
      totalCount: 1,
      totalAudioSeconds: 12,
      totalOutputChars: 4,
      averageTotalMs: 4100,
      averageAsrMs: 3000,
      averagePostProcessMs: 700
    });
    expect(stats.asrModels[0]).toMatchObject({ key: 'sensevoice', averageRealTimeFactor: 4 });
    expect(stats.postProcessors[0]).toMatchObject({ key: 'llm-cloud', label: '云端 LLM' });
  });

  it('labels legacy history without ASR metadata explicitly instead of unknown ASR', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'v2t-store-'));
    const store = await UserDataStore.create(dir, { deviceId: 'device-a' });

    await store.appendHistory({
      id: 'legacy-entry',
      createdAt: new Date().toISOString(),
      mode: 'natural',
      rawText: '旧记录',
      outputText: '旧记录',
      injectionMethod: 'cursor',
      outputCharCount: 3,
      totalDurationMs: 500
    });

    const stats = await store.readUsageStatistics(30);

    expect(stats.asrModels[0]).toMatchObject({ key: 'legacy-unrecorded-asr', label: '旧记录：未记录模型' });
    expect(stats.asrModels[0].label).not.toContain('未知');
  });

  it('merges synced usage summary when detailed history for that device is not present', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'v2t-store-remote-stats-'));
    const store = await UserDataStore.create(dir, { deviceId: 'device-a' });
    await mkdir(join(dir, 'stats'), { recursive: true });
    await writeFile(
      join(dir, 'stats', 'remote-usage-summary.json'),
      JSON.stringify({
        generatedAt: '2026-04-30T00:00:00.000Z',
        importedAt: '2026-04-30T01:00:00.000Z',
        sourceDeviceIds: ['device-b'],
        days: 30,
        totalCount: 2,
        totalAudioSeconds: 30,
        totalOutputChars: 20,
        averageTotalMs: 2000,
        asrModels: [{ key: 'qwen3', label: 'Qwen3 ASR', count: 2, audioDurationSeconds: 30, outputCharCount: 20, averageTotalMs: 2000 }],
        postProcessors: [{ key: 'llm-cloud', label: '云端 LLM', count: 2, audioDurationSeconds: 30, outputCharCount: 20 }]
      }),
      'utf8'
    );

    const stats = await store.readUsageStatistics(30);

    expect(stats.totalCount).toBe(2);
    expect(stats.asrModels[0]).toMatchObject({ key: 'qwen3', label: 'Qwen3 ASR', count: 2 });
    expect(stats.remoteImportedAt).toBe('2026-04-30T01:00:00.000Z');
    expect(stats.remoteSummaryIncluded).toBe(true);
    expect(stats.sourceDeviceIds).toEqual(['device-b']);
  });

  it('does not double count synced summary when detailed history for the same device exists', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'v2t-store-remote-dedupe-'));
    const store = await UserDataStore.create(dir, { deviceId: 'device-a' });
    await mkdir(join(dir, 'history', 'device-b'), { recursive: true });
    await writeFile(
      join(dir, 'history', 'device-b', '2026-04.jsonl'),
      '{"id":"history-b","createdAt":"2026-04-30T00:00:00.000Z","mode":"natural","rawText":"a","outputText":"b","injectionMethod":"cursor","asrModelId":"qwen3"}\n',
      'utf8'
    );
    await mkdir(join(dir, 'stats'), { recursive: true });
    await writeFile(
      join(dir, 'stats', 'remote-usage-summary.json'),
      JSON.stringify({
        importedAt: '2026-04-30T01:00:00.000Z',
        sourceDeviceIds: ['device-b'],
        days: 30,
        totalCount: 1,
        totalAudioSeconds: 10,
        totalOutputChars: 10,
        asrModels: [{ key: 'qwen3', label: 'Qwen3 ASR', count: 1, audioDurationSeconds: 10, outputCharCount: 10 }],
        postProcessors: []
      }),
      'utf8'
    );

    const stats = await store.readUsageStatistics(30);

    expect(stats.totalCount).toBe(1);
    expect(stats.remoteSummaryIncluded).toBe(false);
    expect(stats.sourceDeviceIds).toEqual(['device-b']);
  });

  it('loads recent history from every synced device in reverse chronological order', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'v2t-store-'));
    const store = await UserDataStore.create(dir, { deviceId: 'device-a' });

    await store.appendHistory({
      id: 'old',
      createdAt: '2026-03-25T10:20:30.000Z',
      mode: 'natural',
      rawText: '旧文本',
      outputText: '旧文本',
      injectionMethod: 'cursor'
    });
    await store.appendHistory({
      id: 'new',
      createdAt: '2026-04-25T10:20:30.000Z',
      mode: 'structured',
      rawText: '新文本',
      outputText: '新文本',
      injectionMethod: 'clipboard'
    });
    await mkdir(join(dir, 'history', 'device-b'), { recursive: true });
    await writeFile(
      join(dir, 'history', 'device-b', '2026-04.jsonl'),
      '{"id":"remote","createdAt":"2026-04-26T10:20:30.000Z","mode":"natural","rawText":"远端文本","outputText":"远端文本","injectionMethod":"cursor"}\n',
      'utf8'
    );

    await expect(store.readRecentHistory(30)).resolves.toMatchObject([
      { id: 'remote', sourceDeviceId: 'device-b' },
      { id: 'new', sourceDeviceId: 'device-a' },
      { id: 'old', sourceDeviceId: 'device-a' }
    ]);
    await expect(store.readRecentHistory(1)).resolves.toMatchObject([{ id: 'remote', sourceDeviceId: 'device-b' }]);
  });

  it('backs up externally changed settings before overwriting them', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'v2t-store-'));
    const store = await UserDataStore.create(dir, { deviceId: 'device-a' });
    const settings = await store.loadSettings();

    await new Promise((resolve) => setTimeout(resolve, 20));
    await writeFile(join(dir, 'settings.json'), '{"external":true}\n', 'utf8');

    await store.saveSettings({
      ...settings,
      defaultMode: 'structured'
    });

    const conflicts = await store.listConflicts();
    expect(conflicts.some((file) => file.includes('settings'))).toBe(true);

    const saved = await readFile(join(dir, 'settings.json'), 'utf8');
    expect(saved).toContain('"defaultMode": "structured"');

    const savedStat = await stat(join(dir, 'settings.json'));
    expect(savedStat.size).toBeGreaterThan(0);
  });

  it('reads, saves, and resets editable prompts', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'v2t-store-prompts-'));
    const store = await UserDataStore.create(dir, { deviceId: 'device-a' });

    await expect(store.readPrompt('natural')).resolves.toContain('保守');
    await store.savePrompt('structured', '按话题边界分段\n');
    await expect(store.readPrompt('structured')).resolves.toBe('按话题边界分段\n');

    const paths = store.getPromptPaths();
    expect(paths.natural).toBe(join(dir, 'prompts', 'natural.md'));
    expect(paths.structured).toBe(join(dir, 'prompts', 'structured.md'));

    await store.resetPrompt('structured');
    await expect(store.readPrompt('structured')).resolves.toContain('结构化整理器');
    await expect(store.readPrompt('structured')).resolves.toContain('口头噪声已预处理');
  });

  it('keeps natural and structured prompts independent when saving one file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'v2t-store-prompts-independent-'));
    const store = await UserDataStore.create(dir, { deviceId: 'device-a' });

    const originalStructured = await store.readPrompt('structured');
    await store.savePrompt('natural', '自然输入自定义\n');

    await expect(store.readPrompt('natural')).resolves.toBe('自然输入自定义\n');
    await expect(store.readPrompt('structured')).resolves.toBe(originalStructured);
  });
});
