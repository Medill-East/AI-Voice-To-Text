import { describe, expect, it } from 'vitest';
import { DEFAULT_MODEL_CATALOG, recommendModels } from '../src/core/modelCatalog';
import type { HardwareProfile } from '../src/core/types';

describe('model catalog recommendation', () => {
  it('recommends only installable latest-family models on Apple Silicon with 32 GB memory', () => {
    const hardware: HardwareProfile = {
      platform: 'darwin',
      arch: 'arm64',
      cpuName: 'Apple M5',
      cpuCores: 10,
      memoryGb: 32,
      gpuName: 'Apple M5',
      metalSupport: true,
      recommendedTier: 'high'
    };

    const recommendations = recommendModels(DEFAULT_MODEL_CATALOG, hardware);

    expect(recommendations.map((item) => item.model.id)).toEqual([
      'funasr-nano-int8-2025-12-30',
      'sensevoice-onnx-int8-2025-09-09',
      'firered-asr2-zh-en-int8-2026-02-26'
    ]);
    expect(recommendations.every((item) => item.model.installable)).toBe(true);
    expect(recommendations.some((item) => item.model.id.includes('2024'))).toBe(false);
    expect(recommendations.some((item) => item.model.runtime === 'whisper-cpp')).toBe(false);
    expect(recommendations[0].reasons.join(' ')).toContain('中文');
  });

  it('prefers smaller models on low-memory devices', () => {
    const hardware: HardwareProfile = {
      platform: 'win32',
      arch: 'x64',
      cpuName: 'Intel Core i5',
      cpuCores: 4,
      memoryGb: 8,
      recommendedTier: 'low'
    };

    const recommendations = recommendModels(DEFAULT_MODEL_CATALOG, hardware);

    expect(recommendations[0].model.id).toBe('sensevoice-onnx-int8-2025-09-09');
    expect(recommendations[0].reasons.join(' ')).toContain('低内存');
  });
});
