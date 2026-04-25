import type { LlmClient, LlmCompletionRequest } from './types';

interface OpenAICompatibleClientOptions {
  baseUrl: string;
  model: string;
  apiKey?: string;
}

export class OpenAICompatibleClient implements LlmClient {
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly apiKey?: string;

  constructor(options: OpenAICompatibleClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.model = options.model;
    this.apiKey = options.apiKey;
  }

  async complete(request: LlmCompletionRequest): Promise<string> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {})
      },
      body: JSON.stringify({
        model: this.model,
        temperature: request.mode === 'natural' ? 0.1 : 0.2,
        messages: [
          { role: 'system', content: request.systemPrompt },
          { role: 'user', content: request.input }
        ]
      })
    });

    if (!response.ok) {
      throw new Error(`LLM request failed: ${response.status} ${response.statusText}`);
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = payload.choices?.[0]?.message?.content?.trim();
    if (!content) {
      throw new Error('LLM response did not include message content');
    }

    return content;
  }
}
