import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('lexicon IPC surface', () => {
  it('exposes lexicon loading and saving through preload and main IPC', async () => {
    const preload = await readFile(new URL('../src/preload/index.ts', import.meta.url), 'utf8');
    const main = await readFile(new URL('../src/main/index.ts', import.meta.url), 'utf8');

    expect(preload).toContain('getLexicon(): Promise<Lexicon>');
    expect(preload).toContain('saveLexicon(lexicon: Lexicon): Promise<LexiconSaveResult>');
    expect(preload).toContain("ipcRenderer.invoke('v2t:get-lexicon')");
    expect(preload).toContain("ipcRenderer.invoke('v2t:save-lexicon', lexicon)");
    expect(main).toContain("ipcMain.handle('v2t:get-lexicon'");
    expect(main).toContain("ipcMain.handle('v2t:save-lexicon'");
    expect(main).toContain('store.saveLexicon');
  });
});
