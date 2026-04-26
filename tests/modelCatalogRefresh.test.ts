import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_MODEL_CATALOG } from '../src/core/modelCatalog';
import { ModelCatalogRefreshService, mergeRemoteModelCatalog } from '../src/core/modelCatalogRefresh';

describe('ModelCatalogRefreshService', () => {
  it('merges remote Chinese benchmark metadata into the local catalog', async () => {
    const merged = mergeRemoteModelCatalog(DEFAULT_MODEL_CATALOG, {
      version: '2026-04-26.zh',
      updatedAt: '2026-04-26T00:00:00.000Z',
      models: [
        {
          id: 'sensevoice-onnx-int8-2025-09-09',
          evaluationSources: {
            chineseBenchmark: {
              sourceLabel: 'Remote Chinese ASR catalog',
              sourceUrl: 'https://example.com/catalog.json',
              note: '中文优先刷新数据',
              metrics: [{ label: 'Fleurs-zh', metric: 'CER', value: 3.2, lowerIsBetter: true }]
            }
          }
        }
      ]
    });

    expect(merged.catalog.find((model) => model.id === 'sensevoice-onnx-int8-2025-09-09')?.evaluationSources?.chineseBenchmark).toMatchObject({
      sourceLabel: 'Remote Chinese ASR catalog',
      metrics: [expect.objectContaining({ label: 'Fleurs-zh', metric: 'CER', value: 3.2 })]
    });
    expect(merged.addedModelIds).toEqual([]);
  });

  it('does not promote unverified remote models into one-click installable models', () => {
    const merged = mergeRemoteModelCatalog(DEFAULT_MODEL_CATALOG, {
      version: '2026-04-26.zh',
      updatedAt: '2026-04-26T00:00:00.000Z',
      models: [
        {
          id: 'unverified-qwen3-asr',
          name: 'Unverified Qwen3 ASR',
          family: 'qwen3-asr',
          releasedAt: '2026-04-26',
          installable: true,
          runtimeVerified: false,
          availability: 'installable',
          runtime: 'sherpa-onnx',
          sourceUrl: 'https://example.com/qwen3.tar.bz2',
          license: 'Apache-2.0',
          sizeMb: 600,
          languages: ['中文', '英文'],
          qualityTags: ['中文优先'],
          hardwareRequirements: { minMemoryGb: 16, recommendedTier: 'high' },
          archiveType: 'tar.bz2',
          extractedDir: 'qwen3',
          primaryModelFile: 'model.onnx',
          requiredFiles: ['model.onnx'],
          evaluationSources: {
            chineseBenchmark: {
              sourceLabel: 'Remote Chinese ASR catalog',
              sourceUrl: 'https://example.com/catalog.json',
              metrics: [{ label: 'Mandarin public avg', metric: 'CER', value: 1.2, lowerIsBetter: true }]
            }
          }
        }
      ]
    });

    const model = merged.catalog.find((item) => item.id === 'unverified-qwen3-asr');

    expect(model).toMatchObject({
      installable: false,
      availability: 'manual',
      unavailableReason: expect.stringContaining('V2T 尚未完成一键运行验证')
    });
  });

  it('refreshes from the remote catalog and caches the result without blocking fallback', async () => {
    const root = await mkdtemp(join(tmpdir(), 'v2t-catalog-refresh-'));
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        version: '2026-04-26.zh',
        updatedAt: '2026-04-26T00:00:00.000Z',
        models: [
          {
            id: 'funasr-nano-int8-2025-12-30',
            evaluationSources: {
              chineseBenchmark: {
                sourceLabel: 'Remote Chinese ASR catalog',
                sourceUrl: 'https://example.com/catalog.json',
                metrics: [{ label: 'Mandarin public avg', metric: 'CER', value: 4.55, lowerIsBetter: true }]
              }
            }
          }
        ]
      })
    }));
    const service = new ModelCatalogRefreshService({
      cachePath: join(root, 'model-catalog-cache.json'),
      remoteUrl: 'https://example.com/catalog.json',
      fetchImpl,
      now: () => new Date('2026-04-26T01:00:00.000Z')
    });

    const refreshed = await service.refresh(DEFAULT_MODEL_CATALOG);
    const cached = JSON.parse(await readFile(join(root, 'model-catalog-cache.json'), 'utf8')) as { version: string };

    expect(fetchImpl).toHaveBeenCalledWith('https://example.com/catalog.json', expect.any(Object));
    expect(refreshed.state.status).toBe('success');
    expect(refreshed.state.catalogVersion).toBe('2026-04-26.zh');
    expect(cached.version).toBe('2026-04-26.zh');
    expect(refreshed.catalog.find((model) => model.id === 'funasr-nano-int8-2025-12-30')?.evaluationSources?.chineseBenchmark?.metrics[0]?.value).toBe(4.55);
  });

  it('reports the remote URL and HTTP status when catalog refresh fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'v2t-catalog-refresh-'));
    const service = new ModelCatalogRefreshService({
      cachePath: join(root, 'model-catalog-cache.json'),
      remoteUrl: 'https://raw.githubusercontent.com/example/private/catalog.json',
      fetchImpl: vi.fn(async () => ({
        ok: false,
        status: 404,
        json: async () => ({})
      })),
      now: () => new Date('2026-04-26T01:00:00.000Z')
    });

    const refreshed = await service.refresh(DEFAULT_MODEL_CATALOG);

    expect(refreshed.state.status).toBe('failed');
    expect(refreshed.state.sourceUrl).toBe('https://raw.githubusercontent.com/example/private/catalog.json');
    expect(refreshed.state.error).toContain('HTTP 404');
    expect(refreshed.state.error).toContain('https://raw.githubusercontent.com/example/private/catalog.json');
  });

  it('falls back to the GitHub Contents API when the raw catalog request fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'v2t-catalog-refresh-'));
    const remoteCatalog = {
      version: '2026-04-26.github-api',
      updatedAt: '2026-04-26T02:00:00.000Z',
      models: [
        {
          id: 'sensevoice-onnx-int8-2025-09-09',
          evaluationSources: {
            chineseBenchmark: {
              sourceLabel: 'GitHub Contents API catalog',
              sourceUrl: 'https://api.github.com/repos/Medill-East/AI-Voice-To-Text/contents/catalog/v2t-model-catalog.json',
              metrics: [{ label: 'AIShell-1', metric: 'CER', value: 3.1, lowerIsBetter: true }]
            }
          }
        }
      ]
    };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({})
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          encoding: 'base64',
          content: Buffer.from(JSON.stringify(remoteCatalog), 'utf8').toString('base64')
        })
      });
    const service = new ModelCatalogRefreshService({
      cachePath: join(root, 'model-catalog-cache.json'),
      remoteUrl: 'https://raw.githubusercontent.com/Medill-East/AI-Voice-To-Text/main/catalog/v2t-model-catalog.json',
      fetchImpl,
      now: () => new Date('2026-04-26T02:01:00.000Z')
    });

    const refreshed = await service.refresh(DEFAULT_MODEL_CATALOG);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[1]?.[0]).toBe(
      'https://api.github.com/repos/Medill-East/AI-Voice-To-Text/contents/catalog/v2t-model-catalog.json?ref=main'
    );
    expect(refreshed.state.status).toBe('success');
    expect(refreshed.state.sourceUrl).toContain('api.github.com');
    expect(refreshed.state.attempts).toEqual([
      expect.objectContaining({ method: 'raw', ok: false, status: 404 }),
      expect.objectContaining({ method: 'github-api', ok: true, status: 200 })
    ]);
    expect(refreshed.catalog.find((model) => model.id === 'sensevoice-onnx-int8-2025-09-09')?.evaluationSources?.chineseBenchmark?.sourceLabel).toBe(
      'GitHub Contents API catalog'
    );
  });

  it('uses cached catalog data and exposes failed attempts when all remote sources fail', async () => {
    const root = await mkdtemp(join(tmpdir(), 'v2t-catalog-refresh-'));
    await writeFile(
      join(root, 'model-catalog-cache.json'),
      JSON.stringify({
        version: '2026-04-26.cached',
        updatedAt: '2026-04-26T01:30:00.000Z',
        models: [
          {
            id: 'funasr-nano-int8-2025-12-30',
            evaluationSources: {
              chineseBenchmark: {
                sourceLabel: 'Cached catalog',
                sourceUrl: 'https://example.com/cache',
                metrics: [{ label: 'Cached Mandarin CER', metric: 'CER', value: 4.2, lowerIsBetter: true }]
              }
            }
          }
        ]
      })
    );
    const service = new ModelCatalogRefreshService({
      cachePath: join(root, 'model-catalog-cache.json'),
      remoteUrl: 'https://raw.githubusercontent.com/Medill-East/AI-Voice-To-Text/main/catalog/v2t-model-catalog.json',
      fetchImpl: vi.fn(async () => ({
        ok: false,
        status: 404,
        json: async () => ({})
      })),
      now: () => new Date('2026-04-26T02:02:00.000Z')
    });

    const refreshed = await service.refresh(DEFAULT_MODEL_CATALOG);

    expect(refreshed.state.status).toBe('failed');
    expect(refreshed.state.cacheUsed).toBe(true);
    expect(refreshed.state.cacheUpdatedAt).toBe('2026-04-26T01:30:00.000Z');
    expect(refreshed.state.message).toContain('本地缓存');
    expect(refreshed.state.attempts?.map((attempt) => attempt.method)).toEqual(['raw', 'github-api']);
    expect(refreshed.catalog.find((model) => model.id === 'funasr-nano-int8-2025-12-30')?.evaluationSources?.chineseBenchmark?.sourceLabel).toBe(
      'Cached catalog'
    );
  });
});
