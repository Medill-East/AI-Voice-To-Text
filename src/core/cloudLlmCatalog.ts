import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { CloudLlmModelCatalogState, CloudLlmModelView } from './types';
export { sortCloudLlmModels } from './cloudLlmCatalogShared';

const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';

type FetchLike = typeof fetch;

interface CloudLlmCatalogOptions {
  cachePath: string;
  fetchImpl?: FetchLike;
}

interface OpenRouterModel {
  id?: string;
  name?: string;
  description?: string;
  created?: number;
  context_length?: number;
  pricing?: {
    prompt?: string;
    completion?: string;
  };
  architecture?: {
    input_modalities?: string[];
    output_modalities?: string[];
  };
}

interface CloudLlmCache {
  updatedAt: string;
  models: CloudLlmModelView[];
}

export class CloudLlmCatalogService {
  private readonly cachePath: string;
  private readonly fetchImpl: FetchLike;

  constructor(options: CloudLlmCatalogOptions) {
    this.cachePath = options.cachePath;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async loadCached(): Promise<CloudLlmModelCatalogState> {
    const cached = await this.readCache();
    return {
      status: cached ? 'success' : 'idle',
      sourceUrl: OPENROUTER_MODELS_URL,
      updatedAt: cached?.updatedAt,
      cacheUsed: Boolean(cached),
      models: cached?.models ?? builtinCloudLlmModels()
    };
  }

  async refresh(): Promise<CloudLlmModelCatalogState> {
    try {
      const response = await this.fetchImpl(OPENROUTER_MODELS_URL);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const payload = (await response.json()) as { data?: OpenRouterModel[] };
      const models = mergeWithBuiltinRecommendations((payload.data ?? []).map(toCloudLlmModelView).filter((model): model is CloudLlmModelView => Boolean(model)));
      const updatedAt = new Date().toISOString();
      await this.writeCache({ updatedAt, models });
      return {
        status: 'success',
        sourceUrl: OPENROUTER_MODELS_URL,
        updatedAt,
        cacheUsed: false,
        models
      };
    } catch (error) {
      const cached = await this.readCache();
      return {
        status: 'failed',
        sourceUrl: OPENROUTER_MODELS_URL,
        updatedAt: cached?.updatedAt,
        cacheUsed: Boolean(cached),
        error: readableError(error),
        models: cached ? mergeWithBuiltinRecommendations(cached.models) : builtinCloudLlmModels()
      };
    }
  }

  private async readCache(): Promise<CloudLlmCache | undefined> {
    if (!existsSync(this.cachePath)) {
      return undefined;
    }
    try {
      return JSON.parse(await readFile(this.cachePath, 'utf8')) as CloudLlmCache;
    } catch {
      return undefined;
    }
  }

  private async writeCache(cache: CloudLlmCache): Promise<void> {
    await mkdir(dirname(this.cachePath), { recursive: true });
    await writeFile(this.cachePath, `${JSON.stringify(cache, null, 2)}\n`, 'utf8');
  }
}

export function builtinCloudLlmModels(): CloudLlmModelView[] {
  return [
    {
      id: 'openrouter/free',
      name: 'OpenRouter Free Router',
      isFree: true,
      recommended: true,
      recommendationScore: 82,
      performanceScore: 65,
      promptPrice: 0,
      completionPrice: 0,
      modelUrl: 'https://openrouter.ai/openrouter/free',
      note: '免费路由，适合先试；模型可能变化或限流。'
    },
    {
      id: 'qwen/qwen3.6-plus',
      name: 'Qwen3.6 Plus',
      isFree: false,
      recommended: true,
      recommendationScore: 96,
      performanceScore: 92,
      modelUrl: 'https://openrouter.ai/models/qwen/qwen3.6-plus',
      note: '中文和中英混合整理优先候选。'
    },
    {
      id: 'google/gemma-4-31b-it:free',
      name: 'Gemma 4 31B Free',
      isFree: true,
      recommended: true,
      recommendationScore: 74,
      performanceScore: 78,
      promptPrice: 0,
      completionPrice: 0,
      modelUrl: 'https://openrouter.ai/models/google/gemma-4-31b-it:free',
      note: '免费多语言候选，中文效果需实际测试。'
    }
  ];
}

function mergeWithBuiltinRecommendations(models: CloudLlmModelView[]): CloudLlmModelView[] {
  const byId = new Map(models.map((model) => [model.id, model]));
  for (const builtin of builtinCloudLlmModels()) {
    const remote = byId.get(builtin.id);
    byId.set(builtin.id, remote ? { ...builtin, ...remote, recommended: true, recommendationScore: Math.max(remote.recommendationScore, builtin.recommendationScore) } : builtin);
  }
  return [...byId.values()];
}

function toCloudLlmModelView(model: OpenRouterModel): CloudLlmModelView | undefined {
  if (!model.id || !model.name) {
    return undefined;
  }
  const inputModalities = model.architecture?.input_modalities ?? ['text'];
  const outputModalities = model.architecture?.output_modalities ?? ['text'];
  if (!inputModalities.includes('text') || !outputModalities.includes('text')) {
    return undefined;
  }
  const promptPrice = parsePrice(model.pricing?.prompt);
  const completionPrice = parsePrice(model.pricing?.completion);
  const isFree = promptPrice === 0 && completionPrice === 0;
  const recommendationScore = scoreCloudLlm(model, isFree);
  return {
    id: model.id,
    name: model.name,
    description: model.description,
    createdAt: model.created ? new Date(model.created * 1000).toISOString() : undefined,
    contextLength: model.context_length,
    promptPrice,
    completionPrice,
    isFree,
    recommended: recommendationScore >= 70,
    recommendationScore,
    performanceScore: scoreCloudPerformance(model),
    modelUrl: `https://openrouter.ai/models/${model.id}`
  };
}

function scoreCloudLlm(model: OpenRouterModel, isFree: boolean): number {
  const haystack = `${model.id ?? ''} ${model.name ?? ''} ${model.description ?? ''}`.toLowerCase();
  let score = 35;
  if (haystack.includes('qwen')) score += 28;
  if (haystack.includes('deepseek')) score += 18;
  if (haystack.includes('gemini') || haystack.includes('gemma')) score += 14;
  if (haystack.includes('gpt') || haystack.includes('claude')) score += 12;
  if (haystack.includes('chinese') || haystack.includes('中文')) score += 14;
  if (haystack.includes('reasoning') || haystack.includes('thinking')) score -= 8;
  if (isFree) score += 8;
  if ((model.context_length ?? 0) >= 32768) score += 6;
  if (model.created && Date.now() / 1000 - model.created < 180 * 24 * 60 * 60) score += 5;
  return Math.max(0, Math.min(100, score));
}

function scoreCloudPerformance(model: OpenRouterModel): number {
  const haystack = `${model.id ?? ''} ${model.name ?? ''}`.toLowerCase();
  let score = 40;
  if (haystack.includes('plus') || haystack.includes('pro')) score += 18;
  if (haystack.includes('mini') || haystack.includes('nano')) score += 10;
  if ((model.context_length ?? 0) >= 65536) score += 10;
  if (haystack.includes('free')) score -= 4;
  return Math.max(0, Math.min(100, score));
}

function parsePrice(value?: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function readableError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
