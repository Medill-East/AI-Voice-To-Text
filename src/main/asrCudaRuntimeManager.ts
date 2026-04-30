import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { spawn, type ChildProcess } from 'node:child_process';
import * as tar from 'tar';
import unbzip2Stream from 'unbzip2-stream';
import type {
  AsrCudaInstallProgress,
  AsrCudaRuntimeCatalogItem,
  AsrCudaRuntimeStatus,
  Settings
} from '../core/types';
import { SHERPA_WINDOWS_CUDA_DOCS_URL } from './asrCudaDiagnostics';

interface RuntimeState {
  runtimeId?: string;
  version?: string;
  runtimePath?: string;
  installStatus?: AsrCudaRuntimeStatus['installStatus'];
  smokeTestPassed?: boolean;
  smokeTestedAt?: string;
  lastError?: string;
  installProgress?: AsrCudaInstallProgress;
}

interface AsrCudaRuntimeManagerOptions {
  userDataDir: string;
  platform?: NodeJS.Platform;
  arch?: NodeJS.Architecture;
  fetchImpl?: typeof fetch;
  spawnProcess?: typeof spawn;
}

const RUNTIME_KIND = 'sherpa-onnx-cuda';
const STATE_FILE = 'runtime-status.json';

export const BUILTIN_CUDA_RUNTIME_CATALOG: AsrCudaRuntimeCatalogItem[] = [
  {
    id: 'sherpa-onnx-v1.12.39-win-x64-cuda',
    version: '1.12.39',
    sherpaVersion: '1.12.39',
    platform: 'win32',
    arch: 'x64',
    sourceLabel: 'sherpa-onnx official SourceForge mirror',
    sourceUrl: 'https://sourceforge.net/projects/sherpa-onnx.mirror/files/v1.12.39/sherpa-onnx-v1.12.39-win-x64-cuda.tar.bz2/download',
    docsUrl: SHERPA_WINDOWS_CUDA_DOCS_URL,
    archiveType: 'tar.bz2',
    sizeMb: 120,
    requiredFiles: ['sherpa-onnx-offline.exe', 'onnxruntime.dll', 'onnxruntime_providers_cuda.dll']
  }
];

export class AsrCudaRuntimeManager {
  private readonly userDataDir: string;
  private readonly platform: NodeJS.Platform;
  private readonly arch: NodeJS.Architecture;
  private readonly fetchImpl: typeof fetch;
  private readonly spawnProcess: typeof spawn;
  private activeController: AbortController | undefined;
  private activeChild: ChildProcess | undefined;

  constructor(options: AsrCudaRuntimeManagerOptions) {
    this.userDataDir = options.userDataDir;
    this.platform = options.platform ?? process.platform;
    this.arch = options.arch ?? process.arch;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.spawnProcess = options.spawnProcess ?? spawn;
  }

  runtimeRoot(): string {
    return join(this.userDataDir, 'runtimes', RUNTIME_KIND);
  }

  downloadDir(): string {
    return join(this.runtimeRoot(), '.download');
  }

  archivePath(item = this.catalogItem()): string | undefined {
    return item ? join(this.downloadDir(), `${item.id}.tar.bz2`) : undefined;
  }

  statePath(): string {
    return join(this.runtimeRoot(), STATE_FILE);
  }

  catalogItem(): AsrCudaRuntimeCatalogItem | undefined {
    if (this.platform !== 'win32' || this.arch !== 'x64') {
      return undefined;
    }
    return BUILTIN_CUDA_RUNTIME_CATALOG[0];
  }

