import { describe, expect, it } from 'vitest';
import { DEFAULT_MODEL_CATALOG, referenceModels, recommendModels } from '../src/core/modelCatalog';
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
    expect(recommendations[0].score).toBeLessThanOrEqual(100);
    expect(recommendations[0].scoreBreakdown.map((item) => item.label)).toEqual(
      expect.arrayContaining(['中文适配', '本机速度', '硬件匹配', '体积', '语言覆盖'])
    );
    expect(recommendations[0].model.evaluationSources?.officialBenchmark?.metrics).toEqual(
      expect.arrayContaining([expect.objectContaining({ label: 'AIShell1', metric: 'WER', value: 1.8 })])
    );
    expect(recommendations[0].model.evaluationSources?.officialBenchmark?.note).toContain('同源模型参考');
    expect(recommendations[0].model.evaluationSources?.openAsrLeaderboard?.exactModelMatch).toBe(false);
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

  it('keeps public evaluation data separate from V2T local recommendation score', () => {
    const senseVoice = DEFAULT_MODEL_CATALOG.find((model) => model.family === 'sensevoice');

    expect(senseVoice?.evaluationSources?.officialBenchmark?.sourceLabel).toContain('SenseVoice');
    expect(senseVoice?.evaluationSources?.openAsrLeaderboard?.note).toContain('未找到 exact match');
    expect(senseVoice?.evaluationSources?.localRecommendation?.note).toContain('V2T');
  });

  it('separates one-click installable models from public high-score reference models', () => {
    const references = referenceModels(DEFAULT_MODEL_CATALOG);

    expect(references.map((model) => model.id)).toEqual(
      expect.arrayContaining([
        'cohere-transcribe-03-2026',
        'ibm-granite-4.0-1b-speech',
        'nvidia-canary-qwen-2.5b',
        'qwen3-asr-1.7b',
        'nvidia-parakeet-tdt-0.6b-v3',
        'openai-whisper-large-v3'
      ])
    );
    expect(references.every((model) => model.availability !== 'installable')).toBe(true);
    expect(references.every((model) => model.unavailableReason)).toBe(true);
    expect(references.some((model) => model.manualSetup)).toBe(true);
    expect(references[0].evaluationSources?.openAsrLeaderboard?.exactModelMatch).toBe(true);
    expect(references[0].evaluationSources?.openAsrLeaderboard?.rank).toBe(1);
  });
});
