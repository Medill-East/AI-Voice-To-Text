import { describe, expect, it } from 'vitest';
import { DEFAULT_MODEL_CATALOG, recommendModels } from '../src/core/modelCatalog';
import type { HardwareProfile } from '../src/core/types';

describe('model catalog recommendation', () => {
  it('recommends SenseVoice 2025 first on Apple Silicon with 32 GB memory', () => {
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

    expect(recommendations).toHaveLength(3);
    expect(recommendations[0].model.id).toBe('sensevoice-onnx-int8-2025');
    expect(recommendations[0].reasons.join(' ')).toContain('中文');
    expect(recommendations[0].score).toBeGreaterThan(recommendations[1].score);
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

    expect(recommendations[0].model.sizeMb).toBeLessThan(500);
    expect(recommendations[0].reasons.join(' ')).toContain('低内存');
  });
});
