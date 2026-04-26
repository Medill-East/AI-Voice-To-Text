import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { CloudLlmCatalogService, sortCloudLlmModels } from '../src/core/cloudLlmCatalog';

describe('CloudLlmCatalogService', () => {
  it('refreshes OpenRouter models and marks free text models', async () => {
    const cachePath = join(await mkdtemp(join(tmpdir(), 'v2t-cloud-llm-')), 'models.json');
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        data: [
          {
            id: 'qwen/qwen3.6-plus',
            name: 'Qwen3.6 Plus',
            description: 'Chinese and English text model',
            created: 1777000000,
            context_length: 131072,
            pricing: { prompt: '0', completion: '0' },
            architecture: { input_modalities: ['text'], output_modalities: ['text'] }
          }
        ]
      })
    }));
    const service = new CloudLlmCatalogService({ cachePath, fetchImpl: fetchImpl as never });

    const state = await service.refresh();

    expect(state.status).toBe('success');
    expect(state.models[0]).toMatchObject({
      id: 'qwen/qwen3.6-plus',
      name: 'Qwen3.6 Plus',
      isFree: true,
      contextLength: 131072
    });
    expect(await readFile(cachePath, 'utf8')).toContain('qwen/qwen3.6-plus');
  });

  it('falls back to cached models when refresh fails', async () => {
    const cachePath = join(await mkdtemp(join(tmpdir(), 'v2t-cloud-llm-')), 'models.json');
    const okService = new CloudLlmCatalogService({
      cachePath,
      fetchImpl: vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ data: [{ id: 'openrouter/free', name: 'Free Router', pricing: { prompt: '0', completion: '0' } }] })
      })) as never
    });
    await okService.refresh();

    const failedService = new CloudLlmCatalogService({
      cachePath,
      fetchImpl: vi.fn(async () => {
        throw new Error('network down');
      }) as never
    });
    const state = await failedService.refresh();

    expect(state.status).toBe('failed');
    expect(state.cacheUsed).toBe(true);
    expect(state.models[0].id).toBe('openrouter/free');
    expect(state.error).toContain('network down');
  });
});

describe('sortCloudLlmModels', () => {
  it('supports recommendation, performance, name, release date and price sorting', () => {
    const models = [
      {
        id: 'zeta/free',
        name: 'Zeta Free',
        isFree: true,
        createdAt: '2026-01-01T00:00:00.000Z',
        contextLength: 4096,
        promptPrice: 0,
        completionPrice: 0,
        recommended: true,
        performanceScore: 40,
        recommendationScore: 70
      },
      {
        id: 'qwen/pro',
        name: 'Qwen Pro',
        isFree: false,
        createdAt: '2026-04-01T00:00:00.000Z',
        contextLength: 131072,
        promptPrice: 0.1,
        completionPrice: 0.2,
        recommended: true,
        performanceScore: 90,
        recommendationScore: 95
      }
    ];

    expect(sortCloudLlmModels(models, 'recommended')[0].id).toBe('qwen/pro');
    expect(sortCloudLlmModels(models, 'performance')[0].id).toBe('qwen/pro');
    expect(sortCloudLlmModels(models, 'name')[0].id).toBe('qwen/pro');
    expect(sortCloudLlmModels(models, 'releasedAt')[0].id).toBe('qwen/pro');
    expect(sortCloudLlmModels(models, 'price')[0].id).toBe('zeta/free');
  });
});
