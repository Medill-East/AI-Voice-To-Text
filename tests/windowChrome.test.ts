import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('window chrome styles', () => {
  it('makes the top bar draggable while keeping controls interactive', async () => {
    const css = await readFile(new URL('../src/renderer/styles.css', import.meta.url), 'utf8');

    expect(css).toContain('.shell');
    expect(css).toContain('.topbar');
    expect(css).toContain('-webkit-app-region: drag');
    expect(css).toContain('-webkit-app-region: no-drag');
    expect(css).toContain('.model-row');
  });
});
