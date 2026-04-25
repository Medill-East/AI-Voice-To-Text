import { describe, expect, it, vi } from 'vitest';
import { PostProcessor } from '../src/core/postProcessor';
import type { Lexicon, LlmClient } from '../src/core/types';

const lexicon: Lexicon = {
  version: 1,
  terms: [
    { phrase: 'Play With Experiences', aliases: ['pwe'] },
    { phrase: 'V2T', aliases: ['v to t'] }
  ],
  replacements: [
    { from: '张三丰', to: '张三峰' },
    { from: '语音转文字', to: '语音输入转文字' }
  ],
  blocked: ['你懂我意思吧']
};

describe('PostProcessor', () => {
  it('keeps natural mode conservative while applying lexicon corrections', async () => {
    const llm: LlmClient = { complete: vi.fn() };
    const processor = new PostProcessor({ llm });

    const result = await processor.process('嗯 今天我用 pwe 做张三丰的语音转文字 你懂我意思吧', {
      mode: 'natural',
      lexicon
    });

    expect(result.text).toBe('今天我用 Play With Experiences 做张三峰的语音输入转文字');
    expect(result.usedLlm).toBe(false);
    expect(llm.complete).not.toHaveBeenCalled();
  });

  it('formats structured mode as Markdown bullets when no LLM is configured', async () => {
    const processor = new PostProcessor();

    const result = await processor.process('先记录 V2T 的目标。然后整理成可以发给 AI 的内容。最后保留原意。', {
      mode: 'structured',
      lexicon
    });

    expect(result.usedLlm).toBe(false);
    expect(result.text).toContain('- 先记录 V2T 的目标');
    expect(result.text).toContain('- 然后整理成可以发给 AI 的内容');
    expect(result.text).toContain('- 最后保留原意');
  });

  it('uses an OpenAI-compatible LLM client for structured mode when configured', async () => {
    const llm: LlmClient = {
      complete: vi.fn().mockResolvedValue('- 已整理的 Markdown')
    };
    const processor = new PostProcessor({ llm });

    const result = await processor.process('把这个内容整理一下', {
      mode: 'structured',
      lexicon
    });

    expect(result.text).toBe('- 已整理的 Markdown');
    expect(result.usedLlm).toBe(true);
    expect(llm.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'structured',
        input: '把这个内容整理一下'
      })
    );
  });
});
