import { describe, expect, it } from 'vitest';
import { mergeLexicon, normalizeLexicon, parseBulkBlocked, parseBulkReplacements, parseBulkTerms } from '../src/core/lexiconTools';

describe('lexicon tools', () => {
  it('parses bulk terms separated by lines and punctuation', () => {
    expect(parseBulkTerms('王小波\n许知远，Qwen3-ASR、王小波')).toEqual([
      { phrase: '王小波', aliases: [] },
      { phrase: '许知远', aliases: [] },
      { phrase: 'Qwen3-ASR', aliases: [] }
    ]);
  });

  it('parses fixed replacements from arrow lines', () => {
    expect(parseBulkReplacements('Github -> GitHub\n错别词=>正确词\n无效行')).toEqual([
      { from: 'Github', to: 'GitHub', enabled: true },
      { from: '错别词', to: '正确词', enabled: true }
    ]);
  });

  it('normalizes and merges lexicon content without empty duplicates', () => {
    const merged = mergeLexicon(
      { version: 1, terms: [{ phrase: '王小波', aliases: ['王小博'] }], replacements: [], blocked: ['嗯'] },
      {
        terms: [{ phrase: '王小波', aliases: ['王小泊', '王小博'] }, { phrase: '' }],
        replacements: [{ from: 'Github', to: 'GitHub' }, { from: 'Github', to: 'GitHub' }],
        blocked: parseBulkBlocked('嗯，呃，啊')
      }
    );

    expect(normalizeLexicon(merged)).toEqual({
      version: 1,
      terms: [{ phrase: '王小波', aliases: ['王小博', '王小泊'], tags: undefined, caseSensitive: undefined }],
      replacements: [{ from: 'Github', to: 'GitHub', enabled: true }],
      blocked: ['嗯', '呃', '啊']
    });
  });
});
