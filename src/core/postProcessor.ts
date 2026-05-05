import type { Lexicon, LexiconDiagnostics, LexiconHit, LlmClient, ProcessTextOptions, ProcessedText } from './types';

const DEFAULT_NATURAL_PROMPT =
  '你是保守的中文语音输入纠错器。只修正明显识别错误、专有名词、标点和少量口头禅，不改变语序、观点或文风。不要输出 Thinking Process、reasoning、分析步骤或解释，只输出最终正文。';

const DEFAULT_STRUCTURED_PROMPT = `你是中文语音输入的结构化整理器。

目标：把口述内容整理成适合阅读的 Markdown，保留原意，不添加新事实。

处理规则：
1. 口头噪声已预处理。如仍有碎字残留，忽略即可。
2. 同一主题合并为 1-3 个自然段；不要因停顿反复分段。
3. 仅在明确话题转换、步骤、清单时使用空行或列表。
4. 不默认把每一句都变成列表，不强行添加模板标题。
5. 保留中英文专有名词、代码词；不翻译。
6. 只输出整理后的正文。`;

export class PostProcessor {
  private readonly llm?: LlmClient;
  private readonly fallbackLlm?: LlmClient;
  private readonly primaryEngine: 'llm-local' | 'llm-cloud';

  constructor(options: { llm?: LlmClient; fallbackLlm?: LlmClient; primaryEngine?: 'llm-local' | 'llm-cloud' } = {}) {
    this.llm = options.llm;
    this.fallbackLlm = options.fallbackLlm;
    this.primaryEngine = options.primaryEngine ?? 'llm-local';
  }

  async process(input: string, options: ProcessTextOptions): Promise<ProcessedText> {
    const lexiconDiagnostics = analyzeLexicon(input, options.lexicon);
    const corrected = lexiconDiagnostics.outputText;

    if (options.mode === 'natural') {
      return { text: corrected, afterLexiconText: corrected, lexiconDiagnostics, lexiconHits: lexiconDiagnostics.hits, usedLlm: false, engine: 'local-rules' };
    }

    if (this.llm) {
      const request = {
        mode: 'structured' as const,
        input: corrected,
        systemPrompt: appendLexiconPrompt(options.prompt ?? DEFAULT_STRUCTURED_PROMPT, options.lexicon)
      };
      try {
        const text = await this.llm.complete(request);
        return {
          text: text.trim(),
          afterLexiconText: corrected,
          lexiconDiagnostics,
          lexiconHits: lexiconDiagnostics.hits,
          usedLlm: true,
          engine: this.primaryEngine
        };
      } catch (error) {
        if (this.fallbackLlm) {
          try {
            const text = await this.fallbackLlm.complete(request);
            return {
              text: text.trim(),
              afterLexiconText: corrected,
              lexiconDiagnostics,
              lexiconHits: lexiconDiagnostics.hits,
              usedLlm: true,
              engine: 'llm-fallback',
              llmError: readableError(error)
            };
          } catch (fallbackError) {
            return {
              text: toReadableMarkdown(corrected),
              afterLexiconText: corrected,
              lexiconDiagnostics,
              lexiconHits: lexiconDiagnostics.hits,
              usedLlm: false,
              engine: 'local-rules',
              llmError: `${readableError(error)}；云端兜底失败：${readableError(fallbackError)}`
            };
          }
        }

        return {
          text: toReadableMarkdown(corrected),
          afterLexiconText: corrected,
          lexiconDiagnostics,
          lexiconHits: lexiconDiagnostics.hits,
          usedLlm: false,
          engine: 'local-rules',
          llmError: readableError(error)
        };
      }
    }

    return {
      text: toReadableMarkdown(corrected),
      afterLexiconText: corrected,
      lexiconDiagnostics,
      lexiconHits: lexiconDiagnostics.hits,
      usedLlm: false,
      engine: 'local-rules'
    };
  }
}

function readableError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function naturalPrompt(): string {
  return DEFAULT_NATURAL_PROMPT;
}

