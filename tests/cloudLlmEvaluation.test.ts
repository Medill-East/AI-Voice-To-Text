import { describe, expect, it } from 'vitest';
import { evaluateCloudLlmOutput, selectBestCloudLlmCandidate } from '../src/core/cloudLlmEvaluation';

describe('cloud LLM evaluation', () => {
  it('accepts a concise structured result that retains all requested issues', () => {
    const result = evaluateCloudLlmOutput(
      '1. 模型下载太慢。\n2. 结构化输出不够自然。\n3. GitHub 同步要避免覆盖本地提示词。'
    );

    expect(result.score).toBe(100);
    expect(result.passed).toBe(true);
    expect(result.checks).toEqual(
      expect.objectContaining({
        preservesIssues: true,
        removesFillers: true,
        avoidsReasoning: true
      })
    );
  });

  it('rejects reasoning-only output even when it repeats the source issues', () => {
    const result = evaluateCloudLlmOutput(
      'Thinking Process: 我会分析模型下载太慢、结构化输出不够自然，以及 GitHub 同步要避免覆盖本地提示词。'
    );

    expect(result.passed).toBe(false);
    expect(result.checks.avoidsReasoning).toBe(false);
  });

  it('selects the fastest model among quality-qualified measured candidates', () => {
    const best = selectBestCloudLlmCandidate([
      { modelId: 'quality-slow', modelName: 'Quality Slow', ok: true, latencyMs: 3800, qualityScore: 100, recommendationScore: 92 },
      { modelId: 'quality-fast', modelName: 'Quality Fast', ok: true, latencyMs: 1200, qualityScore: 100, recommendationScore: 80 },
      { modelId: 'fast-but-bad', modelName: 'Fast but bad', ok: true, latencyMs: 400, qualityScore: 50, recommendationScore: 99 }
    ]);

    expect(best?.modelId).toBe('quality-fast');
  });
});
