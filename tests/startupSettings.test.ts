import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('startup settings', () => {
  it('configures login item silent startup and skips showing the main window', async () => {
    const main = await readFile(new URL('../src/main/index.ts', import.meta.url), 'utf8');
    const app = await readFile(new URL('../src/renderer/App.tsx', import.meta.url), 'utf8');

    expect(main).toContain("args: openAtLogin && silentOpenAtLogin ? ['--silent-start'] : []");
    expect(main).toContain('if (!isSilentStartup())');
    expect(main).toContain("argv.includes('--silent-start')");
    expect(app).toContain('开机时静默进入菜单栏');
  });
});
