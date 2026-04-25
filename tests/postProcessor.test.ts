import { describe, expect, it, vi } from 'vitest';
import { PostProcessor, structuredPrompt } from '../src/core/postProcessor';
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

  it('formats ordinary structured dictation as readable paragraphs when no LLM is configured', async () => {
    const processor = new PostProcessor();

    const result = await processor.process('今天我想记录一下 V2T 的目标。它应该尽量少打扰用户，同时把口述内容整理得更容易阅读。', {
      mode: 'structured',
      lexicon
    });

    expect(result.usedLlm).toBe(false);
    expect(result.text).not.toContain('- ');
    expect(result.text).toContain('今天我想记录一下 V2T 的目标。');
    expect(result.text).toContain('它应该尽量少打扰用户');
  });

  it('uses numbered structure only when the dictation clearly contains steps', async () => {
    const processor = new PostProcessor();

    const result = await processor.process('首先检测硬件。然后推荐模型。最后开始录音。', {
      mode: 'structured',
      lexicon
    });

    expect(result.usedLlm).toBe(false);
    expect(result.text).toContain('1. 首先检测硬件');
    expect(result.text).toContain('2. 然后推荐模型');
    expect(result.text).toContain('3. 最后开始录音');
  });

  it('instructs LLM structured mode not to force every sentence into a list', () => {
    expect(structuredPrompt()).toContain('不要默认把每一句都变成列表');
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
