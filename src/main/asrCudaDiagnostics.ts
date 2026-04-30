import { readdirSync, statSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import type { AsrCudaRuntimeStatus, AsrCudaStatus, AsrBackendStatus, Settings } from '../core/types';

export const SHERPA_WINDOWS_CUDA_DOCS_URL = 'https://k2-fsa.github.io/sherpa/onnx/install/windows.html#build-sherpa-onnx-on-windows-with-nvidia-gpu';
export const NVIDIA_CUDA_DOWNLOAD_URL = 'https://developer.nvidia.com/cuda-downloads';

interface DetectCudaOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  spawn?: typeof spawnSync;
  sherpaCudaRuntimeAvailable?: boolean;
  runtimeStatus?: AsrCudaRuntimeStatus;
}

interface NvidiaInfo {
  available: boolean;
  gpuName?: string;
  driverVersion?: string;
  error?: string;
}

export function detectAsrCudaStatus(settings: Settings, options: DetectCudaOptions = {}): AsrCudaStatus {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const checkedAt = new Date().toISOString();
  const activeRequested = settings.providers.asr.runtime.provider === 'cuda' && settings.providers.asr.runtime.cudaExperimental;

  if (platform !== 'win32') {
    return createStatus({
      platform,
      checkedAt,
      backendStatus: 'cuda-experimental-unavailable',
      active: false,
      canEnable: false,
      nvidiaGpuDetected: false,
      nvidiaSmiAvailable: false,
      cudaRuntimeDlls: [],
      sherpaCudaRuntimeAvailable: false,
      runtime: options.runtimeStatus ?? emptyRuntimeStatus(),
      diagnostic: 'CUDA 实验后端第一阶段只支持 Windows NVIDIA GPU。',
      recommendedAction: '当前平台继续使用 CPU 后端；macOS 暂不承诺 Metal。'
    });
  }

  const nvidia = detectNvidiaGpu(options.spawn ?? spawnSync);
  const cudaFiles = findCudaRuntimeDlls(env);
  const runtimeStatus = options.runtimeStatus ?? emptyRuntimeStatus();
  const sherpaCudaRuntimeAvailable = options.runtimeStatus
    ? runtimeStatus.smokeTestPassed
    : options.sherpaCudaRuntimeAvailable ?? env.V2T_SHERPA_ONNX_CUDA_RUNTIME === '1';
  const missing: string[] = [];
  if (!nvidia.available) {
    missing.push('未检测到 NVIDIA GPU 或 nvidia-smi');
  }
  if (cudaFiles.dlls.length === 0) {
    missing.push('未检测到 CUDA runtime DLL');
  }
  if (!sherpaCudaRuntimeAvailable) {
    if (!options.runtimeStatus) {
      missing.push('当前 V2T 包未包含可验证的 sherpa-onnx CUDA runtime');
    } else if (runtimeStatus.hasRuntimeFiles) {
      missing.push('V2T CUDA runtime 已安装，但尚未通过 smoke test');
    } else if (runtimeStatus.canInstall) {
      missing.push('未安装 V2T CUDA runtime，可一键安装后验证');
    } else {
      missing.push('当前没有兼容的 V2T CUDA runtime 可下载');
    }
  }

  const canEnable = nvidia.available && cudaFiles.dlls.length > 0 && sherpaCudaRuntimeAvailable;
  const backendStatus: AsrBackendStatus = activeRequested && canEnable
    ? 'cuda-experimental-active'
    : canEnable
      ? 'cuda-experimental-available'
      : 'cuda-experimental-unavailable';

  return createStatus({
    platform,
    checkedAt,
    backendStatus,
    active: backendStatus === 'cuda-experimental-active',
    canEnable,
    nvidiaGpuDetected: nvidia.available,
    nvidiaSmiAvailable: nvidia.available,
    gpuName: nvidia.gpuName,
    driverVersion: nvidia.driverVersion,
    cudaPath: cudaFiles.cudaPath,
    cudaRuntimeDlls: cudaFiles.dlls,
    sherpaCudaRuntimeAvailable,
    runtime: runtimeStatus,
    diagnostic: missing.length > 0 ? missing.join('；') : 'CUDA 检测通过，可执行实验启用和输出测速。',
    recommendedAction: missing.length > 0
      ? cudaRecommendedAction(nvidia.available, cudaFiles.dlls.length > 0, runtimeStatus)
      : '可以点击“启用实验 CUDA”，随后用输出测速确认是否真的更快。'
  });
}