  async getStatus(settings?: Settings): Promise<AsrCudaRuntimeStatus> {
    const item = this.catalogItem();
    const state = await this.readState();
    const expectedRuntimePath = item ? join(this.runtimeRoot(), item.id) : undefined;
    const runtimePath = state.runtimePath ?? expectedRuntimePath;
    const missingFiles = item && runtimePath ? await missingRequiredFiles(runtimePath, item.requiredFiles) : item?.requiredFiles ?? [];
    const hasRuntimeFiles = Boolean(item && runtimePath && missingFiles.length === 0);
    const active =
      Boolean(settings?.providers.asr.runtime.provider === 'cuda' && settings.providers.asr.runtime.cudaExperimental) &&
      Boolean(settings?.providers.asr.runtime.cudaRuntimeId && settings.providers.asr.runtime.cudaRuntimeId === (state.runtimeId ?? item?.id));

    const installStatus = active
      ? 'active'
      : hasRuntimeFiles && state.smokeTestPassed
        ? 'ready'
        : hasRuntimeFiles
          ? 'installed-unverified'
          : state.installStatus === 'downloading' || state.installStatus === 'extracting' || state.installStatus === 'verifying' || state.installStatus === 'failed'
            ? state.installStatus
            : 'not-installed';

    return {
      installStatus,
      runtimeRoot: this.runtimeRoot(),
      runtimePath: hasRuntimeFiles ? runtimePath : state.runtimePath,
      expectedRuntimePath,
      downloadUrl: item?.sourceUrl,
      downloadSourceLabel: item?.sourceLabel,
      archivePath: this.archivePath(item),
      downloadDir: this.downloadDir(),
      catalogItem: item,
      installedRuntimeId: state.runtimeId,
      installedVersion: state.version,
      hasRuntimeFiles,
      missingFiles,
      smokeTestPassed: Boolean(hasRuntimeFiles && state.smokeTestPassed),
      smokeTestedAt: state.smokeTestedAt,
      lastError: state.lastError,
      canInstall: Boolean(item),
      canCancel: Boolean(this.activeController),
      canClear: hasRuntimeFiles || Boolean(state.runtimeId) || state.installStatus === 'failed',
      canSmokeTest: hasRuntimeFiles,
      installProgress: state.installProgress
    };
  }

  async install(options: { onProgress?: (progress: AsrCudaInstallProgress) => void } = {}): Promise<AsrCudaRuntimeStatus> {
    const item = this.catalogItem();
    if (!item) {
      throw new Error('当前平台没有可安装的 V2T CUDA runtime。');
    }

    this.cancel();
    const controller = new AbortController();
    this.activeController = controller;
    const runtimeDir = join(this.runtimeRoot(), item.id);
    const downloadDir = this.downloadDir();
    const archivePath = this.archivePath(item) ?? join(downloadDir, `${item.id}.tar.bz2`);

    try {
      await rm(runtimeDir, { recursive: true, force: true });
      await mkdir(downloadDir, { recursive: true });
      await mkdir(runtimeDir, { recursive: true });
      await this.updateState({ runtimeId: item.id, version: item.version, runtimePath: runtimeDir, installStatus: 'downloading' }, options.onProgress, {
        runtimeId: item.id,
        phase: 'downloading',
        sourceUrl: item.sourceUrl,
        sourceLabel: item.sourceLabel,
        archivePath,
        runtimePath: runtimeDir,
        message: '正在下载 V2T CUDA 后端'
      });

      await this.download(item, archivePath, controller, options.onProgress);

      await this.updateState({ installStatus: 'extracting' }, options.onProgress, {
        runtimeId: item.id,
        phase: 'extracting',
        sourceUrl: item.sourceUrl,
        sourceLabel: item.sourceLabel,
        archivePath,
        runtimePath: runtimeDir,
        message: '正在解压 CUDA runtime'
      });
      await extractArchive(archivePath, runtimeDir);

      await this.updateState({ installStatus: 'verifying' }, options.onProgress, {
        runtimeId: item.id,
        phase: 'verifying',
        sourceUrl: item.sourceUrl,
        sourceLabel: item.sourceLabel,
        archivePath,
        runtimePath: runtimeDir,
        message: '正在校验 runtime 文件'
      });
      await this.verifyChecksum(item, archivePath);
      await assertRequiredFiles(runtimeDir, item.requiredFiles);
      await this.runSmokeTest();
      return this.getStatus();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.updateState({ installStatus: 'failed', lastError: message }, options.onProgress, {
        runtimeId: item.id,
        phase: controller.signal.aborted ? 'cancelled' : 'failed',
        sourceUrl: item.sourceUrl,
        sourceLabel: item.sourceLabel,
        archivePath,
        runtimePath: runtimeDir,
        message
      });
      throw error;
    } finally {
      if (this.activeController === controller) {
        this.activeController = undefined;
      }
    }
  }

