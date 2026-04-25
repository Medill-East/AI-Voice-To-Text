import type { Lexicon, LlmClient, ProcessTextOptions, ProcessedText } from './types';

const DEFAULT_NATURAL_PROMPT =
  '你是保守的中文语音输入纠错器。只修正明显识别错误、专有名词、标点和少量口头禅，不改变语序、观点或文风。';

const DEFAULT_STRUCTURED_PROMPT =
  '把用户口述内容整理为 Markdown。保留原意，使用分点和必要层级，不强行添加背景、目标、约束等固定模板。';

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

    return { text: toMarkdownBullets(corrected), usedLlm: false };
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

function toMarkdownBullets(input: string): string {
  const parts = input
    .split(/(?:。|！|!|？|\?|；|;|\n)+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length === 0) {
    return '';
  }

  return parts.map((part) => `- ${part}`).join('\n');
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
