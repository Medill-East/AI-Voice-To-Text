import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
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
    expect(settings.providers.llm.apiKeyRef).toBe('system-keychain:v2t/openai-compatible');
    expect(settings.providers.llm).not.toHaveProperty('apiKey');
    expect(lexicon.terms).toEqual([]);
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
    expect(history).not.toContain('audio');
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
});
