import { createHash } from 'node:crypto';
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import { dirname, join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type {
  InstalledModelView,
  ModelCatalogItem,
  ModelDownloadProbeResult,
  ModelDownloadSource,
  ModelInstallStatus,
  ModelStatusRecord,
  Settings,
  SherpaModelType
} from './types';
import type { UserDataStore } from './userDataStore';
import { LocalSherpaAsrProvider } from './asrProviders';

const execFileAsync = promisify(execFile);
const DOWNLOAD_STALL_TIMEOUT_MS = 30_000;
const activeInstallControllers = new Map<string, AbortController>();

interface DownloadProgress {
  progress?: number;
  downloadedBytes?: number;
  totalBytes?: number;
  bytesPerSecond?: number;
  etaSeconds?: number;
  sourceLabel?: string;
  attempt?: number;
  canResume?: boolean;
  startedAt?: string;
  lastProgressAt?: string;
}

interface DownloadOptions {
  signal?: AbortSignal;
  force?: boolean;
}

export type ModelInstallProgressCallback = (status: ModelStatusRecord) => void;

interface ModelManagerOptions {
  modelRoot: string;
  store: UserDataStore;
  catalog: ModelCatalogItem[];
  downloader?: (
    model: ModelCatalogItem,
    archivePath: string,
    onProgress?: (progress: DownloadProgress) => Promise<void> | void,
    options?: DownloadOptions
  ) => Promise<void>;
  extractor?: (model: ModelCatalogItem, archivePath: string, installDir: string) => Promise<void>;
  verifier?: (model: ModelCatalogItem, installDir: string) => Promise<void>;
  probeFetch?: typeof fetch;
  nowMs?: () => number;
}

export class ModelManager {
  private readonly modelRoot: string;
  private readonly store: UserDataStore;
  private readonly catalog: ModelCatalogItem[];
  private readonly downloader: (
    model: ModelCatalogItem,
    archivePath: string,
    onProgress?: (progress: DownloadProgress) => Promise<void> | void,
    options?: DownloadOptions
  ) => Promise<void>;
  private readonly extractor: (model: ModelCatalogItem, archivePath: string, installDir: string) => Promise<void>;
  private readonly verifier: (model: ModelCatalogItem, installDir: string) => Promise<void>;
  private readonly probeFetch: typeof fetch;
  private readonly nowMs: () => number;

  constructor(options: ModelManagerOptions) {
    this.modelRoot = options.modelRoot;
    this.store = options.store;
    this.catalog = options.catalog;
    this.downloader = options.downloader ?? downloadModelArchive;
    this.extractor = options.extractor ?? extractModelArchive;
    this.verifier = options.verifier ?? verifyModelFiles;
    this.probeFetch = options.probeFetch ?? fetch;
    this.nowMs = options.nowMs ?? (() => Date.now());
  }

  async installAndActivate(modelId: string, onProgress?: ModelInstallProgressCallback): Promise<ModelStatusRecord> {
    return this.installAndActivateInternal(modelId, onProgress, { forceDownload: false });
  }

  async reinstallModel(modelId: string, onProgress?: ModelInstallProgressCallback): Promise<ModelStatusRecord> {
    return this.installAndActivateInternal(modelId, onProgress, { forceDownload: true });
  }

  async cancelModelInstall(modelId: string): Promise<ModelStatusRecord> {
    activeInstallControllers.get(modelId)?.abort();
    return this.writeStatus(modelId, {
      status: 'failed',
      canResume: true,
      isInterrupted: true,
      error: '模型安装已取消，可继续下载或重新安装。'
    });
  }

  async recoverInterruptedInstalls(): Promise<void> {
    const statuses = await this.getStatuses();
    let changed = false;
    for (const [modelId, status] of Object.entries(statuses)) {
      if (isInstallInProgress(status.status)) {
        statuses[modelId] = {
          ...status,
          status: 'failed',
          canResume: true,
          isInterrupted: true,
          error: '上次安装中断，可继续下载或重新安装。',
          updatedAt: new Date().toISOString()
        };
        changed = true;
      }
    }
    if (changed) {
      await this.writeStatuses(statuses);
    }
  }

  private async installAndActivateInternal(
    modelId: string,
    onProgress: ModelInstallProgressCallback | undefined,
    options: { forceDownload: boolean }
  ): Promise<ModelStatusRecord> {
    const model = this.getModel(modelId);
    if (!model.installable || model.runtime === 'whisper-cpp' || !model.sherpaModelType) {
      throw new Error('这个模型暂时不能一键安装。请先选择推荐列表里的可安装模型。');
    }
    const installDir = this.modelInstallDir(model);
    const tempDir = `${installDir}.download`;
    const archivePath = join(this.modelRoot, 'downloads', `${model.id}.${model.archiveType === 'file' ? 'bin' : 'tar.bz2'}`);

    await mkdir(dirname(archivePath), { recursive: true });
    const startedAt = new Date().toISOString();
    const controller = new AbortController();
    activeInstallControllers.set(model.id, controller);
    await this.updateInstallStatus(model.id, { status: 'downloading', progress: 0, startedAt, canResume: true }, onProgress);

    try {
      await rm(tempDir, { recursive: true, force: true });
      await mkdir(tempDir, { recursive: true });
      await this.downloader(model, archivePath, async (progress) => {
        await this.updateInstallStatus(
          model.id,
          {
            status: 'downloading',
            progress: progress.progress,
            downloadedBytes: progress.downloadedBytes,
            totalBytes: progress.totalBytes,
            bytesPerSecond: progress.bytesPerSecond,
            etaSeconds: progress.etaSeconds,
            sourceLabel: progress.sourceLabel,
            attempt: progress.attempt,
            canResume: progress.canResume,
            startedAt: progress.startedAt ?? startedAt,
            lastProgressAt: progress.lastProgressAt
          },
          onProgress
        );
      }, { signal: controller.signal, force: options.forceDownload });
      await this.updateInstallStatus(model.id, { status: 'extracting', progress: 55 }, onProgress);
      await this.extractor(model, archivePath, tempDir);
      await this.updateInstallStatus(model.id, { status: 'verifying', progress: 75 }, onProgress);
      await this.verifier(model, tempDir);
      await this.updateInstallStatus(model.id, { status: 'activating', progress: 90 }, onProgress);
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

      return this.updateInstallStatus(model.id, { status: 'current', progress: 100, modelPath }, onProgress);
    } catch (error) {
      await rm(tempDir, { recursive: true, force: true });
      await this.updateInstallStatus(model.id, {
        status: 'failed',
        canResume: true,
        isInterrupted: controller.signal.aborted,
        error: controller.signal.aborted ? '模型安装已取消，可继续下载或重新安装。' : error instanceof Error ? error.message : String(error)
      }, onProgress);
      throw error;
    } finally {
      activeInstallControllers.delete(model.id);
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
        canDelete: !current,
        canReinstall: Boolean(catalogModel?.installable && catalogModel.sherpaModelType)
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

  async probeModelDownload(modelId: string): Promise<ModelDownloadProbeResult> {
    const model = this.getModel(modelId);
    const source = selectDownloadSources(model)[0];
    if (!source) {
      return {
        modelId,
        sourceLabel: '未配置下载源',
        url: model.sourceUrl,
        ok: false,
        supportsRange: false,
        durationMs: 0,
        error: '这个模型没有可测速的下载源。'
      };
    }

    return probeDownloadSource(model.id, source, this.probeFetch, this.nowMs);
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

  private async updateInstallStatus(
    modelId: string,
    value: Omit<ModelStatusRecord, 'modelId' | 'updatedAt'>,
    onProgress?: ModelInstallProgressCallback
  ): Promise<ModelStatusRecord> {
    const record = await this.writeStatus(modelId, value);
    onProgress?.(record);
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

function isInstallInProgress(status: ModelInstallStatus): boolean {
  return status === 'downloading' || status === 'extracting' || status === 'verifying' || status === 'activating';
}

async function downloadModelArchive(
  model: ModelCatalogItem,
  archivePath: string,
  onProgress?: (progress: DownloadProgress) => Promise<void> | void,
  options: DownloadOptions = {}
): Promise<void> {
  await mkdir(dirname(archivePath), { recursive: true });
  const partPath = `${archivePath}.part`;
  if (options.force) {
    await rm(archivePath, { force: true });
    await rm(partPath, { force: true });
  }

  if (existsSync(archivePath)) {
    const archiveStat = await stat(archivePath);
    if (archiveStat.size > 0) {
      await verifyArchiveChecksum(model, archivePath);
      await onProgress?.({
        downloadedBytes: archiveStat.size,
        totalBytes: archiveStat.size,
        progress: 50,
        sourceLabel: '本地缓存',
        canResume: false,
        lastProgressAt: new Date().toISOString()
      });
      return;
    }
  }

  const sources = selectDownloadSources(model);
  let lastError: unknown;

  for (let index = 0; index < sources.length; index += 1) {
    const source = sources[index];
    const attempt = index + 1;
    try {
      await downloadFromSource(model, source, archivePath, partPath, attempt, onProgress, options);
      await verifyArchiveChecksum(model, archivePath);
      return;
    } catch (error) {
      lastError = error;
      if (options.signal?.aborted) {
        throw error;
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError ?? '模型下载失败'));
}

async function downloadFromSource(
  model: ModelCatalogItem,
  source: ModelDownloadSource,
  archivePath: string,
  partPath: string,
  attempt: number,
  onProgress: ((progress: DownloadProgress) => Promise<void> | void) | undefined,
  options: DownloadOptions
): Promise<void> {
  const existingBytes = !options.force && existsSync(partPath) ? (await stat(partPath)).size : 0;
  const headers: Record<string, string> = {};
  if (existingBytes > 0) {
    headers.Range = `bytes=${existingBytes}-`;
  }
  const response = await fetch(source.url, { headers, signal: options.signal });
  if (!response.ok || !response.body) {
    throw new Error(`模型下载失败：${source.label} HTTP ${response.status} ${response.statusText}`);
  }

  const resumes = existingBytes > 0 && response.status === 206;
  if (existingBytes > 0 && !resumes) {
    await rm(partPath, { force: true });
  }

  const initialBytes = resumes ? existingBytes : 0;
  const totalBytes = totalBytesFromResponse(response, initialBytes);
  const startedAt = new Date();
  let downloadedBytes = initialBytes;
  const file = createWriteStream(partPath, { flags: resumes ? 'a' : 'w' });
  const reader = response.body.getReader();

  try {
    while (true) {
      const { done, value } = await readWithTimeout(reader);
      if (done) {
        break;
      }
      const chunk = Buffer.from(value);
      downloadedBytes += chunk.byteLength;
      if (!file.write(chunk)) {
        await once(file, 'drain');
      }
      const elapsedSeconds = Math.max(0.001, (Date.now() - startedAt.getTime()) / 1000);
      const sessionBytes = downloadedBytes - initialBytes;
      const bytesPerSecond = Math.max(0, Math.round(sessionBytes / elapsedSeconds));
      const remainingBytes = totalBytes ? Math.max(0, totalBytes - downloadedBytes) : undefined;
      await onProgress?.({
        downloadedBytes,
        totalBytes,
        bytesPerSecond,
        etaSeconds: remainingBytes !== undefined && bytesPerSecond > 0 ? Math.ceil(remainingBytes / bytesPerSecond) : undefined,
        progress: totalBytes ? Math.min(50, Math.round((downloadedBytes / totalBytes) * 50)) : undefined,
        sourceLabel: source.label,
        attempt,
        canResume: true,
        startedAt: startedAt.toISOString(),
        lastProgressAt: new Date().toISOString()
      });
    }
    await new Promise<void>((resolve, reject) => {
      file.end((error?: Error | null) => (error ? reject(error) : resolve()));
    });
    await rename(partPath, archivePath);
  } catch (error) {
    file.destroy();
    throw error;
  }
}

async function readWithTimeout(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<ReadableStreamReadResult<Uint8Array>> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      reader.read(),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error('模型下载长时间没有进度，请重试或切换下载源。')), DOWNLOAD_STALL_TIMEOUT_MS);
      })
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

function selectDownloadSources(model: ModelCatalogItem): ModelDownloadSource[] {
  const sources = [...(model.downloadSources ?? [])].sort((left, right) => (left.priority ?? 100) - (right.priority ?? 100));
  if (!sources.some((source) => source.url === model.sourceUrl)) {
    sources.push({ label: 'GitHub Release', url: model.sourceUrl, priority: 100 });
  }
  return sources;
}

async function probeDownloadSource(
  modelId: string,
  source: ModelDownloadSource,
  fetchImpl: typeof fetch,
  nowMs: () => number
): Promise<ModelDownloadProbeResult> {
  const startedAt = nowMs();
  try {
    const response = await fetchImpl(source.url, {
      headers: { Range: 'bytes=0-1048575' },
      cache: 'no-store'
    });
    const buffer = await response.arrayBuffer();
    const durationMs = Math.max(1, nowMs() - startedAt);
    const downloadedBytes = buffer.byteLength;
    const supportsRange = response.status === 206 || response.headers.get('accept-ranges')?.toLowerCase() === 'bytes';
    const totalBytes = totalBytesFromResponse(response, 0);
    const bytesPerSecond = Math.round(downloadedBytes / (durationMs / 1000));

    if (!response.ok) {
      return {
        modelId,
        sourceLabel: source.label,
        url: source.url,
        ok: false,
        status: response.status,
        supportsRange,
        downloadedBytes,
        totalBytes,
        bytesPerSecond,
        durationMs,
        error: `下载源测速失败：${source.label} HTTP ${response.status} ${response.statusText}`
      };
    }

    return {
      modelId,
      sourceLabel: source.label,
      url: source.url,
      ok: true,
      status: response.status,
      supportsRange,
      downloadedBytes,
      totalBytes,
      bytesPerSecond,
      durationMs
    };
  } catch (error) {
    return {
      modelId,
      sourceLabel: source.label,
      url: source.url,
      ok: false,
      supportsRange: false,
      durationMs: Math.max(1, nowMs() - startedAt),
      error: `下载源测速失败：${error instanceof Error ? error.message : String(error)}`
    };
  }
}

function totalBytesFromResponse(response: Response, initialBytes: number): number | undefined {
  const contentRange = response.headers.get('content-range');
  const rangeTotal = contentRange?.match(/\/(\d+)$/)?.[1];
  if (rangeTotal) {
    return Number(rangeTotal);
  }
  const length = Number(response.headers.get('content-length')) || undefined;
  return length ? length + initialBytes : undefined;
}

async function verifyArchiveChecksum(model: ModelCatalogItem, archivePath: string): Promise<void> {
  if (!model.checksum) {
    return;
  }
  const digest = createHash('sha256').update(await readFile(archivePath)).digest('hex');
  if (digest !== model.checksum) {
    throw new Error('模型校验失败：下载文件与预期 checksum 不一致');
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

  await smokeTestInstalledModel(model, installDir);
}

async function smokeTestInstalledModel(model: ModelCatalogItem, installDir: string): Promise<void> {
  if (model.runtime !== 'sherpa-onnx' || !model.sherpaModelType) {
    return;
  }

  const extractedDir = join(installDir, model.extractedDir);
  const zhWavPath = join(extractedDir, 'test_wavs', 'zh.wav');
  if (!existsSync(zhWavPath)) {
    return;
  }

  try {
    const audio = await readFile(zhWavPath);
    const provider = new LocalSherpaAsrProvider({
      modelId: model.id,
      modelPath: join(extractedDir, model.primaryModelFile),
      sherpaModelType: model.sherpaModelType,
      language: 'zh'
    });
    const result = await provider.transcribe(audio);
    if (!result.text.trim() || /^\d+$/.test(result.text.trim())) {
      throw new Error('模型自检输出异常');
    }
  } catch (error) {
    throw new Error(`模型运行失败，请重新安装或选择其他模型：${error instanceof Error ? error.message : String(error)}`);
  }
}
