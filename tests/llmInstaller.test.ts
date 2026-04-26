import { describe, expect, it, vi } from 'vitest';
import { getLlmInstallerTargets, officialLlmInstallerUrl } from '../src/core/llmInstaller';

describe('LLM installer guide', () => {
  it('uses official installer URLs only', () => {
    expect(officialLlmInstallerUrl('ollama')).toBe('https://ollama.com/download');
    expect(officialLlmInstallerUrl('lm-studio')).toBe('https://lmstudio.ai/download');
    expect(officialLlmInstallerUrl('openai-compatible')).toBeUndefined();
  });

  it('marks available local services and exposes models for one-click enable', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('11434')) {
        return Response.json({ models: [{ name: 'qwen2.5:7b' }] });
      }
      return Response.json({ data: [{ id: 'local-model' }] });
    });

    const targets = await getLlmInstallerTargets({ fetchImpl });

    expect(targets).toEqual([
      expect.objectContaining({
        kind: 'ollama',
        status: 'service-available',
        downloadUrl: 'https://ollama.com/download',
        docsUrl: 'https://docs.ollama.com/windows',
        models: ['qwen2.5:7b']
      }),
      expect.objectContaining({
        kind: 'lm-studio',
        status: 'service-available',
        downloadUrl: 'https://lmstudio.ai/download',
        docsUrl: 'https://lmstudio.ai/docs/developer/core/server',
        models: ['local-model']
      })
    ]);
  });

  it('returns installer guidance when local services are not running', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('connection refused');
    });

    const targets = await getLlmInstallerTargets({ fetchImpl });

    expect(targets).toHaveLength(2);
    expect(targets.every((target) => target.status === 'installed-not-running')).toBe(true);
    expect(targets[0]?.serviceHint).toContain('ollama serve');
    expect(targets[1]?.serviceHint).toContain('Developer');
  });
});