  cancel(): void {
    this.activeController?.abort();
    this.activeChild?.kill();
    this.activeController = undefined;
    this.activeChild = undefined;
  }

  async clear(): Promise<AsrCudaRuntimeStatus> {
    this.cancel();
    await rm(this.runtimeRoot(), { recursive: true, force: true });
    return this.getStatus();
  }

  async runSmokeTest(): Promise<AsrCudaRuntimeStatus> {
    const item = this.catalogItem();
    if (!item) {
      throw new Error('当前平台没有可验证的 CUDA runtime。');
    }
    const state = await this.readState();
    const runtimePath = state.runtimePath ?? join(this.runtimeRoot(), item.id);
    const exe = await findFileByName(runtimePath, 'sherpa-onnx-offline.exe');
    if (!exe) {
      throw new Error('CUDA runtime 缺少 sherpa-onnx-offline.exe，无法 smoke test。');
    }
    await runHelpSmokeTest(exe, this.spawnProcess, (child) => {
      this.activeChild = child;
    });
    await this.updateState({
      runtimeId: item.id,
      version: item.version,
      runtimePath,
      installStatus: 'ready',
      smokeTestPassed: true,
      smokeTestedAt: new Date().toISOString(),
      lastError: undefined
    });
    return this.getStatus();
  }

