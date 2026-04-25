import { cpus, platform, arch, totalmem } from 'node:os';
import type { HardwareProfile, RecommendedTier } from './types';

export function detectHardwareProfile(overrides: Partial<HardwareProfile> = {}): HardwareProfile {
  const cpuList = cpus();
  const memoryGb = Math.round((overrides.memoryGb ?? totalmem() / 1024 / 1024 / 1024) * 10) / 10;
  const cpuCores = overrides.cpuCores ?? cpuList.length;
  const cpuName = overrides.cpuName ?? cpuList[0]?.model ?? 'Unknown CPU';
  const currentPlatform = overrides.platform ?? platform();
  const currentArch = overrides.arch ?? arch();
  const isAppleSilicon = currentPlatform === 'darwin' && currentArch === 'arm64';
  const recommendedTier = overrides.recommendedTier ?? classifyTier(memoryGb, cpuCores, isAppleSilicon);

  return {
    platform: currentPlatform,
    arch: currentArch,
    cpuName,
    cpuCores,
    memoryGb,
    gpuName: overrides.gpuName ?? (isAppleSilicon ? cpuName.replace(/ CPU$/i, '') : undefined),
    metalSupport: overrides.metalSupport ?? (isAppleSilicon ? true : undefined),
    recommendedTier
  };
}

function classifyTier(memoryGb: number, cpuCores: number, isAppleSilicon: boolean): RecommendedTier {
  if (memoryGb >= 24 && (cpuCores >= 8 || isAppleSilicon)) {
    return 'high';
  }
  if (memoryGb >= 12 && cpuCores >= 4) {
    return 'medium';
  }
  return 'low';
}
