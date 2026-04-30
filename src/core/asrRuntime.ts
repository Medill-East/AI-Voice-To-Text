import type { AsrBackendStatus, AsrRuntimeProvider, AsrThreadSetting, Settings } from './types';

export interface ResolvedAsrRuntime {
  provider: AsrRuntimeProvider;
  providerLabel: string;
  numThreads: number;
  threadSetting: AsrThreadSetting;
  gpuEnabled: boolean;
  backendStatus: AsrBackendStatus;
  unavailableReason?: string;
}

export const DEFAULT_ASR_RUNTIME = {
  provider: 'cpu',
  numThreads: 'auto',
  cudaExperimental: false
} as const;

export const LOCAL_SHERPA_RUNTIME = {
  provider: 'cpu',
  providerLabel: 'CPU',
  numThreads: 2,
  gpuEnabled: false
} as const;

export function resolveAsrNumThreads(setting: AsrThreadSetting | undefined, cpuCores?: number): number {
  if (typeof setting === 'number') {
    return setting;
  }
  const cores = typeof cpuCores === 'number' && Number.isFinite(cpuCores) ? cpuCores : 4;
  return Math.min(6, Math.max(2, Math.floor(cores / 2)));
}

export function resolveLocalSherpaRuntime(
  runtime: Settings['providers']['asr']['runtime'] | undefined,
  options: { cpuCores?: number; platform?: NodeJS.Platform; cudaRuntimeAvailable?: boolean; cudaUnavailableReason?: string } = {}
): ResolvedAsrRuntime {
  const configured = {
    ...DEFAULT_ASR_RUNTIME,
    ...(runtime ?? {})
  };
  const numThreads = resolveAsrNumThreads(configured.numThreads, options.cpuCores);
  if (configured.provider === 'cuda' && configured.cudaExperimental) {
    if (options.platform === 'win32' && options.cudaRuntimeAvailable) {
      return {
        provider: 'cuda',
        providerLabel: 'CUDA',
        numThreads,
        threadSetting: configured.numThreads,
        gpuEnabled: true,
        backendStatus: 'cuda-experimental-active'
      };
    }
    return {
      provider: 'cpu',
      providerLabel: 'CPU',
      numThreads,
      threadSetting: configured.numThreads,
      gpuEnabled: false,
      backendStatus: 'cuda-experimental-unavailable',
      unavailableReason: options.cudaUnavailableReason ?? '未检测到可用的 Windows CUDA sherpa-onnx runtime。'
    };
  }
  return {
    provider: 'cpu',
    providerLabel: 'CPU',
    numThreads,
    threadSetting: configured.numThreads,
    gpuEnabled: false,
    backendStatus: 'cpu-stable'
  };
}

export function localSherpaRuntimeLabel(runtime?: ResolvedAsrRuntime): string {
  const resolved = runtime ?? resolveLocalSherpaRuntime(undefined);
  return `${resolved.providerLabel} · ${resolved.numThreads} 线程`;
}