function createStatus(status: Omit<AsrCudaStatus, 'docsUrl' | 'cudaDownloadUrl'>): AsrCudaStatus {
  return {
    ...status,
    docsUrl: SHERPA_WINDOWS_CUDA_DOCS_URL,
    cudaDownloadUrl: NVIDIA_CUDA_DOWNLOAD_URL
  };
}

function cudaRecommendedAction(gpuReady: boolean, cudaReady: boolean, runtimeStatus: AsrCudaRuntimeStatus): string {
  if (!gpuReady) {
    return '先确认已安装 NVIDIA 驱动，并且 nvidia-smi 可用。';
  }
  if (!cudaReady) {
    return '安装 NVIDIA CUDA runtime 后重新检测；V2T 不会静默安装系统组件。';
  }
  if (runtimeStatus.hasRuntimeFiles && !runtimeStatus.smokeTestPassed) {
    return '点击“运行 smoke test”，通过后才能启用实验 CUDA。';
  }
  if (runtimeStatus.canInstall) {
    return '点击“安装 CUDA 后端”下载 V2T CUDA runtime，再运行 smoke test。';
  }
  return '当前没有兼容 runtime 可下载，继续使用 CPU 后端。';
}

function emptyRuntimeStatus(): AsrCudaRuntimeStatus {
  return {
    installStatus: 'not-installed',
    runtimeRoot: '',
    hasRuntimeFiles: false,
    missingFiles: [],
    smokeTestPassed: false,
    canInstall: false,
    canCancel: false,
    canClear: false,
    canSmokeTest: false
  };
}

function detectNvidiaGpu(spawn: typeof spawnSync): NvidiaInfo {
  const result = spawn('nvidia-smi', ['--query-gpu=name,driver_version', '--format=csv,noheader'], {
    encoding: 'utf8',
    timeout: 2500,
    windowsHide: true
  });
  if (result.error || result.status !== 0) {
    return { available: false, error: result.error?.message ?? result.stderr?.toString() };
  }
  const firstLine = String(result.stdout ?? '').split(/\r?\n/).map((line) => line.trim()).find(Boolean);
  if (!firstLine) {
    return { available: false, error: 'nvidia-smi 没有返回 GPU 信息' };
  }
  const [gpuName, driverVersion] = firstLine.split(',').map((part) => part.trim());
  return {
    available: Boolean(gpuName),
    gpuName,
    driverVersion
  };
}

function findCudaRuntimeDlls(env: NodeJS.ProcessEnv): { cudaPath?: string; dlls: string[] } {
  const candidates = new Set<string>();
  for (const [key, value] of Object.entries(env)) {
    if (/^CUDA_PATH/i.test(key) && value) {
      candidates.add(value);
      candidates.add(join(value, 'bin'));
    }
  }
  const pathValue = env.PATH ?? env.Path ?? env.path ?? '';
  for (const entry of pathValue.split(delimiter)) {
    if (entry) {
      candidates.add(entry);
    }
  }

  const dlls = new Set<string>();
  let cudaPath: string | undefined;
  for (const candidate of candidates) {
    if (!isDirectory(candidate)) {
      continue;
    }
    for (const file of safeReadDir(candidate)) {
      if (/^(cudart64|cublas64|cublasLt64|cudnn64).*\.dll$/i.test(file)) {
        dlls.add(join(candidate, file));
        cudaPath ??= candidate;
      }
    }
  }
  return { cudaPath, dlls: [...dlls].sort() };
}

function safeReadDir(path: string): string[] {
  try {
    return readdirSync(path);
  } catch {
    return [];
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
