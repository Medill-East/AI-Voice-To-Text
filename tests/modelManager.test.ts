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

  it('installs Qwen3-ASR 0.6B with the qwen3 sherpa model type', async () => {
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

    const result = await manager.installAndActivate('qwen3-asr-0.6b');
    const settings = await store.loadSettings();

    expect(result.status).toBe('current');
    expect(settings.providers.asr.modelId).toBe('qwen3-asr-0.6b');
    expect(settings.providers.asr.sherpaModelType).toBe('qwen3Asr');
    expect(settings.providers.asr.modelPath).toContain('encoder.int8.onnx');
  });

  it('reports installation progress through each stage', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'v2t-models-'));
    const store = await UserDataStore.create(join(baseDir, 'sync'), { deviceId: 'device-a' });
    const updates: string[] = [];
    const manager = new ModelManager({
      modelRoot: join(baseDir, 'models'),
      store,
      catalog: DEFAULT_MODEL_CATALOG,
      downloader: vi.fn().mockResolvedValue(undefined),
      extractor: vi.fn().mockResolvedValue(undefined),
      verifier: vi.fn().mockResolvedValue(undefined)
    });

    await manager.installAndActivate('funasr-nano-int8-2025-12-30', (status) => {
      updates.push(`${status.status}:${status.progress ?? 'none'}`);
    });

    expect(updates).toEqual([
      'downloading:0',
      'extracting:55',
      'verifying:75',
      'activating:90',
      'current:100'
    ]);
  });

  it('reports download speed, ETA, source, and attempt in progress updates', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'v2t-models-'));
    const store = await UserDataStore.create(join(baseDir, 'sync'), { deviceId: 'device-a' });
    const updates: Array<{ bytesPerSecond?: number; etaSeconds?: number; sourceLabel?: string; attempt?: number; canResume?: boolean }> = [];
    const manager = new ModelManager({
      modelRoot: join(baseDir, 'models'),
      store,
      catalog: DEFAULT_MODEL_CATALOG,
      downloader: async (_model, _archivePath, onProgress) => {
        await onProgress?.({
          downloadedBytes: 5_000,
          totalBytes: 10_000,
          progress: 25,
          bytesPerSecond: 1_000,
          etaSeconds: 5,
          sourceLabel: 'GitHub Release',
          attempt: 1,
          canResume: true
        });
      },
      extractor: vi.fn().mockResolvedValue(undefined),
      verifier: vi.fn().mockResolvedValue(undefined)
    });

    await manager.installAndActivate('funasr-nano-int8-2025-12-30', (status) => {
      if (status.status === 'downloading' && status.downloadedBytes) {
        updates.push(status);
      }
    });

    expect(updates).toContainEqual(
      expect.objectContaining({
        bytesPerSecond: 1_000,
        etaSeconds: 5,
        sourceLabel: 'GitHub Release',
        attempt: 1,
        canResume: true
      })
    );
  });

  it('records a local ASR benchmark for an installed model', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'v2t-models-'));
    const modelRoot = join(baseDir, 'models');
    const store = await UserDataStore.create(join(baseDir, 'sync'), { deviceId: 'device-a' });
    const modelDir = join(modelRoot, 'qwen3-asr-0.6b', 'sherpa-onnx-qwen3-asr-0.6B-int8-2026-03-25');
    await mkdir(join(modelDir, 'test_wavs'), { recursive: true });
    await writeFile(join(modelDir, 'encoder.int8.onnx'), 'encoder');
    await writeFile(join(modelDir, 'test_wavs', 'codeswitch.wav'), createPcm16Wav(new Array(16000).fill(1000), 16000));
    const storeSettings = await store.loadSettings();
    await store.saveSettings({
      ...storeSettings,
      providers: {
        ...storeSettings.providers,
        asr: {
          ...storeSettings.providers.asr,
          modelId: 'qwen3-asr-0.6b',
          modelPath: join(modelDir, 'encoder.int8.onnx'),
          sherpaModelType: 'qwen3Asr'
        }
      }
    });
    const manager = new ModelManager({
      modelRoot,
      store,
      catalog: DEFAULT_MODEL_CATALOG,
      benchmarkTranscriber: vi.fn(async () => '测试中文 English')
    });

    const result = await manager.benchmarkInstalledModel('qwen3-asr-0.6b');
    const statuses = await manager.getStatuses();

    expect(result).toMatchObject({ ok: true, audioSeconds: 1, processMs: 1 });
    expect(statuses['qwen3-asr-0.6b'].benchmarkRealTimeFactor).toBe(1000);
    expect(statuses['qwen3-asr-0.6b'].benchmarkCharsPerSecond).toBeGreaterThan(0);
  });

  it('probes a model source with a 1MB range request and reports speed diagnostics', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'v2t-models-'));
    const store = await UserDataStore.create(join(baseDir, 'sync'), { deviceId: 'device-a' });
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ Range: 'bytes=0-1048575' });
      return new Response(new Uint8Array(512 * 1024), {
        status: 206,
        headers: {
          'content-length': `${512 * 1024}`,
          'content-range': `bytes 0-${512 * 1024 - 1}/${1024 * 1024}`,
          'accept-ranges': 'bytes'
        }
      });
    });
    const manager = new ModelManager({
      modelRoot: join(baseDir, 'models'),
      store,
      catalog: DEFAULT_MODEL_CATALOG,
      probeFetch: fetchImpl,
      nowMs: (() => {
        let value = 1_000;
        return () => {
          value += 1_000;
          return value;
        };
      })()
    });

    const result = await manager.probeModelDownload('funasr-nano-int8-2025-12-30');

    expect(result).toMatchObject({
      modelId: 'funasr-nano-int8-2025-12-30',
      ok: true,
      supportsRange: true,
      downloadedBytes: 512 * 1024,
      totalBytes: 1024 * 1024,
      bytesPerSecond: 512 * 1024
    });
    expect(result.sourceLabel).toBeTruthy();
    expect(result.url).toContain('github.com');
  });

  it('returns a readable source diagnostic when the model speed probe fails', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'v2t-models-'));
    const store = await UserDataStore.create(join(baseDir, 'sync'), { deviceId: 'device-a' });
    const manager = new ModelManager({
      modelRoot: join(baseDir, 'models'),
      store,
      catalog: DEFAULT_MODEL_CATALOG,
      probeFetch: vi.fn(async () => ({
        ok: false,
        status: 504,
        statusText: 'Gateway Timeout',
        headers: new Headers(),
        arrayBuffer: async () => new ArrayBuffer(0)
      } as Response))
    });

    const result = await manager.probeModelDownload('funasr-nano-int8-2025-12-30');

    expect(result.ok).toBe(false);
    expect(result.status).toBe(504);
    expect(result.error).toContain('HTTP 504');
    expect(result.sourceLabel).toBeTruthy();
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

  it('marks interrupted installs as resumable instead of leaving them in progress', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'v2t-models-'));
    const modelRoot = join(baseDir, 'models');
    const store = await UserDataStore.create(join(baseDir, 'sync'), { deviceId: 'device-a' });
    await mkdir(modelRoot, { recursive: true });
    await writeFile(
      join(modelRoot, 'model-status.json'),
      JSON.stringify({
        'funasr-nano-int8-2025-12-30': {
          modelId: 'funasr-nano-int8-2025-12-30',
          status: 'downloading',
          progress: 13,
          downloadedBytes: 1024,
          updatedAt: '2026-04-25T00:00:00.000Z'
        }
      })
    );
    const manager = new ModelManager({ modelRoot, store, catalog: DEFAULT_MODEL_CATALOG });

    await manager.recoverInterruptedInstalls();

    const status = JSON.parse(await readFile(join(modelRoot, 'model-status.json'), 'utf8'));
    expect(status['funasr-nano-int8-2025-12-30']).toMatchObject({
      status: 'failed',
      canResume: true,
      error: expect.stringContaining('上次安装中断')
    });
  });

  it('imports a downloaded official archive as an installed model without activating it', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'v2t-models-'));
    const modelRoot = join(baseDir, 'models');
    const archivePath = join(baseDir, 'funasr.tar.bz2');
    await writeFile(archivePath, 'archive');
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
      modelRoot,
      store,
      catalog: [
        {
          ...DEFAULT_MODEL_CATALOG[0],
          checksum: undefined,
          requiredFiles: ['model.onnx'],
          extractedDir: 'imported-funasr',
          primaryModelFile: 'model.onnx'
        }
      ],
      extractor: async (_model, _archive, installDir) => {
        await mkdir(join(installDir, 'imported-funasr'), { recursive: true });
        await writeFile(join(installDir, 'imported-funasr', 'model.onnx'), 'model');
      },
      verifier: vi.fn().mockResolvedValue(undefined)
    });

    const result = await manager.importModelArchive('funasr-nano-int8-2025-12-30', archivePath);
    const settings = await store.loadSettings();
    const views = await manager.listInstalledModelViews(settings);

    expect(result).toMatchObject({
      modelId: 'funasr-nano-int8-2025-12-30',
      status: 'installed',
      progress: 100
    });
    expect(result.modelPath).toContain('imported-funasr');
    expect(settings.providers.asr.modelId).toBe('sensevoice-onnx-int8-2025-09-09');
    expect(views).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          modelId: 'funasr-nano-int8-2025-12-30',
          current: false,
          canActivate: true
        })
      ])
    );
  });

  it('extracts tar.bz2 model archives in-process instead of requiring system bzip2', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'v2t-models-'));
    const modelRoot = join(baseDir, 'models');
    const archivePath = join(baseDir, 'funasr.tar.bz2');
    const archiveFixture =
      'QlpoOTFBWSZTWZ1xTsMAAP3/sf+4A4BUB//iO2b9cO///0AAQA5AAQIACEACXAYgBwDCMJpiGAQDIAYRpkyYRgIaCSSZTZKMmmgGjQDTRkNDQaGgZABoBwDCMJpiGAQDIAYRpkyYRgIaBUlE01T1M00aaZGqeo8p6m9KYE002kZkR6NE02k9NT2qeVsOdOdP9fWaWnWtW8dLWhOVvPhgj5sjcdhYRvqRyKZGZhWkm6pIsUg6WhY0qE1fnmnLgjbrMJ9EsZ0ok2SkY1PIpMhcSxesO1XIrA4HnebzYEnceBYm0mVKTMllVSsae1dN5M+fJfZZdc+DadC5cl6ZE4U5E600p1Jf32qz6Jcap+Ke9pZF9YardZ5aJzLUsCXE86Uno/bmycGfCneJSbCZxgwThtSySU5kYgLSFZGkSKooxE0hbo1EwzaJOJ0B7mYVQjORPwYKBPzBZUidhMpc4pgZNUGa6Zb6UXCguWcVAqTiWQqB8hPTniclEqzERPQOHKGMUMN19ymVe+5Oo3nsex7jU9b6r3gfw9p4nU6XSfe2WhY/L5fq5nyU+LCtWtZicS58Ws2mN41J2p834MSdpOxL0tS1M51vWtTrYTnMCk6HQlOJThdhrSm0nWmJP3TGnoTuTKwJwOVvGhMqdzuc/L/1cbvJsJrTcTvySkxJuSTfLU30zppmJPeTcTCmBONqWpoTQba9KTLu5c3isxJxJYlG6nG2SZmMvOFNtrTfTFOBSYWYwprUjyGyWI/8XckU4UJCdcU7DA==';
    await writeFile(archivePath, Buffer.from(archiveFixture, 'base64'));
    const store = await UserDataStore.create(join(baseDir, 'sync'), { deviceId: 'device-a' });
    const manager = new ModelManager({
      modelRoot,
      store,
      catalog: [
        {
          ...DEFAULT_MODEL_CATALOG[0],
          checksum: undefined,
          requiredFiles: ['model.onnx'],
          extractedDir: 'sherpa-onnx-funasr-nano-int8-2025-12-30',
          primaryModelFile: 'model.onnx'
        }
      ],
      verifier: vi.fn().mockResolvedValue(undefined)
    });

    const result = await manager.importModelArchive('funasr-nano-int8-2025-12-30', archivePath);
    const source = await readFile(new URL('../src/core/modelManager.ts', import.meta.url), 'utf8');

    expect(result.status).toBe('installed');
    expect(
      await readFile(
        join(
          modelRoot,
          'funasr-nano-int8-2025-12-30',
          'sherpa-onnx-funasr-nano-int8-2025-12-30',
          'model.onnx'
        ),
        'utf8'
      )
    ).toBe('model');
    expect(source).not.toContain("execFileAsync('tar'");
  });

  it('rejects importing a directory with missing model files and keeps the active model', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'v2t-models-'));
    const modelRoot = join(baseDir, 'models');
    const sourceDir = join(baseDir, 'source-model');
    await mkdir(sourceDir, { recursive: true });
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
      modelRoot,
      store,
      catalog: [
        {
          ...DEFAULT_MODEL_CATALOG[0],
          requiredFiles: ['model.onnx'],
          extractedDir: 'imported-funasr',
          primaryModelFile: 'model.onnx'
        }
      ]
    });

    await expect(manager.importModelDirectory('funasr-nano-int8-2025-12-30', sourceDir)).rejects.toThrow('模型文件');
    const settings = await store.loadSettings();
    const statuses = await manager.getStatuses();

    expect(settings.providers.asr.modelId).toBe('sensevoice-onnx-int8-2025-09-09');
    expect(statuses['funasr-nano-int8-2025-12-30']).toBeUndefined();
  });

  it('clears failed install residue without deleting the current model', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'v2t-models-'));
    const modelRoot = join(baseDir, 'models');
    const modelId = 'funasr-nano-int8-2025-12-30';
    const store = await UserDataStore.create(join(baseDir, 'sync'), { deviceId: 'device-a' });
    await mkdir(join(modelRoot, 'downloads'), { recursive: true });
    await mkdir(join(modelRoot, `${modelId}.download`), { recursive: true });
    await writeFile(join(modelRoot, 'downloads', `${modelId}.tar.bz2.part`), 'partial');
    await writeFile(
      join(modelRoot, 'model-status.json'),
      JSON.stringify({
        [modelId]: {
          modelId,
          status: 'failed',
          isInterrupted: true,
          canResume: true,
          error: '上次安装中断',
          updatedAt: '2026-04-26T00:00:00.000Z'
        }
      })
    );
    const manager = new ModelManager({ modelRoot, store, catalog: DEFAULT_MODEL_CATALOG });

    const result = await manager.clearModelInstall(modelId);
    const statuses = await manager.getStatuses();

    expect(result.status).toBe('not-installed');
    expect(statuses[modelId]).toBeUndefined();
    await expect(stat(join(modelRoot, `${modelId}.download`))).rejects.toThrow();
    await expect(stat(join(modelRoot, 'downloads', `${modelId}.tar.bz2.part`))).rejects.toThrow();
  });

  it('reinstalls the current model without replacing it when verification fails', async () => {
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
          modelPath: '/previous/current/model'
        }
      }
    });
    const manager = new ModelManager({
      modelRoot: join(baseDir, 'models'),
      store,
      catalog: DEFAULT_MODEL_CATALOG,
      downloader: vi.fn().mockResolvedValue(undefined),
      extractor: vi.fn().mockResolvedValue(undefined),
      verifier: vi.fn().mockRejectedValue(new Error('smoke test failed'))
    });

    await expect(manager.reinstallModel('sensevoice-onnx-int8-2025-09-09')).rejects.toThrow('smoke test failed');
    const settings = await store.loadSettings();

    expect(settings.providers.asr.modelId).toBe('sensevoice-onnx-int8-2025-09-09');
    expect(settings.providers.asr.modelPath).toBe('/previous/current/model');
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

function createPcm16Wav(samples: number[], sampleRate: number): Buffer {
  const bytesPerSample = 2;
  const dataSize = samples.length * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * bytesPerSample, 28);
  buffer.writeUInt16LE(bytesPerSample, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataSize, 40);
  samples.forEach((sample, index) => buffer.writeInt16LE(sample, 44 + index * bytesPerSample));
  return buffer;
}