export function structuredPrompt(): string {
  return DEFAULT_STRUCTURED_PROMPT;
}

export function analyzeLexicon(input: string, lexicon: Lexicon): LexiconDiagnostics {
  const hits: LexiconHit[] = [];
  let output = stripBlockedAndFillers(input, lexicon, hits);
  output = applyLexicon(output, lexicon, hits);
  output = normalizeWhitespace(output);

  const missedTerms = lexicon.terms
    .filter((term) => term.phrase && !containsText(output, term.phrase, term.caseSensitive) && !hits.some((hit) => hit.kind === 'term' && hit.phrase === term.phrase))
    .map((term) => term.phrase);

  return {
    rawText: input,
    outputText: output,
    hits,
    missedTerms
  };
}

function appendLexiconPrompt(prompt: string, lexicon: Lexicon): string {
  const terms = lexicon.terms.filter((term) => term.phrase || (term.aliases?.length ?? 0) > 0);
  const replacements = lexicon.replacements.filter((rule) => rule.enabled !== false && rule.from);
  if (terms.length === 0 && replacements.length === 0) {
    return prompt;
  }

  const lines = ['\n\n专有名词和固定替换约束：'];
  for (const term of terms.slice(0, 80)) {
    const aliases = term.aliases?.length ? `（别名：${term.aliases.join('、')}）` : '';
    lines.push(`- ${term.phrase}${aliases}`);
  }
  for (const replacement of replacements.slice(0, 80)) {
    lines.push(`- 将“${replacement.from}”写作“${replacement.to}”`);
  }
  lines.push('如果口述内容中出现这些别名或误识别结果，请优先使用上述标准写法。');
  return `${prompt}${lines.join('\n')}`;
}

function applyLexicon(input: string, lexicon: Lexicon, hits: LexiconHit[]): string {
  let output = input;
  for (const term of lexicon.terms) {
    for (const alias of term.aliases ?? []) {
      const result = replaceAll(output, alias, term.phrase, term.caseSensitive);
      if (result.count > 0) {
        hits.push({ kind: 'term', from: alias, to: term.phrase, phrase: term.phrase, count: result.count });
      }
      output = result.text;
    }
  }

  for (const replacement of lexicon.replacements) {
    if (replacement.enabled === false) {
      continue;
    }
    const result = replaceAll(output, replacement.from, replacement.to, replacement.caseSensitive);
    if (result.count > 0) {
      hits.push({ kind: 'replacement', from: replacement.from, to: replacement.to, count: result.count });
    }
    output = result.text;
  }

  return output;
}

function stripBlockedAndFillers(input: string, lexicon: Lexicon, hits: LexiconHit[]): string {
  let output = input;

  for (const blocked of lexicon.blocked) {
    const result = replaceAll(output, blocked, '', true);
    if (result.count > 0) {
      hits.push({ kind: 'blocked', from: blocked, to: '', count: result.count });
    }
    output = result.text;
  }

  return output
    .replace(/\/sil\b/gi, '')
    .replace(/<\|[^>]+?\|>/g, '')
    .replace(/你懂我意思[吧吗]?/g, '')
    .replace(/^[\s，,]*(?:就是)\s*/gm, '')
    .replace(/(?:嗯+|呃+|额+|唔+)[，,]?\s*/g, '')
    .replace(/[，,]\s*(?:嗯+|呃+|额+|唔+)/g, '')
    .replace(/啊+(?=[，,。.!！?？；;、\s]|$)/g, '')
    .replace(/(^|[\s，,。.!！?？；;、])(?:就是|那个|这个)(?=$|[\s，,。.!！?？；;、])/g, '$1')
    .replace(/(^|[\s，,。.!！?？；;、])对(?=$|[\s，,。.!！?？；;、])/g, '$1')
    .replace(/\s+([，,。.!！?？；;])/g, '$1')
    .replace(/([，,。.!！?？；;])\s+/g, '$1')
    .replace(/[，,。.!！?？；;]\s*$/g, '')
    .replace(/([。.!！?？])[，,]+/g, '')
    .replace(/[，,]{2,}/g, '')
    .replace(/^[，,]+/gm, '')
    .replace(/([一-鿿])\1+/g, '$1')
    .replace(/([一-鿿]{2,4})\1+/g, '$1');
}

