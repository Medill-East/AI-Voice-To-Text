import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('release workflow', () => {
  it('builds Windows artifacts on a Windows runner', async () => {
    const workflow = await readFile(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');

    expect(workflow).toContain('windows-latest');
    expect(workflow).toContain('npm run dist:win');
    expect(workflow).toContain('ELECTRON_BUILDER_PUBLISH: never');
    expect(workflow).toContain('release/*.exe');
    expect(workflow).toContain('release/*.zip');
  });

  it('prevents electron-builder publish during local packaging', async () => {
    const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as {
      scripts: Record<string, string>;
      build: { publish?: unknown };
    };

    expect(packageJson.scripts.dist).toContain('--publish=never');
    expect(packageJson.scripts['dist:win']).toContain('--win --publish=never');
    expect(packageJson.build.publish).toBeNull();
  });
});
