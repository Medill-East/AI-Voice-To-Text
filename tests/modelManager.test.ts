import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_MODEL_CATALOG } from '../src/core/modelCatalog';
import { ModelManager } from '../src/core/modelManager';
import { UserDataStore } from '../src/core/userDataStore';

describe('ModelManager', () => {
  it('downloads, verifies, and activates a selected local model with its sherpa model type', async () => {
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

    const result = await manager.installAndActivate('funasr-nano-int8-2025-12-30');
    const settings = await store.loadSettings();

    expect(result.status).toBe('current');
    expect(settings.providers.asr.kind).toBe('local-sherpa-onnx');
    expect(settings.providers.asr.modelId).toBe('funasr-nano-int8-2025-12-30');
    expect(settings.providers.asr.modelPath).toContain('funasr-nano-int8-2025-12-30');
    expect(settings.providers.asr.sherpaModelType).toBe('funasrNano');
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
          modelId: 'sensevoice-onnx-int8-2025-09-09',
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

    await expect(manager.installAndActivate('funasr-nano-int8-2025-12-30')).rejects.toThrow('network down');
    const settings = await store.loadSettings();

    expect(settings.providers.asr.modelId).toBe('sensevoice-onnx-int8-2025-09-09');
    expect(settings.providers.asr.modelPath).toBe('/previous/model');

    const status = JSON.parse(await readFile(join(baseDir, 'models', 'model-status.json'), 'utf8'));
    expect(status['funasr-nano-int8-2025-12-30'].status).toBe('failed');
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
          await mkdir(join(installDir, 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09'), { recursive: true });
          await writeFile(
            join(installDir, 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09', 'model.int8.onnx'),
            'model'
          );
          await writeFile(join(installDir, 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09', 'tokens.txt'), 'tokens');
        });
      }
    });

    await manager.installAndActivate('sensevoice-onnx-int8-2025-09-09');
    await expect(manager.deleteModel('sensevoice-onnx-int8-2025-09-09')).rejects.toThrow('当前正在使用');

    const settings = await store.loadSettings();
    await store.saveSettings({
      ...settings,
      providers: {
        ...settings.providers,
        asr: {
          ...settings.providers.asr,
          modelId: 'funasr-nano-int8-2025-12-30',
          modelPath: '/current/model'
        }
      }
    });

    const result = await manager.deleteModel('sensevoice-onnx-int8-2025-09-09');
    expect(result.status).toBe('not-installed');

    const installed = await manager.listInstalledModels();
    expect(installed.some((item) => item.modelId === 'sensevoice-onnx-int8-2025-09-09')).toBe(false);
  });
});
