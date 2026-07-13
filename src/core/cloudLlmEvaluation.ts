export interface CloudLlmOutputChecks {
  hasOutput: boolean;
  preservesIssues: boolean;
  removesFillers: boolean;
  avoidsReasoning: boolean;
  hasReadableStructure: boolean;
}

export interface CloudLlmOutputEvaluation {
  score: number;
  passed: boolean;
  checks: CloudLlmOutputChecks;
}

export interface CloudLlmMeasuredCandidate {
  modelId: string;
  modelName: string;
  ok: boolean;
  latencyMs?: number;
  qualityScore?: number;
  recommendationScore?: number;
}

export function evaluateCloudLlmOutput(output: string | undefined): CloudLlmOutputEvaluation {
  const text = output?.trim() ?? '';
  const normalized = text.replace(/\s+/g, '');
  const checks: CloudLlmOutputChecks = {
    hasOutput: normalized.length > 0,
    preservesIssues:
      /模型.{0,8}下载.{0,8}(慢|缓)/.test(text) &&
      /结构化.{0,12}(自然|输出)/.test(text) &&
      /github/i.test(text) &&
      /(覆盖|提示词)/.test(text),
    removesFillers: !/(^|[\s，,。.!！?？])(?:嗯+|呃+|额+|唔+)(?=[\s，,。.!！?？]|$)/.test(text),
    avoidsReasoning: !/(thinking process|reasoning_content|分析过程|推理过程)/i.test(text),
    hasReadableStructure: /(?:^|\n)\s*(?:[-*]|\d+[.、])\s*/m.test(text) || /[。！？!?]/.test(text)
  };
  const score =
    (checks.hasOutput ? 15 : 0) +
    (checks.preservesIssues ? 40 : 0) +
    (checks.removesFillers ? 15 : 0) +
    (checks.avoidsReasoning ? 20 : 0) +
    (checks.hasReadableStructure ? 10 : 0);
  return {
    score,
    passed: checks.hasOutput && checks.preservesIssues && checks.avoidsReasoning && score >= 80,
    checks
  };
}

export function selectBestCloudLlmCandidate(candidates: CloudLlmMeasuredCandidate[]): CloudLlmMeasuredCandidate | undefined {
  return candidates
    .filter((candidate) => candidate.ok && (candidate.qualityScore ?? 0) >= 80 && typeof candidate.latencyMs === 'number')
    .sort((left, right) => {
      const qualityDelta = (right.qualityScore ?? 0) - (left.qualityScore ?? 0);
      if (qualityDelta !== 0) {
        return qualityDelta;
      }
      const latencyDelta = (left.latencyMs ?? Number.POSITIVE_INFINITY) - (right.latencyMs ?? Number.POSITIVE_INFINITY);
      if (latencyDelta !== 0) {
        return latencyDelta;
      }
      return (right.recommendationScore ?? 0) - (left.recommendationScore ?? 0);
    })[0];
}

export function cloudBatchRetryDelayMs(attempt: number): number {
  return 3_000 * 2 ** attempt;
}
