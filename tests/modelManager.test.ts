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
});
