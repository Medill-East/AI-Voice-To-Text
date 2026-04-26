import type { LlmClient, LlmCompletionRequest } from './types';

interface OpenAICompatibleClientOptions {
  baseUrl: string;
  model: string;
  apiKey?: string;
  timeoutMs?: number;
  fastMode?: boolean;
}

export class OpenAICompatibleClient implements LlmClient {
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly apiKey?: string;
  private readonly timeoutMs: number;
  private readonly fastMode: boolean;

  constructor(options: OpenAICompatibleClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.model = options.model;
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs ?? 30000;
    this.fastMode = options.fastMode ?? true;
  }

  async complete(request: LlmCompletionRequest): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {})
        },
        body: JSON.stringify({
          model: this.model,
          temperature: request.mode === 'natural' ? 0.1 : 0.2,
          max_tokens: request.mode === 'natural' ? 256 : 512,
          stream: false,
          ...(this.fastMode
            ? {
                enable_thinking: false,
                reasoning_effort: 'none',
                reasoning: { effort: 'none' }
              }
            : {}),
          messages: [
            { role: 'system', content: fastModePrompt(request.systemPrompt, this.fastMode) },
            { role: 'user', content: request.input }
          ]
        })
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new LlmCompletionError(`LLM 请求超时（${Math.round(this.timeoutMs / 1000)} 秒）`, 'timeout');
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      throw new Error(`LLM request failed: ${response.status} ${response.statusText}`);
    }

    const payload = (await response.json()) as {
      choices?: Array<{ finish_reason?: string; message?: { content?: string; reasoning_content?: string; reasoning?: string } }>;
    };
    const choice = payload.choices?.[0];
    const finishReason = choice?.finish_reason;
    if (finishReason === 'length') {
      throw new LlmCompletionError('LLM 输出被截断：本地模型把输出预算用完了，请关闭 Thinking 或启用云端兜底。', 'length');
    }

    const content = choice?.message?.content?.trim();
    if (!content) {
      const reasoning = choice?.message?.reasoning_content ?? choice?.message?.reasoning;
      if (typeof reasoning === 'string' && reasoning.trim().length > 0) {
        throw new LlmCompletionError('本地 LLM 只生成了推理内容，请关闭 Thinking 或启用云端兜底。', 'reasoning-only');
      }
      throw new LlmCompletionError('LLM response did not include message content', 'empty-content');
    }

    return content;
  }
}

export type LlmCompletionErrorCode = 'timeout' | 'length' | 'reasoning-only' | 'empty-content';

export class LlmCompletionError extends Error {
  readonly code: LlmCompletionErrorCode;

  constructor(message: string, code: LlmCompletionErrorCode) {
    super(message);
    this.name = 'LlmCompletionError';
    this.code = code;
  }
}

function fastModePrompt(systemPrompt: string, fastMode: boolean): string {
  if (!fastMode) {
    return systemPrompt;
  }
  return `${systemPrompt}\n\n速度约束：不要进行长篇推理，不要输出 Thinking Process、reasoning、分析步骤或解释；如果需要整理，直接给最终正文。`;
}
