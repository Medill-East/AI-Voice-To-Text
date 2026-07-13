import { describe, expect, it, vi } from 'vitest';
import { detectLocalLlmProviders, testLlmClient } from '../src/core/llmDiscovery';

describe('LLM discovery', () => {
  it('detects Ollama and LM Studio model lists', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('11434')) {
        return Response.json({ models: [{ name: 'qwen2.5:7b' }] });
      }
      return Response.json({ data: [{ id: 'local-model' }] });
    });

    const detections = await detectLocalLlmProviders({ fetchImpl });

    expect(detections).toEqual([
      expect.objectContaining({
        kind: 'ollama',
        label: 'Ollama',
        ok: true,
        baseUrl: 'http://127.0.0.1:11434/v1',
        models: ['qwen2.5:7b']
      }),
      expect.objectContaining({
        kind: 'lm-studio',
        label: 'LM Studio',
        ok: true,
        baseUrl: 'http://127.0.0.1:1234/v1',
        models: ['local-model']
      })
    ]);
  });

  it('returns readable connection errors without throwing', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('connection refused');
    });

    const detections = await detectLocalLlmProviders({ fetchImpl });

    expect(detections).toHaveLength(2);
    expect(detections.every((item) => !item.ok)).toBe(true);
    expect(detections[0]?.error).toContain('connection refused');
  });

  it('evaluates the actual structured prompt output during a cloud model test', async () => {
    const fetchStub = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({
        choices: [
          {
            message: {
              content: '1. 模型下载太慢。\n2. 结构化输出不够自然。\n3. GitHub 同步要避免覆盖本地提示词。'
            },
            finish_reason: 'stop'
          }
        ]
      })
    );

    const result = await testLlmClient({
      kind: 'openai-compatible',
      baseUrl: 'https://example.test/v1',
      model: 'model-a',
      systemPrompt: '使用用户当前的结构化提示词'
    });

    expect(result).toMatchObject({
      ok: true,
      qualityScore: 100,
      qualityPassed: true
    });
    expect(fetchStub).toHaveBeenCalledWith(
      'https://example.test/v1/chat/completions',
      expect.objectContaining({ body: expect.stringContaining('使用用户当前的结构化提示词') })
    );
    fetchStub.mockRestore();
  });
});
