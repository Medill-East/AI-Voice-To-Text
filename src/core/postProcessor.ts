import type { Lexicon, LlmClient, ProcessTextOptions, ProcessedText } from './types';

const DEFAULT_NATURAL_PROMPT =
  '你是保守的中文语音输入纠错器。只修正明显识别错误、专有名词、标点和少量口头禅，不改变语序、观点或文风。不要输出 Thinking Process、reasoning、分析步骤或解释，只输出最终正文。';

const DEFAULT_STRUCTURED_PROMPT = `你是中文语音输入的结构化整理器。

目标：把口述内容整理成适合阅读和继续交给 AI 处理的 Markdown，保留原意，不添加新事实，不改变用户立场。

处理规则：
1. 删除明显口头噪声和识别残留：/sil、<|...|>、嗯、呃、啊、就是、那个、这个、对、你懂我意思吧、你懂我意思吗，以及明显重复的短词或短句。
2. 同一主题内不要因为停顿、重复表达或普通连接词反复分段；优先合并成 1-3 个自然段。
3. 只有出现明确的新话题、问题编号、步骤、任务清单或并列观点时，才使用空行、编号或列表。
4. 不默认每句加项目符号，不要默认把每一句都变成列表，不强行添加“背景/目标/约束/总结”等模板标题。
5. 保留中文、英文、产品名、模型名和代码词；中英混排不要翻译专有名词。
6. 不要进行长篇推理，不要输出 Thinking Process、reasoning、分析步骤或解释；如果需要整理，直接给最终正文。
7. 只输出整理后的正文，不解释你做了什么。`;

export class PostProcessor {
  private readonly llm?: LlmClient;
  private readonly fallbackLlm?: LlmClient;

  constructor(options: { llm?: LlmClient; fallbackLlm?: LlmClient } = {}) {
    this.llm = options.llm;
    this.fallbackLlm = options.fallbackLlm;
  }

  async process(input: string, options: ProcessTextOptions): Promise<ProcessedText> {
    const corrected = normalizeWhitespace(applyLexicon(stripBlockedAndFillers(input, options.lexicon), options.lexicon));

    if (options.mode === 'natural') {
      return { text: corrected, usedLlm: false, engine: 'local-rules' };
    }

    if (this.llm) {
      const request = {
        mode: 'structured' as const,
        input: corrected,
        systemPrompt: options.prompt ?? DEFAULT_STRUCTURED_PROMPT
      };
      try {
        const text = await this.llm.complete(request);
        return { text: text.trim(), usedLlm: true, engine: 'llm-local' };
      } catch (error) {
        if (this.fallbackLlm) {
          try {
            const text = await this.fallbackLlm.complete(request);
            return { text: text.trim(), usedLlm: true, engine: 'llm-fallback', llmError: readableError(error) };
          } catch (fallbackError) {
            return {
              text: toReadableMarkdown(corrected),
              usedLlm: false,
              engine: 'local-rules',
              llmError: `${readableError(error)}；云端兜底失败：${readableError(fallbackError)}`
            };
          }
        }

        return { text: toReadableMarkdown(corrected), usedLlm: false, engine: 'local-rules', llmError: readableError(error) };
      }
    }

    return { text: toReadableMarkdown(corrected), usedLlm: false, engine: 'local-rules' };
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

function applyLexicon(input: string, lexicon: Lexicon): string {
  let output = input;

  for (const term of lexicon.terms) {
    for (const alias of term.aliases ?? []) {
      output = replaceAll(output, alias, term.phrase, term.caseSensitive);
    }
  }

  for (const replacement of lexicon.replacements) {
    if (replacement.enabled === false) {
      continue;
    }
    output = replaceAll(output, replacement.from, replacement.to, replacement.caseSensitive);
  }

  return output;
}

function stripBlockedAndFillers(input: string, lexicon: Lexicon): string {
  let output = input;

  for (const blocked of lexicon.blocked) {
    output = replaceAll(output, blocked, '', true);
  }

  return output
    .replace(/\/sil\b/gi, '')
    .replace(/<\|[^>]+?\|>/g, '')
    .replace(/你懂我意思[吧吗]?/g, '')
    .replace(/(^|[\s，,。.!！?？；;、])(?:嗯+|呃+|额+|啊+|唔+)(?=$|[\s，,。.!！?？；;、])/g, '$1')
    .replace(/(就是|那个|这个)/g, '')
    .replace(/(^|[\s，,。.!！?？；;、])对(?=$|[\s，,。.!！?？；;、])/g, '$1')
    .replace(/\s+([，,。.!！?？；;])/g, '$1')
    .replace(/([，,。.!！?？；;])\s+/g, '$1')
    .replace(/[，,。.!！?？；;]\s*$/g, '');
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
  return parts.filter((part) => /^(首先|其次|然后|接着|再|最后|第一|第二|第三|第四|第五|第[一二三四五六七八九十]+步)/.test(part)).length >= 2;
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

function replaceAll(input: string, from: string, to: string, caseSensitive = false): string {
  if (!from) {
    return input;
  }

  const flags = caseSensitive ? 'g' : 'gi';
  return input.replace(new RegExp(escapeRegExp(from), flags), to);
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
