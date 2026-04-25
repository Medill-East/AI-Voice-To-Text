import { createHash } from 'node:crypto';
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { InstalledModelView, ModelCatalogItem, ModelInstallStatus, ModelStatusRecord, Settings, SherpaModelType } from './types';
import type { UserDataStore } from './userDataStore';

const execFileAsync = promisify(execFile);

interface ModelManagerOptions {
  modelRoot: string;
  store: UserDataStore;
  catalog: ModelCatalogItem[];
  downloader?: (model: ModelCatalogItem, archivePath: string) => Promise<void>;
  extractor?: (model: ModelCatalogItem, archivePath: string, installDir: string) => Promise<void>;
  verifier?: (model: ModelCatalogItem, installDir: string) => Promise<void>;
}

export class ModelManager {
  private readonly modelRoot: string;
  private readonly store: UserDataStore;
  private readonly catalog: ModelCatalogItem[];
  private readonly downloader: (model: ModelCatalogItem, archivePath: string) => Promise<void>;
  private readonly extractor: (model: ModelCatalogItem, archivePath: string, installDir: string) => Promise<void>;
  private readonly verifier: (model: ModelCatalogItem, installDir: string) => Promise<void>;

  constructor(options: ModelManagerOptions) {
    this.modelRoot = options.modelRoot;
    this.store = options.store;
    this.catalog = options.catalog;
    this.downloader = options.downloader ?? downloadModelArchive;
    this.extractor = options.extractor ?? extractModelArchive;
    this.verifier = options.verifier ?? verifyModelFiles;
  }

