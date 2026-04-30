export const LOCAL_SHERPA_RUNTIME = {
  provider: 'cpu',
  providerLabel: 'CPU',
  numThreads: 2,
  gpuEnabled: false
} as const;

export function localSherpaRuntimeLabel(): string {
  return `${LOCAL_SHERPA_RUNTIME.providerLabel} · ${LOCAL_SHERPA_RUNTIME.numThreads} 线程`;
}
