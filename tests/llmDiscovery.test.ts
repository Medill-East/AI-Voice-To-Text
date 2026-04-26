import { describe, expect, it, vi } from 'vitest';
import { detectLocalLlmProviders } from '../src/core/llmDiscovery';

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
});
