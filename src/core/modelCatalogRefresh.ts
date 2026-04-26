import { readFile, writeFile } from 'node:fs/promises';
import type { ModelCatalogItem, ModelCatalogRefreshState } from './types';

export const DEFAULT_REMOTE_MODEL_CATALOG_URL =
  'https://raw.githubusercontent.com/Medill-East/AI-Voice-To-Text/main/catalog/v2t-model-catalog.json';

export interface RemoteModelCatalog {
  version: string;
  updatedAt: string;
  sourceUrl?: string;
  models: Array<Partial<ModelCatalogItem> & { id: string }>;
}

export interface CatalogMergeResult {
  catalog: ModelCatalogItem[];
  addedModelIds: string[];
}

interface RefreshServiceOptions {
  cachePath: string;
  remoteUrl?: string;
  fetchImpl?: CatalogFetch;
  now?: () => Date;
}

type CatalogFetch = (
  input: string,
  init?: RequestInit
) => Promise<{
  ok: boolean;
  status?: number;
  json(): Promise<unknown>;
}>;

export class ModelCatalogRefreshService {
  private readonly cachePath: string;
  private readonly remoteUrl: string;
  private readonly fetchImpl: CatalogFetch;
  private readonly now: () => Date;

  constructor(options: RefreshServiceOptions) {
    this.cachePath = options.cachePath;
    this.remoteUrl = options.remoteUrl ?? DEFAULT_REMOTE_MODEL_CATALOG_URL;
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
    this.now = options.now ?? (() => new Date());
  }

  async loadCachedCatalog(baseCatalog: ModelCatalogItem[]): Promise<{ catalog: ModelCatalogItem[]; state: ModelCatalogRefreshState }> {
    try {
      const cached = parseRemoteCatalog(JSON.parse(await readFile(this.cachePath, 'utf8')));
      const merged = mergeRemoteModelCatalog(baseCatalog, cached);
      return {
        catalog: merged.catalog,
        state: {
          status: 'success',
          catalogVersion: cached.version,
          sourceUrl: cached.sourceUrl ?? this.remoteUrl,
          updatedAt: cached.updatedAt,
          addedModelIds: merged.addedModelIds,
          message: '已加载本地缓存的模型榜单'
        }
      };
    } catch {
      return {
        catalog: baseCatalog,
        state: {
          status: 'idle',
          sourceUrl: this.remoteUrl,
          message: '使用内置模型榜单'
        }
      };
    }
  }

  async refresh(baseCatalog: ModelCatalogItem[]): Promise<{ catalog: ModelCatalogItem[]; state: ModelCatalogRefreshState }> {
    try {
      const response = await this.fetchImpl(this.remoteUrl, { cache: 'no-store' });
      if (!response.ok) {
        throw new Error(`远程模型榜单请求失败：HTTP ${response.status} ${this.remoteUrl}`);
      }
      const remote = parseRemoteCatalog(await response.json());
      await writeFile(this.cachePath, JSON.stringify(remote, null, 2), 'utf8');
      const merged = mergeRemoteModelCatalog(baseCatalog, remote);
      return {
        catalog: merged.catalog,
        state: {
          status: 'success',
          catalogVersion: remote.version,
          sourceUrl: remote.sourceUrl ?? this.remoteUrl,
          updatedAt: remote.updatedAt,
          lastRefreshAt: this.now().toISOString(),
          addedModelIds: merged.addedModelIds,
          message: merged.addedModelIds.length > 0 ? `新增 ${merged.addedModelIds.length} 个模型参考` : '模型榜单已是最新'
        }
      };
    } catch (error) {
      return {
        catalog: baseCatalog,
        state: {
          status: 'failed',
          sourceUrl: this.remoteUrl,
          lastRefreshAt: this.now().toISOString(),
          error: readableError(error),
          message: '刷新失败，继续使用内置模型榜单'
        }
      };
    }
  }
}

export function mergeRemoteModelCatalog(baseCatalog: ModelCatalogItem[], remote: RemoteModelCatalog): CatalogMergeResult {
  const byId = new Map(baseCatalog.map((model) => [model.id, model]));
  const addedModelIds: string[] = [];

  for (const patch of remote.models) {
    const existing = byId.get(patch.id);
    if (existing) {
      const merged = { ...existing, ...mergeModelFields(existing, patch) };
      byId.set(patch.id, patch.installable === true ? normalizeRemoteModel(merged) : merged);
      continue;
    }

    if (!isCompleteCatalogItem(patch)) {
      continue;
    }

    addedModelIds.push(patch.id);
    byId.set(patch.id, normalizeRemoteModel(patch));
  }

  return { catalog: [...byId.values()], addedModelIds };
}

function mergeModelFields(existing: ModelCatalogItem, patch: Partial<ModelCatalogItem>): Partial<ModelCatalogItem> {
  return {
    ...patch,
    hardwareRequirements: {
      ...existing.hardwareRequirements,
      ...patch.hardwareRequirements
    },
    benchmarks: patch.benchmarks ? { ...(existing.benchmarks ?? patch.benchmarks), ...patch.benchmarks } : existing.benchmarks,
    evaluationSources: {
      ...existing.evaluationSources,
      ...patch.evaluationSources
    }
  };
}

function normalizeRemoteModel<T extends ModelCatalogItem>(model: T): T {
  if (model.installable && !isRuntimeVerifiedOneClickModel(model)) {
    return {
      ...model,
      installable: false,
      availability: 'manual',
      unavailableReason: appendReason(model.unavailableReason, 'V2T 尚未完成一键运行验证，暂不进入一键安装。')
    };
  }
  return model;
}

function isRuntimeVerifiedOneClickModel(model: ModelCatalogItem): boolean {
  if (model.runtimeVerified !== true) {
    return false;
  }
  if (!model.sourceUrl || model.requiredFiles.length === 0 || !model.checksum) {
    return false;
  }
  if (model.runtime === 'sherpa-onnx' && !model.sherpaModelType) {
    return false;
  }
  return true;
}

function appendReason(current: string | undefined, reason: string): string {
  if (!current) {
    return reason;
  }
  return current.includes(reason) ? current : `${current} ${reason}`;
}

function parseRemoteCatalog(value: unknown): RemoteModelCatalog {
  if (!value || typeof value !== 'object') {
    throw new Error('远程模型榜单格式无效');
  }
  const candidate = value as Partial<RemoteModelCatalog>;
  if (!candidate.version || !candidate.updatedAt || !Array.isArray(candidate.models)) {
    throw new Error('远程模型榜单缺少 version、updatedAt 或 models');
  }
  return {
    version: candidate.version,
    updatedAt: candidate.updatedAt,
    sourceUrl: candidate.sourceUrl,
    models: candidate.models
  };
}

function isCompleteCatalogItem(value: Partial<ModelCatalogItem> & { id: string }): value is ModelCatalogItem {
  return Boolean(
    value.name &&
      value.family &&
      value.releasedAt &&
      value.runtime &&
      value.sourceUrl &&
      value.license &&
      value.hardwareRequirements &&
      value.archiveType &&
      value.languages &&
      value.qualityTags &&
      value.requiredFiles &&
      value.extractedDir !== undefined &&
      value.primaryModelFile !== undefined &&
      typeof value.installable === 'boolean' &&
      typeof value.sizeMb === 'number'
  );
}

function readableError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
