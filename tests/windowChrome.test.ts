import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('window chrome styles', () => {
  it('uses a fixed shell with a scrollable page content area', async () => {
    const css = await readFile(new URL('../src/renderer/styles.css', import.meta.url), 'utf8');

    expect(css).toMatch(/\.shell\s*\{[^}]*height:\s*100vh;[^}]*overflow:\s*hidden;/s);
    expect(css).toMatch(/\.page-content\s*\{[^}]*overflow-y:\s*auto;/s);
    expect(css).toMatch(/\.topbar\s*\{[^}]*-webkit-app-region:\s*drag;/s);
    const noDragBlocks = css.match(/[^{}]+\{[^{}]*-webkit-app-region:\s*no-drag;?[^{}]*\}/g)?.join('\n') ?? '';
    expect(noDragBlocks).toMatch(/\.page-nav/);
    expect(noDragBlocks).toMatch(/\.page-content/);
    expect(noDragBlocks).not.toMatch(/(^|,|\n)\s*\.shell\s*(,|\{)/);
    expect(noDragBlocks).not.toMatch(/(^|,|\n)\s*\.side\s*(,|\{)/);
    expect(css).toContain(':root[data-theme="dark"]');
    expect(css).toContain('@media (prefers-color-scheme: dark)');
  });

  it('keeps standard edit actions in the application menu for text fields', async () => {
    const main = await readFile(new URL('../src/main/index.ts', import.meta.url), 'utf8');

    for (const role of ['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll']) {
      expect(main).toContain(`role: '${role}'`);
    }
    expect(main).toContain("ipcMain.on('v2t:show-edit-menu'");
  });

  it('marks advanced settings inputs as no-drag and opens the edit context menu', async () => {
    const app = await readFile(new URL('../src/renderer/App.tsx', import.meta.url), 'utf8');

    expect(app).toContain('onContextMenu={showEditMenu}');
    expect(app).toContain('className="no-drag"');
    expect(app).toContain('Local Base URL');
    expect(app).toContain('Local Model');
    expect(app).toContain('Cloud Base URL');
    expect(app).toContain('Cloud Model');
  });
});