  private async download(
    item: AsrCudaRuntimeCatalogItem,
    targetPath: string,
    controller: AbortController,
    onProgress?: (progress: AsrCudaInstallProgress) => void
  ): Promise<void> {
    const response = await this.fetchImpl(item.sourceUrl, { signal: controller.signal });
    if (!response.ok || !response.body) {
      throw new Error(`CUDA runtime 下载失败：HTTP ${response.status} ${response.statusText}`);
    }
    const totalBytes = Number(response.headers.get('content-length')) || undefined;
    const writer = createWriteStream(targetPath);
    let downloadedBytes = 0;
    const startedAt = Date.now();
    const reader = response.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        if (controller.signal.aborted) {
          throw new Error('CUDA runtime 下载已取消');
        }
        downloadedBytes += value.byteLength;
        if (!writer.write(Buffer.from(value))) {
          await new Promise<void>((resolveDrain) => writer.once('drain', resolveDrain));
        }
        const elapsedSeconds = Math.max(1, (Date.now() - startedAt) / 1000);
        const progress: AsrCudaInstallProgress = {
          runtimeId: item.id,
          phase: 'downloading',
          sourceUrl: item.sourceUrl,
          sourceLabel: item.sourceLabel,
          archivePath: targetPath,
          runtimePath: join(this.runtimeRoot(), item.id),
          downloadedBytes,
          totalBytes,
          percent: totalBytes ? Math.min(100, (downloadedBytes / totalBytes) * 100) : undefined,
          bytesPerSecond: downloadedBytes / elapsedSeconds,
          message: '正在下载 V2T CUDA 后端'
        };
        await this.writeProgress(progress);
        onProgress?.(progress);
      }
    } finally {
      writer.end();
    }
    await new Promise<void>((resolveFinish, rejectFinish) => {
      writer.on('finish', resolveFinish);
      writer.on('error', rejectFinish);
    });
  }

  private async verifyChecksum(item: AsrCudaRuntimeCatalogItem, archivePath: string): Promise<void> {
    if (!item.checksum) {
      return;
    }
    const digest = createHash('sha256').update(await readFile(archivePath)).digest('hex');
    if (digest !== item.checksum) {
      throw new Error('CUDA runtime 校验失败：下载文件与预期 SHA256 不一致。');
    }
  }

  private async readState(): Promise<RuntimeState> {
    try {
      return JSON.parse(await readFile(this.statePath(), 'utf8')) as RuntimeState;
    } catch {
      return {};
    }
  }

  private async updateState(state: Partial<RuntimeState>, onProgress?: (progress: AsrCudaInstallProgress) => void, progress?: AsrCudaInstallProgress): Promise<void> {
    const current = await this.readState();
    const next = { ...current, ...state, installProgress: progress ?? state.installProgress ?? current.installProgress };
    await mkdir(dirname(this.statePath()), { recursive: true });
    await writeFile(this.statePath(), `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    if (progress) {
      onProgress?.(progress);
    }
  }

  private async writeProgress(progress: AsrCudaInstallProgress): Promise<void> {
    const current = await this.readState();
    await this.updateState({ ...current, installProgress: progress });
  }
}

async function extractArchive(archivePath: string, runtimeDir: string): Promise<void> {
  await pipeline(createReadStream(archivePath), unbzip2Stream(), tar.x({ cwd: runtimeDir }));
}

async function assertRequiredFiles(runtimePath: string, requiredFiles: string[]): Promise<void> {
  const missing = await missingRequiredFiles(runtimePath, requiredFiles);
  if (missing.length > 0) {
    throw new Error(`CUDA runtime 文件不完整，缺少：${missing.join(', ')}`);
  }
}

async function missingRequiredFiles(runtimePath: string, requiredFiles: string[]): Promise<string[]> {
  const missing: string[] = [];
  for (const file of requiredFiles) {
    if (!(await findFileByName(runtimePath, file))) {
      missing.push(file);
    }
  }
  return missing;
}

async function findFileByName(root: string, fileName: string, depth = 0): Promise<string | undefined> {
  if (depth > 5 || !existsSync(root)) {
    return undefined;
  }
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    return undefined;
  }
  for (const entry of entries) {
    const path = join(root, entry);
    const entryStat = await stat(path).catch(() => undefined);
    if (!entryStat) {
      continue;
    }
    if (entryStat.isFile() && entry.toLowerCase() === fileName.toLowerCase()) {
      return path;
    }
    if (entryStat.isDirectory()) {
      const found = await findFileByName(path, fileName, depth + 1);
      if (found) {
        return found;
      }
    }
  }
  return undefined;
}

async function runHelpSmokeTest(exePath: string, spawnProcess: typeof spawn, onChild: (child: ChildProcess) => void): Promise<void> {
  await new Promise<void>((resolveSmoke, rejectSmoke) => {
    const child = spawnProcess(resolve(exePath), ['--help'], {
      cwd: dirname(exePath),
      windowsHide: true,
      env: process.env
    });
    onChild(child);
    let output = '';
    const timeout = setTimeout(() => {
      child.kill();
      rejectSmoke(new Error('CUDA runtime smoke test 超时。'));
    }, 8_000);
    child.stdout?.on('data', (chunk) => {
      output += String(chunk);
    });
    child.stderr?.on('data', (chunk) => {
      output += String(chunk);
    });
    child.on('error', (error) => {
      clearTimeout(timeout);
      rejectSmoke(new Error(`CUDA runtime smoke test 启动失败：${error.message}`));
    });
    child.on('exit', (code) => {
      clearTimeout(timeout);
      if (code === 0 || /sherpa|usage|help|onnx/i.test(output)) {
        resolveSmoke();
        return;
      }
      rejectSmoke(new Error(`CUDA runtime smoke test 失败：exit=${code ?? 'none'} ${output.trim()}`));
    });
  });
}
