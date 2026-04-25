import type { Lexicon, LlmClient, ProcessTextOptions, ProcessedText } from './types';

const DEFAULT_NATURAL_PROMPT =
  '你是保守的中文语音输入纠错器。只修正明显识别错误、专有名词、标点和少量口头禅，不改变语序、观点或文风。';

const DEFAULT_STRUCTURED_PROMPT =
  '把用户口述内容整理为易读 Markdown。保留原意，按话题边界自动使用段落、空行、编号或列表；不同话题之间用空行分隔。不要默认把每一句都变成列表；只有在步骤、清单、并列观点明显时才使用列表或编号。不强行添加背景、目标、约束等固定模板。';

export class PostProcessor {
  private readonly llm?: LlmClient;

  constructor(options: { llm?: LlmClient } = {}) {
    this.llm = options.llm;
  }

  async process(input: string, options: ProcessTextOptions): Promise<ProcessedText> {
    const corrected = normalizeWhitespace(applyLexicon(stripBlockedAndFillers(input, options.lexicon), options.lexicon));

    if (options.mode === 'natural') {
      return { text: corrected, usedLlm: false };
    }

    if (this.llm) {
      const text = await this.llm.complete({
        mode: 'structured',
        input: corrected,
        systemPrompt: options.prompt ?? DEFAULT_STRUCTURED_PROMPT
      });

      return { text: text.trim(), usedLlm: true };
    }

    return { text: toReadableMarkdown(corrected), usedLlm: false };
  }
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
    .replace(/(^|[\s，,。.!！?？；;])(?:嗯+|呃+|啊+|那个|这个)(?=$|[\s，,。.!！?？；;])/g, '$1')
    .replace(/[，,。.!！?？；;]\s*$/g, '');
}

function toReadableMarkdown(input: string): string {
  const normalized = markTopicBoundaries(input);
  const parts = normalized
    .split(/(?:。|！|!|？|\?|；|;|\n)+/)
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

  return parts.map((part) => ensureSentencePunctuation(part)).join('\n\n');
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

function markTopicBoundaries(input: string): string {
  return input.replace(/(换个话题|另外|接下来|说回到|第二点|第三点|第四点|第五点|还有一件事)/g, '\n$1');
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
