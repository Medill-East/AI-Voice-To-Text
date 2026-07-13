import type { LlmProviderDetection, LlmProviderKind, LlmTestResult } from './types';
import { OpenAICompatibleClient } from './llmClient';
import { structuredPrompt } from './postProcessor';
import { evaluateCloudLlmOutput } from './cloudLlmEvaluation';

export interface LlmEndpoint {
  kind: LlmProviderKind;
  label: string;
  baseUrl: string;
  modelsUrl: string;
  parseModels(payload: unknown): string[];
}

const DEFAULT_ENDPOINTS: LlmEndpoint[] = [
  {
    kind: 'ollama',
    label: 'Ollama',
    baseUrl: 'http://127.0.0.1:11434/v1',
    modelsUrl: 'http://127.0.0.1:11434/api/tags',
    parseModels: (payload) => {
      const models = asRecord(payload).models;
      return Array.isArray(models) ? models.map((item) => asRecord(item).name).filter(isString) : [];
    }
  },
  {
    kind: 'lm-studio',
    label: 'LM Studio',
    baseUrl: 'http://127.0.0.1:1234/v1',
    modelsUrl: 'http://127.0.0.1:1234/v1/models',
    parseModels: (payload) => {
      const data = asRecord(payload).data;
      return Array.isArray(data) ? data.map((item) => asRecord(item).id).filter(isString) : [];
    }
  }
];

export async function detectLocalLlmProviders(options: {
  fetchImpl?: typeof fetch;
  endpoints?: LlmEndpoint[];
} = {}): Promise<LlmProviderDetection[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const endpoints = options.endpoints ?? DEFAULT_ENDPOINTS;
  return Promise.all(
    endpoints.map(async (endpoint) => {
      try {
        const response = await fetchImpl(endpoint.modelsUrl, { method: 'GET' });
        if (!response.ok) {
          return {
            kind: endpoint.kind,
            label: endpoint.label,
            baseUrl: endpoint.baseUrl,
            ok: false,
            models: [],
            error: `HTTP ${response.status}`
          };
        }
        const models = endpoint.parseModels(await response.json());
        return {
          kind: endpoint.kind,
          label: endpoint.label,
          baseUrl: endpoint.baseUrl,
          ok: true,
          models
        };
      } catch (error) {
        return {
          kind: endpoint.kind,
          label: endpoint.label,
          baseUrl: endpoint.baseUrl,
          ok: false,
          models: [],
          error: error instanceof Error ? error.message : String(error)
        };
      }
    })
  );
}

export async function testLlmClient(options: {
  kind: LlmProviderKind;
  baseUrl: string;
  model: string;
  apiKey?: string;
  timeoutMs?: number;
  fastMode?: boolean;
  systemPrompt?: string;
}): Promise<LlmTestResult> {
  const startedAt = Date.now();
  try {
    const client = new OpenAICompatibleClient({
      baseUrl: options.baseUrl,
      model: options.model,
      apiKey: options.apiKey,
      timeoutMs: options.timeoutMs,
      fastMode: options.fastMode
    });
    const output = await client.complete({
      mode: 'structured',
      input: '嗯我想测试一下结构化整理，比如第一个问题是模型下载太慢，第二个问题是结构化输出不够自然，第三个问题是 GitHub 同步要避免覆盖本地提示词。',
      systemPrompt: options.systemPrompt ?? structuredPrompt()
    });
    const evaluation = evaluateCloudLlmOutput(output);
    return {
      ok: true,
      provider: options.kind,
      model: options.model,
      elapsedMs: Date.now() - startedAt,
      engine: 'llm-local',
      output,
      qualityScore: evaluation.score,
      qualityPassed: evaluation.passed
    };
  } catch (error) {
    return {
      ok: false,
      provider: options.kind,
      model: options.model,
      elapsedMs: Date.now() - startedAt,
      reasoningOnly: error instanceof Error && error.message.includes('只生成了推理内容'),
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
