import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('release workflow', () => {
  it('builds Windows artifacts on a Windows runner', async () => {
    const workflow = await readFile(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');

    expect(workflow).toContain('windows-latest');
    expect(workflow).toContain('npm run dist -- --win');
    expect(workflow).toContain('release/*.exe');
    expect(workflow).toContain('release/*.zip');
  });
});
