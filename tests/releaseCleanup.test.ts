import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('local release cleanup workflow', () => {
  it('keeps cleanup as a fixed post-release operation', async () => {
    const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as {
      scripts: Record<string, string>;
    };
    const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
    const agents = await readFile(new URL('../AGENTS.md', import.meta.url), 'utf8');
    const script = await readFile(new URL('../scripts/clean-local-release.mjs', import.meta.url), 'utf8');

    expect(packageJson.scripts['release:cleanup']).toBe('node scripts/clean-local-release.mjs');
    expect(readme).toContain('npm run release:cleanup');
    expect(agents).toContain('After pushing a change that publishes a GitHub Release');
    expect(agents).toContain('Every user-visible release must bump');
    expect(script).toContain('release/mac-arm64/V2T.app');
    expect(script).toContain('currentMacDmg');
  });
});