function toReadableMarkdown(input: string): string {
  const blocks = splitIntoTopicBlocks(input);
  const parts = blocks
    .flatMap((block) => sentenceParts(block))
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length === 0) {
    return '';
  }

  if (looksLikeOrderedSteps(parts)) {
    return parts.map((part, index) => `${index + 1}. ${part}`).join('\n');
  }

  if (looksLikeLooseList(parts)) {
    return parts.map((part) => `- ${part}`).join('\n');
  }

  return blocks
    .map((block) => compactRepeatedSentences(sentenceParts(block)).map((part) => ensureSentencePunctuation(part)).join(''))
    .filter(Boolean)
    .join('\n\n');
}

function looksLikeOrderedSteps(parts: string[]): boolean {
  if (parts.length < 2) {
    return false;
  }
  return parts.filter((part) => /^(首先|其次|最后|第一|第二|第三|第四|第五|第[一二三四五六七八九十]+步)/.test(part)).length >= 2;
}

function looksLikeLooseList(parts: string[]): boolean {
  if (parts.length < 3) {
    return false;
  }
  return parts.filter((part) => /^(包括|比如|以及|同时|一方面|另一方面)/.test(part)).length >= 2;
}

function ensureSentencePunctuation(input: string): string {
  return /[，,。.!！?？；;]$/.test(input) ? input : `${input}。`;
}

function splitIntoTopicBlocks(input: string): string[] {
  return input
    .replace(
      /(换个话题|另一个问题(?:是)?|另外(?:一个)?(?:问题|话题)(?:是)?|第[一二三四五六七八九十\d]+个?问题(?:是)?|第[一二三四五六七八九十\d]+点|接下来(?:讲|说|处理|看)|说回到|还有一件事)/g,
      '\n$1'
    )
    .split(/\n+/)
    .map((block) => block.trim())
    .filter(Boolean);
}

function sentenceParts(input: string): string[] {
  return (
    input
      .match(/[^。.!！?？；;]+[。.!！?？；;]?/g)
      ?.map((part) => part.trim().replace(/[。.!！?？；;]+$/, '')) ?? []
  ).filter(Boolean);
}

function compactRepeatedSentences(parts: string[]): string[] {
  const output: string[] = [];
  for (const part of parts) {
    const normalized = normalizeComparableText(part);
    const previous = output[output.length - 1];
    const previousNormalized = previous ? normalizeComparableText(previous) : '';
    if (previousNormalized && (previousNormalized === normalized || (normalized.length >= 5 && previousNormalized.includes(normalized)))) {
      continue;
    }
    output.push(part);
  }
  return output;
}

function normalizeComparableText(input: string): string {
  return input.replace(/[\s，,。.!！?？；;、]/g, '');
}

function replaceAll(input: string, from: string, to: string, caseSensitive = false): { text: string; count: number } {
  if (!from) {
    return { text: input, count: 0 };
  }

  const flags = caseSensitive ? 'g' : 'gi';
  let count = 0;
  const text = input.replace(new RegExp(escapeRegExp(from), flags), () => {
    count += 1;
    return to;
  });
  return { text, count };
}

function normalizeWhitespace(input: string): string {
  return input
    .replace(/[ \t]+/g, ' ')
    .replace(/\s+([，,。.!！?？；;])/g, '$1')
    .replace(/([（(])\s+/g, '$1')
    .replace(/\s+([）)])/g, '$1')
    .trim();
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function containsText(input: string, needle: string, caseSensitive = false): boolean {
  if (!needle) {
    return false;
  }
  return caseSensitive ? input.includes(needle) : input.toLowerCase().includes(needle.toLowerCase());
}
