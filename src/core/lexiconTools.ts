import type { Lexicon, LexiconTerm, LexiconTextKind, ReplacementRule } from './types';

const TOKEN_SEPARATOR = /[\n,，、;；]+/;
const REPLACEMENT_SEPARATOR = /\s*(?:=>|->|→)\s*/;

export function parseBulkTerms(input: string): LexiconTerm[] {
  return uniqueStrings(splitTokens(input)).map((phrase) => ({ phrase, aliases: [] }));
}

export function parseBulkBlocked(input: string): string[] {
  return uniqueStrings(splitTokens(input));
}

export function parseBulkReplacements(input: string): ReplacementRule[] {
  const rules: ReplacementRule[] = [];
  for (const line of input.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const [from, to] = trimmed.split(REPLACEMENT_SEPARATOR).map((part) => part?.trim());
    if (from && to) {
      rules.push({ from, to, enabled: true });
    }
  }
  return uniqueReplacements(rules);
}

export function normalizeLexicon(lexicon: Lexicon): Lexicon {
  return {
    version: lexicon.version || 1,
    terms: normalizeTerms(lexicon.terms),
    replacements: normalizeReplacements(lexicon.replacements),
    blocked: uniqueStrings(lexicon.blocked.map((word) => word.trim()).filter(Boolean))
  };
}

export function mergeLexicon(base: Lexicon, patch: Partial<Lexicon>): Lexicon {
  return normalizeLexicon({
    version: base.version || 1,
    terms: [...base.terms, ...(patch.terms ?? [])],
    replacements: [...base.replacements, ...(patch.replacements ?? [])],
    blocked: [...base.blocked, ...(patch.blocked ?? [])]
  });
}

export function lexiconText(kind: LexiconTextKind, lexicon: Lexicon): string {
  const normalized = normalizeLexicon(lexicon);
  if (kind === 'terms') {
    return `${normalized.terms.map((term) => [term.phrase, ...(term.aliases ?? [])].join(', ')).join('\n')}\n`;
  }
  if (kind === 'replacements') {
    return `${normalized.replacements.map((rule) => `${rule.from} -> ${rule.to}`).join('\n')}\n`;
  }
  return `${normalized.blocked.join('\n')}\n`;
}

export function lexiconPatchFromText(kind: LexiconTextKind, input: string): Partial<Lexicon> {
  if (kind === 'terms') {
    return { terms: parseTermsFile(input) };
  }
  if (kind === 'replacements') {
    return { replacements: parseBulkReplacements(input) };
  }
  return { blocked: parseBulkBlocked(input) };
}

function splitTokens(input: string): string[] {
  return input
    .split(TOKEN_SEPARATOR)
    .map((value) => value.trim())
    .filter(Boolean);
}

function parseTermsFile(input: string): LexiconTerm[] {
  const terms: LexiconTerm[] = [];
  for (const line of input.split(/\r?\n/)) {
    const tokens = splitTokens(line);
    if (!tokens.length) {
      continue;
    }
    terms.push({ phrase: tokens[0], aliases: tokens.slice(1) });
  }
  return normalizeTerms(terms);
}

function normalizeTerms(terms: LexiconTerm[]): LexiconTerm[] {
  const byPhrase = new Map<string, LexiconTerm>();
  for (const term of terms) {
    const phrase = term.phrase.trim();
    if (!phrase) {
      continue;
    }
    const existing = byPhrase.get(phrase);
    const aliases = uniqueStrings([...(existing?.aliases ?? []), ...(term.aliases ?? []).map((alias) => alias.trim()).filter(Boolean)].filter((alias) => alias !== phrase));
    byPhrase.set(phrase, {
      ...term,
      phrase,
      aliases,
      tags: term.tags?.map((tag) => tag.trim()).filter(Boolean),
      caseSensitive: term.caseSensitive
    });
  }
  return [...byPhrase.values()];
}

function normalizeReplacements(replacements: ReplacementRule[]): ReplacementRule[] {
  return uniqueReplacements(
    replacements
      .map((rule) => ({
        ...rule,
        from: rule.from.trim(),
        to: rule.to.trim(),
        enabled: rule.enabled ?? true
      }))
      .filter((rule) => rule.from && rule.to)
  );
}

function uniqueReplacements(replacements: ReplacementRule[]): ReplacementRule[] {
  const byKey = new Map<string, ReplacementRule>();
  for (const rule of replacements) {
    byKey.set(`${rule.from}\u0000${rule.to}`, rule);
  }
  return [...byKey.values()];
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}
