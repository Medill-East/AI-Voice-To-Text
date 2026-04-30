import { readdirSync, statSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import type { AsrCudaStatus, AsrBackendStatus, Settings } from '../core/types';

export const SHERPA_WINDOWS_CUDA_DOCS_URL = 'https://k2-fsa.github.io/sherpa/onnx/install/windows.html#build-sherpa-onnx-on-windows-with-nvidia-gpu';
export const NVIDIA_CUDA_DOWNLOAD_URL = 'https://developer.nvidia.com/cuda-downloads';

interface DetectCudaOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  spawn?: typeof spawnSync;
  sherpaCudaRuntimeAvailable?: boolean;
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
      diagnostic: 'CUDA 实验后端第一阶段只支持 Windows NVIDIA GPU。',
      recommendedAction: '当前平台继续使用 CPU 后端；macOS 暂不承诺 Metal。'
    });
  }

  const nvidia = detectNvidiaGpu(options.spawn ?? spawnSync);
  const cudaFiles = findCudaRuntimeDlls(env);
  const sherpaCudaRuntimeAvailable = options.sherpaCudaRuntimeAvailable ?? env.V2T_SHERPA_ONNX_CUDA_RUNTIME === '1';
  const missing: string[] = [];
  if (!nvidia.available) {
    missing.push('未检测到 NVIDIA GPU 或 nvidia-smi');
  }
  if (cudaFiles.dlls.length === 0) {
    missing.push('未检测到 CUDA runtime DLL');
  }
  if (!sherpaCudaRuntimeAvailable) {
    missing.push('当前 V2T 包未包含可验证的 sherpa-onnx CUDA runtime');
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
    diagnostic: missing.length > 0 ? missing.join('；') : 'CUDA 检测通过，可执行实验启用和输出测速。',
    recommendedAction: missing.length > 0
      ? '按缺失项安装 NVIDIA 驱动/CUDA，并等待 V2T 提供 CUDA runtime 包或手动接入可验证 runtime。'
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
