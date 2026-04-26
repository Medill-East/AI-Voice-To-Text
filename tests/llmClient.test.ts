import { describe, expect, it, vi } from 'vitest';
import { LlmCompletionError, OpenAICompatibleClient } from '../src/core/llmClient';

describe('OpenAICompatibleClient', () => {
  it('sends fast bounded chat completion requests', async () => {
    const fetchSpy = vi.fn(async () =>
      Response.json({
        choices: [{ finish_reason: 'stop', message: { content: '整理后的正文' } }]
      })
    );
    vi.stubGlobal('fetch', fetchSpy);

    const client = new OpenAICompatibleClient({
      baseUrl: 'http://127.0.0.1:1234/v1/',
      model: 'qwen/qwen3.5-9b',
      timeoutMs: 30000,
      fastMode: true
    });

    await expect(
      client.complete({
        mode: 'structured',
        input: '嗯我想整理一下',
        systemPrompt: '只输出正文'
      })
    ).resolves.toBe('整理后的正文');

    const [, init] = fetchSpy.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      model: 'qwen/qwen3.5-9b',
      temperature: 0.2,
      max_tokens: 512,
      stream: false,
      enable_thinking: false,
      reasoning_effort: 'none'
    });
    expect(body.messages[0].content).toContain('不要输出 Thinking Process');

    vi.unstubAllGlobals();
  });

  it('rejects reasoning-only responses with a readable error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          choices: [{ finish_reason: 'stop', message: { content: '', reasoning_content: 'Thinking Process...' } }]
        })
      )
    );

    const client = new OpenAICompatibleClient({ baseUrl: 'http://local/v1', model: 'qwen' });
    await expect(client.complete({ mode: 'structured', input: '测试', systemPrompt: '正文' })).rejects.toMatchObject({
      name: 'LlmCompletionError',
      code: 'reasoning-only'
    } satisfies Partial<LlmCompletionError>);

    vi.unstubAllGlobals();
  });

  it('rejects truncated responses with a readable error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          choices: [{ finish_reason: 'length', message: { content: '' } }]
        })
      )
    );

    const client = new OpenAICompatibleClient({ baseUrl: 'http://local/v1', model: 'qwen' });
    await expect(client.complete({ mode: 'structured', input: '测试', systemPrompt: '正文' })).rejects.toMatchObject({
      name: 'LlmCompletionError',
      code: 'length'
    } satisfies Partial<LlmCompletionError>);

    vi.unstubAllGlobals();
  });
});
