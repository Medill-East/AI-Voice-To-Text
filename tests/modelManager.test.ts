import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
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

  it('lists installed legacy models even when they are no longer in the recommendation catalog', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'v2t-models-'));
    const modelRoot = join(baseDir, 'models');
    const legacyId = 'sensevoice-onnx-int8-2024';
    const legacyPath = join(modelRoot, legacyId, 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17', 'model.int8.onnx');
    const store = await UserDataStore.create(join(baseDir, 'sync'), { deviceId: 'device-a' });
    await mkdir(join(modelRoot, legacyId, 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17'), { recursive: true });
    await writeFile(legacyPath, 'model');
    await writeFile(join(modelRoot, 'model-status.json'), JSON.stringify({
      [legacyId]: {
        modelId: legacyId,
        status: 'current',
        modelPath: legacyPath,
        updatedAt: '2026-04-25T00:00:00.000Z'
      }
    }));
    const settings = await store.loadSettings();
    await store.saveSettings({
      ...settings,
      providers: {
        ...settings.providers,
        asr: {
          ...settings.providers.asr,
          kind: 'local-sherpa-onnx',
          modelId: legacyId,
          modelPath: legacyPath
        }
      }
    });

    const manager = new ModelManager({ modelRoot, store, catalog: DEFAULT_MODEL_CATALOG });
    const views = await manager.listInstalledModelViews(await store.loadSettings());

    expect(views).toEqual([
      expect.objectContaining({
        modelId: legacyId,
        name: 'SenseVoice ONNX int8 2024',
        current: true,
        legacy: true,
        canActivate: false,
        canDelete: false
      })
    ]);
  });

  it('activates and deletes non-current legacy SenseVoice models', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'v2t-models-'));
    const modelRoot = join(baseDir, 'models');
    const legacyId = 'sensevoice-onnx-int8-2024';
    const legacyDir = join(modelRoot, legacyId, 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17');
    const legacyPath = join(legacyDir, 'model.int8.onnx');
    const store = await UserDataStore.create(join(baseDir, 'sync'), { deviceId: 'device-a' });
    await mkdir(legacyDir, { recursive: true });
    await writeFile(legacyPath, 'model');
    await writeFile(join(legacyDir, 'tokens.txt'), 'tokens');
    await writeFile(join(modelRoot, 'model-status.json'), JSON.stringify({
      [legacyId]: {
        modelId: legacyId,
        status: 'installed',
        modelPath: legacyPath,
        updatedAt: '2026-04-25T00:00:00.000Z'
      }
    }));

    const manager = new ModelManager({ modelRoot, store, catalog: DEFAULT_MODEL_CATALOG });
    await manager.activateInstalledModel(legacyId);

    const activated = await store.loadSettings();
    expect(activated.providers.asr.modelId).toBe(legacyId);
    expect(activated.providers.asr.modelPath).toBe(legacyPath);
    expect(activated.providers.asr.sherpaModelType).toBe('senseVoice');

    await store.saveSettings({
      ...activated,
      providers: {
        ...activated.providers,
        asr: {
          ...activated.providers.asr,
          modelId: 'funasr-nano-int8-2025-12-30',
          modelPath: '/current/model'
        }
      }
    });
    const result = await manager.deleteModel(legacyId);
    expect(result.status).toBe('not-installed');
    await expect(stat(join(modelRoot, legacyId))).rejects.toThrow();
  });
});
