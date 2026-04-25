import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_MODEL_CATALOG } from '../src/core/modelCatalog';
import { ModelManager } from '../src/core/modelManager';
import { UserDataStore } from '../src/core/userDataStore';

describe('ModelManager', () => {
  it('downloads, verifies, and activates a selected local model', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'v2t-models-'));
    const store = await UserDataStore.create(join(baseDir, 'sync'), { deviceId: 'device-a' });
    const manager = new ModelManager({
      modelRoot: join(baseDir, 'models'),
      store,
      catalog: DEFAULT_MODEL_CATALOG,
      downloader: vi.fn().mockResolvedValue(undefined),
      extractor: vi.fn().mockResolvedValue(undefined),
      verifier: vi.fn().mockResolvedValue(undefined)
    });

    const result = await manager.installAndActivate('sensevoice-onnx-int8-2025');
    const settings = await store.loadSettings();

    expect(result.status).toBe('current');
    expect(settings.providers.asr.kind).toBe('local-sherpa-onnx');
    expect(settings.providers.asr.modelId).toBe('sensevoice-onnx-int8-2025');
    expect(settings.providers.asr.modelPath).toContain('sensevoice-onnx-int8-2025');
  });

  it('keeps the previous active model when download fails', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'v2t-models-'));
    const store = await UserDataStore.create(join(baseDir, 'sync'), { deviceId: 'device-a' });
    const previous = await store.loadSettings();
    await store.saveSettings({
      ...previous,
      providers: {
        ...previous.providers,
        asr: {
          ...previous.providers.asr,
          kind: 'local-sherpa-onnx',
          modelId: 'sensevoice-onnx-int8-2024',
          modelPath: '/previous/model'
        }
      }
    });

    const manager = new ModelManager({
      modelRoot: join(baseDir, 'models'),
      store,
      catalog: DEFAULT_MODEL_CATALOG,
      downloader: vi.fn().mockRejectedValue(new Error('network down'))
    });

    await expect(manager.installAndActivate('sensevoice-onnx-int8-2025')).rejects.toThrow('network down');
    const settings = await store.loadSettings();

    expect(settings.providers.asr.modelId).toBe('sensevoice-onnx-int8-2024');
    expect(settings.providers.asr.modelPath).toBe('/previous/model');

    const status = JSON.parse(await readFile(join(baseDir, 'models', 'model-status.json'), 'utf8'));
    expect(status['sensevoice-onnx-int8-2025'].status).toBe('failed');
  });

  it('deletes installed non-current models and refuses to delete the current model', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'v2t-models-'));
    const store = await UserDataStore.create(join(baseDir, 'sync'), { deviceId: 'device-a' });
    const manager = new ModelManager({
      modelRoot: join(baseDir, 'models'),
      store,
      catalog: DEFAULT_MODEL_CATALOG,
      downloader: vi.fn().mockResolvedValue(undefined),
      extractor: async (_model, _archive, installDir) => {
        await import('node:fs/promises').then(async ({ mkdir, writeFile }) => {
          await mkdir(join(installDir, 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17'), { recursive: true });
          await writeFile(
            join(installDir, 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17', 'model.int8.onnx'),
            'model'
          );
          await writeFile(join(installDir, 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17', 'tokens.txt'), 'tokens');
        });
      }
    });

    await manager.installAndActivate('sensevoice-onnx-int8-2024');
    await expect(manager.deleteModel('sensevoice-onnx-int8-2024')).rejects.toThrow('当前正在使用');

    const settings = await store.loadSettings();
    await store.saveSettings({
      ...settings,
      providers: {
        ...settings.providers,
        asr: {
          ...settings.providers.asr,
          modelId: 'sensevoice-onnx-int8-2025',
          modelPath: '/current/model'
        }
      }
    });

    const result = await manager.deleteModel('sensevoice-onnx-int8-2024');
    expect(result.status).toBe('not-installed');

    const installed = await manager.listInstalledModels();
    expect(installed.some((item) => item.modelId === 'sensevoice-onnx-int8-2024')).toBe(false);
  });
});
