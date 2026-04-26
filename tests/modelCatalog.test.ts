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
      'firered-asr2-zh-en-int8-2026-02-26',
      'qwen3-asr-0.6b',
      'funasr-nano-int8-2025-12-30'
    ]);
    expect(recommendations.every((item) => item.model.installable)).toBe(true);
    expect(recommendations.some((item) => item.model.id.includes('2024'))).toBe(false);
    expect(recommendations.some((item) => item.model.runtime === 'whisper-cpp')).toBe(false);
    expect(recommendations[0].reasons.join(' ')).toContain('中文');
    expect(recommendations[0].score).toBeLessThanOrEqual(100);
    expect(recommendations[0].scoreBreakdown.map((item) => item.label)).toEqual(
      expect.arrayContaining(['普通话', '方言/粤语', '中英混输', '本机运行', '硬件匹配', '体积'])
    );
    expect(recommendations[1].model.sherpaModelType).toBe('qwen3Asr');
    expect(recommendations[1].model.evaluationSources?.chineseBenchmark?.note).toContain('支持中文');
    expect(recommendations[1].model.evaluationSources?.openAsrLeaderboard?.exactModelMatch).toBe(true);
  });

  it('does not let English Open ASR rank override Chinese relevance', () => {
    const hardware: HardwareProfile = {
      platform: 'darwin',
      arch: 'arm64',
      cpuName: 'Apple M5',
      cpuCores: 10,
      memoryGb: 32,
      recommendedTier: 'high'
    };
    const catalog = DEFAULT_MODEL_CATALOG.map((model) =>
      model.id === 'openai-whisper-large-v3'
        ? {
            ...model,
            installable: true,
            availability: 'installable' as const,
            requiredFiles: ['ggml-large-v3.bin'],
            qualityTags: ['英文榜单高分', '本地离线'],
            evaluationSources: {
              ...model.evaluationSources,
              openAsrLeaderboard: {
                sourceLabel: 'Open ASR Leaderboard',
                sourceUrl: 'https://github.com/huggingface/open_asr_leaderboard',
                track: 'English short-form',
                rank: 1,
                avgWer: 4.1,
                rtfx: 500,
                exactModelMatch: true
              }
            }
          }
        : model
    );

    const recommendations = recommendModels(catalog, hardware);

    expect(recommendations[0].model.id).toBe('firered-asr2-zh-en-int8-2026-02-26');
    expect(recommendations[0].model.id).not.toBe('openai-whisper-large-v3');
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

    expect(references.map((model) => model.id)).toEqual(expect.arrayContaining(['qwen3-asr-1.7b', 'cohere-transcribe-03-2026']));
    expect(references).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: 'qwen3-asr-0.6b' })]));
    expect(references.every((model) => model.availability !== 'installable')).toBe(true);
    expect(references.every((model) => model.unavailableReason)).toBe(true);
    expect(references.some((model) => model.manualSetup)).toBe(true);
    expect(references[0].evaluationSources?.chineseBenchmark?.sourceLabel).toContain('Qwen3-ASR');
    expect(references.find((model) => model.id === 'zoom-scribe-v1')?.license).toBe('Proprietary');
  });
});