  async installAndActivate(modelId: string): Promise<ModelStatusRecord> {
    const model = this.getModel(modelId);
    if (!model.installable || model.runtime === 'whisper-cpp' || !model.sherpaModelType) {
      throw new Error('这个模型暂时不能一键安装。请先选择推荐列表里的可安装模型。');
    }
    const installDir = this.modelInstallDir(model);
    const tempDir = `${installDir}.download`;
    const archivePath = join(this.modelRoot, 'downloads', `${model.id}.${model.archiveType === 'file' ? 'bin' : 'tar.bz2'}`);

    await mkdir(dirname(archivePath), { recursive: true });
    await this.writeStatus(model.id, { status: 'downloading', progress: 0 });

    try {
      await rm(tempDir, { recursive: true, force: true });
      await mkdir(tempDir, { recursive: true });
      await this.downloader(model, archivePath);
      await this.extractor(model, archivePath, tempDir);
      await this.verifier(model, tempDir);
      await rm(installDir, { recursive: true, force: true });
      await rename(tempDir, installDir);

      const modelPath = join(installDir, model.extractedDir, model.primaryModelFile);
      const settings = await this.store.loadSettings();
      await this.store.saveSettings({
        ...settings,
        providers: {
          ...settings.providers,
          asr: {
            ...settings.providers.asr,
            kind: model.runtime === 'sherpa-onnx' ? 'local-sherpa-onnx' : 'whisper-cpp',
            modelId: model.id,
            modelPath,
            sherpaModelType: model.sherpaModelType,
            language: settings.providers.asr.language ?? 'zh'
          }
        }
      });

      return this.writeStatus(model.id, { status: 'current', progress: 100, modelPath });
    } catch (error) {
      await rm(tempDir, { recursive: true, force: true });
      await this.writeStatus(model.id, {
        status: 'failed',
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  async getStatuses(): Promise<Record<string, ModelStatusRecord>> {
    const statusPath = this.statusPath();
    if (!existsSync(statusPath)) {
      return {};
    }
    return JSON.parse(await readFile(statusPath, 'utf8')) as Record<string, ModelStatusRecord>;
  }

  async listInstalledModels(): Promise<ModelStatusRecord[]> {
    return Object.values(await this.getStatuses()).filter((record) => record.status === 'installed' || record.status === 'current');
  }

  async listInstalledModelViews(settings: Settings): Promise<InstalledModelView[]> {
    const statuses = await this.getStatuses();
    const ids = new Set(
      Object.values(statuses)
        .filter((record) => record.status === 'installed' || record.status === 'current')
        .map((record) => record.modelId)
    );

    if (settings.providers.asr.modelId) {
      ids.add(settings.providers.asr.modelId);
    }

    return [...ids].map((modelId) => {
      const catalogModel = this.findModel(modelId);
      const record = statuses[modelId];
      const modelPath = record?.modelPath ?? (settings.providers.asr.modelId === modelId ? settings.providers.asr.modelPath : undefined);
      const current = settings.providers.asr.modelId === modelId;
      const sherpaModelType = catalogModel?.sherpaModelType ?? inferSherpaModelType(modelId, modelPath);
      return {
        modelId,
        name: catalogModel?.name ?? legacyModelName(modelId),
        status: current ? 'current' : record?.status ?? 'installed',
        modelPath,
        current,
        legacy: !catalogModel,
        canActivate: !current && Boolean(modelPath && sherpaModelType),
        canDelete: !current
      };
    });
  }

  async activateInstalledModel(modelId: string): Promise<ModelStatusRecord> {
    const statuses = await this.getStatuses();
    const record = statuses[modelId];
    const model = this.findModel(modelId);
    const modelPath = record?.modelPath ?? (model ? this.getModelPath(modelId) : undefined);
    const sherpaModelType = model?.sherpaModelType ?? inferSherpaModelType(modelId, modelPath);

    if (!modelPath || !sherpaModelType) {
      throw new Error('这个旧模型缺少路径或运行类型，暂时不能直接启用。');
    }

    const settings = await this.store.loadSettings();
    await this.store.saveSettings({
      ...settings,
      providers: {
        ...settings.providers,
        asr: {
          ...settings.providers.asr,
          kind: 'local-sherpa-onnx',
          modelId,
          modelPath,
          sherpaModelType,
          language: settings.providers.asr.language ?? 'zh'
        }
      }
    });

    return this.writeStatus(modelId, { status: 'current', progress: 100, modelPath });
  }

  async deleteModel(modelId: string): Promise<ModelStatusRecord> {
    const settings = await this.store.loadSettings();
    if (settings.providers.asr.modelId === modelId) {
      throw new Error('当前正在使用这个模型。请先切换到另一个模型，再删除它。');
    }

    const model = this.findModel(modelId);
    await rm(model ? this.modelInstallDir(model) : join(this.modelRoot, modelId), { recursive: true, force: true });
    const statuses = await this.getStatuses();
    delete statuses[modelId];
    await this.writeStatuses(statuses);

    return {
      modelId,
      status: 'not-installed',
      updatedAt: new Date().toISOString()
    };
  }

  getModelPath(modelId: string): string {
    const model = this.getModel(modelId);
    return join(this.modelInstallDir(model), model.extractedDir, model.primaryModelFile);
  }

  private getModel(modelId: string): ModelCatalogItem {
    const model = this.findModel(modelId);
    if (!model) {
      throw new Error(`Unknown model: ${modelId}`);
    }
    return model;
  }

  private findModel(modelId: string): ModelCatalogItem | undefined {
    return this.catalog.find((item) => item.id === modelId);
  }

  private modelInstallDir(model: ModelCatalogItem): string {
    return join(this.modelRoot, model.id);
  }

  private statusPath(): string {
    return join(this.modelRoot, 'model-status.json');
  }

  private async writeStatus(
    modelId: string,
    value: Omit<ModelStatusRecord, 'modelId' | 'updatedAt'>
  ): Promise<ModelStatusRecord> {
    await mkdir(this.modelRoot, { recursive: true });
    const statuses = await this.getStatuses();
    const record: ModelStatusRecord = {
      modelId,
      updatedAt: new Date().toISOString(),
      ...value
    };
    statuses[modelId] = record;
    await this.writeStatuses(statuses);
    return record;
  }

  private async writeStatuses(statuses: Record<string, ModelStatusRecord>): Promise<void> {
    await mkdir(this.modelRoot, { recursive: true });
    await writeFile(this.statusPath(), `${JSON.stringify(statuses, null, 2)}\n`, 'utf8');
  }
}

function inferSherpaModelType(modelId: string, modelPath?: string): SherpaModelType | undefined {
  const value = `${modelId} ${modelPath ?? ''}`.toLowerCase();
  if (value.includes('sensevoice') || value.includes('sense-voice')) {
    return 'senseVoice';
  }
  if (value.includes('funasr-nano') || value.includes('fun-asr-nano')) {
    return 'funasrNano';
  }
  if (value.includes('firered')) {
    return 'fireRedAsr';
  }
  return undefined;
}

function legacyModelName(modelId: string): string {
  const lower = modelId.toLowerCase();
  const year = lower.match(/20\d{2}/)?.[0];
  if (lower.includes('sensevoice')) {
    return `SenseVoice ONNX int8${year ? ` ${year}` : ''}`;
  }
  return modelId
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(' ');
}

async function downloadModelArchive(model: ModelCatalogItem, archivePath: string): Promise<void> {
  const response = await fetch(model.sourceUrl);
  if (!response.ok || !response.body) {
    throw new Error(`模型下载失败：${response.status} ${response.statusText}`);
  }

  await mkdir(dirname(archivePath), { recursive: true });
  const file = createWriteStream(archivePath);
  const reader = response.body.getReader();

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    file.write(Buffer.from(value));
  }

  await new Promise<void>((resolve, reject) => {
    file.end((error?: Error | null) => (error ? reject(error) : resolve()));
  });

  if (model.checksum) {
    const digest = createHash('sha256').update(await readFile(archivePath)).digest('hex');
    if (digest !== model.checksum) {
      throw new Error('模型校验失败：下载文件与预期 checksum 不一致');
    }
  }
}

async function extractModelArchive(model: ModelCatalogItem, archivePath: string, installDir: string): Promise<void> {
  if (model.archiveType === 'file') {
    const target = join(installDir, model.extractedDir, model.primaryModelFile);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, await readFile(archivePath));
    return;
  }

  await execFileAsync('tar', ['-xjf', archivePath, '-C', installDir]);
}

async function verifyModelFiles(model: ModelCatalogItem, installDir: string): Promise<void> {
  for (const file of model.requiredFiles) {
    const filePath = join(installDir, model.extractedDir, file);
    const fileStat = await stat(filePath);
    if (fileStat.size <= 0) {
      throw new Error(`模型文件为空：${file}`);
    }
  }
}
