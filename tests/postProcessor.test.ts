import { describe, expect, it, vi } from 'vitest';
import { analyzeLexicon, PostProcessor, structuredPrompt } from '../src/core/postProcessor';
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
    expect(result.afterLexiconText).toBe(result.text);
    expect(result.lexiconHits.map((hit) => hit.from)).toEqual(expect.arrayContaining(['pwe', '张三丰', '语音转文字', '你懂我意思吧']));
    expect(llm.complete).not.toHaveBeenCalled();
  });

  it('returns lexicon diagnostics for trial runs and missed aliases', () => {
    const diagnostics = analyzeLexicon('今天提到了 pwe 和未命中的人名', lexicon);

    expect(diagnostics.outputText).toContain('Play With Experiences');
    expect(diagnostics.hits).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'term', from: 'pwe', to: 'Play With Experiences' })]));
    expect(diagnostics.missedTerms).toEqual(expect.arrayContaining(['V2T']));
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

  it('separates clear topic changes into paragraphs in structured fallback', async () => {
    const processor = new PostProcessor();

    const result = await processor.process('今天先记录语音输入的体验。换个话题，现在是独立游戏的黄金时代。另一个问题是我想整理模型推荐。', {
      mode: 'structured',
      lexicon
    });

    expect(result.text).toContain('今天先记录语音输入的体验。');
    expect(result.text).toContain('\n\n换个话题，现在是独立游戏的黄金时代。');
    expect(result.text).toContain('\n\n另一个问题是我想整理模型推荐。');
  });

  it('cleans ASR silence markers and embedded filler words in structured fallback', async () => {
    const processor = new PostProcessor();

    const result = await processor.process('/sil 呃 我觉得这个就是模型下载速度很慢 <|nospeech|> 你懂我意思吧。模型下载速度很慢。', {
      mode: 'structured',
      lexicon
    });

    expect(result.text).not.toContain('/sil');
    expect(result.text).not.toContain('<|nospeech|>');
    expect(result.text).not.toContain('呃');
    expect(result.text).not.toContain('你懂我意思吧');
    expect(result.text).toBe('我觉得这个就是模型下载速度很慢。');
  });

  it('does not delete meaningful demonstratives and copula-like filler inside phrases', async () => {
    const processor = new PostProcessor();

    const result = await processor.process('这个方案比那个好。就是这个问题。', {
      mode: 'structured',
      lexicon
    });

    expect(result.text).toBe('这个方案比那个好。就是这个问题。');
  });

  it('removes standalone demonstrative fillers only at phrase boundaries', async () => {
    const processor = new PostProcessor();

    const result = await processor.process('嗯 这个 那个 就是 我想测试一下。', {
      mode: 'structured',
      lexicon
    });

    expect(result.text).toBe('我想测试一下。');
  });

  it('merges repeated punctuation and removes leading comma fillers', async () => {
    const processor = new PostProcessor();

    const result = await processor.process('，就是我在检测，，Cuda，它还是提示。，未安装', {
      mode: 'structured',
      lexicon
    });

    expect(result.text).toBe('我在检测Cuda，它还是提示未安装。');
  });

  it('collapses repeated Chinese words from ASR stutter', async () => {
    const processor = new PostProcessor();

    const result = await processor.process('我我我我后退之后，只能只能那个什么。是是是个 bug。会会原地打转。', {
      mode: 'structured',
      lexicon
    });

    expect(result.text).toBe('我后退之后，只能那个什么。是个 bug。会原地打转。');
  });

  it('does not treat repeated then/connective sentences as ordered steps', async () => {
    const processor = new PostProcessor();

    const result = await processor.process('然后我离开石头之后，镜头没有切回来。然后这里不知道是个 bug。然后石头会打转。', {
      mode: 'structured',
      lexicon
    });

    expect(result.text).not.toContain('1. ');
    expect(result.text).toBe('然后我离开石头之后，镜头没有切回来。然后这里不知道是个 bug。然后石头会打转。');
  });

  it('removes embedded pure fillers without deleting meaningful demonstratives', async () => {
    const processor = new PostProcessor();

    const embedded = await processor.process('这个呃，镜头切换的效果还是比较突兀。', {
      mode: 'structured',
      lexicon
    });
    const meaningful = await processor.process('这个方案比那个好，就是效率更高。', {
      mode: 'structured',
      lexicon
    });
    const sentenceParticle = await processor.process('我觉得存在几方面的问题啊，首先镜头切换突兀。', {
      mode: 'structured',
      lexicon
    });

    expect(embedded.text).toBe('这个镜头切换的效果还是比较突兀。');
    expect(meaningful.text).toBe('这个方案比那个好，就是效率更高。');
    expect(sentenceParticle.text).toBe('我觉得存在几方面的问题，首先镜头切换突兀。');
  });

  it('keeps one topic in a compact paragraph instead of repeatedly splitting sentences', async () => {
    const processor = new PostProcessor();

    const result = await processor.process('我想优化结构化输入。它现在会过度分段。相同主题应该合并。不要因为停顿就另起一段。', {
      mode: 'structured',
      lexicon
    });

    expect(result.text).toBe('我想优化结构化输入。它现在会过度分段。相同主题应该合并。不要因为停顿就另起一段。');
  });

  it('instructs LLM structured mode not to force every sentence into a list', () => {
    expect(structuredPrompt()).toContain('不默认把每一句都变成列表');
    expect(structuredPrompt()).toContain('口头噪声已预处理');
    expect(structuredPrompt()).toContain('同一主题合并');
    expect(structuredPrompt()).not.toContain('Thinking Process');
    expect(structuredPrompt()).toContain('只输出整理后的正文');
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
    expect(result.engine).toBe('llm-local');
    expect(llm.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'structured',
        input: '把这个内容整理一下',
        systemPrompt: expect.stringContaining('专有名词和固定替换约束')
      })
    );
  });

  it('marks cloud LLM output when cloud is the primary engine', async () => {
    const llm: LlmClient = {
      complete: vi.fn().mockResolvedValue('云端整理结果')
    };
    const processor = new PostProcessor({ llm, primaryEngine: 'llm-cloud' });

    const result = await processor.process('嗯 我想测试云端结构化整理', {
      mode: 'structured',
      lexicon
    });

    expect(result).toMatchObject({
      text: '云端整理结果',
      usedLlm: true,
      engine: 'llm-cloud'
    });
  });

  it('uses fallback LLM when the local LLM only produces reasoning or times out', async () => {
    const local: LlmClient = {
      complete: vi.fn().mockRejectedValue(new Error('本地 LLM 只生成了推理内容，请关闭 Thinking 或启用云端兜底。'))
    };
    const fallback: LlmClient = {
      complete: vi.fn().mockResolvedValue('云端整理结果')
    };
    const processor = new PostProcessor({ llm: local, fallbackLlm: fallback });

    const result = await processor.process('嗯 结构化输出不够自然', {
      mode: 'structured',
      lexicon
    });

    expect(result).toMatchObject({
      text: '云端整理结果',
      usedLlm: true,
      engine: 'llm-fallback'
    });
    expect(fallback.complete).toHaveBeenCalledOnce();
  });

  it('falls back to local rules when both local and fallback LLM fail', async () => {
    const local: LlmClient = { complete: vi.fn().mockRejectedValue(new Error('本地超时')) };
    const fallback: LlmClient = { complete: vi.fn().mockRejectedValue(new Error('云端失败')) };
    const processor = new PostProcessor({ llm: local, fallbackLlm: fallback });

    const result = await processor.process('嗯 我想整理一下模型下载太慢这个问题', {
      mode: 'structured',
      lexicon
    });

    expect(result.usedLlm).toBe(false);
    expect(result.engine).toBe('local-rules');
    expect(result.text).toBe('我想整理一下模型下载太慢这个问题。');
    expect(result.llmError).toContain('本地超时');
    expect(result.llmError).toContain('云端兜底失败');
  });
});
