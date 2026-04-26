import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('release workflow', () => {
  it('builds macOS and Windows artifacts before publishing a GitHub Release', async () => {
    const workflow = await readFile(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');

    expect(workflow).toContain('contents: write');
    expect(workflow).toContain('build-mac:');
    expect(workflow).toContain('macos-latest');
    expect(workflow).toContain('npm run dist:mac:ci');
    expect(workflow).toContain('v2t-macos');
    expect(workflow).toContain('release/*.dmg');
    expect(workflow).toContain('release/*-mac-*.zip');
    expect(workflow).toContain('CSC_IDENTITY_AUTO_DISCOVERY: false');
    expect(workflow).toContain('windows-latest');
    expect(workflow).toContain('dtolnay/rust-toolchain@stable');
    expect(workflow).toContain('npm run dist:win');
    expect(workflow).toContain('npm run verify:win-release');
    expect(workflow).toContain('ELECTRON_BUILDER_PUBLISH: never');
    expect(workflow).toContain('release/*.exe');
    expect(workflow).toContain('release/*-win-*.zip');
    expect(workflow).toContain('publish-release:');
    expect(workflow).toContain('needs: [build-mac, build-windows]');
    expect(workflow).toContain('actions/download-artifact@v4');
    expect(workflow).toContain('TAG=\"v${VERSION}-${SHORT_SHA}\"');
    expect(workflow).toContain('gh release create \"$TAG\"');
    expect(workflow).toContain('gh release upload \"$TAG\" release-assets/* --clobber');
    expect(workflow).toContain('未 notarize/未正式签名');
  });

  it('prevents electron-builder publish during local packaging', async () => {
    const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as {
      scripts: Record<string, string>;
      build: { publish?: unknown };
    };

    expect(packageJson.scripts.dist).toContain('--publish=never');
    expect(packageJson.scripts['dist:mac:ci']).toContain('--mac --publish=never');
    expect(packageJson.scripts['dist:mac:ci']).toContain('-c.mac.identity=null');
    expect(packageJson.scripts['dist:win']).toContain('--win --publish=never');
    expect(packageJson.scripts['dist:win']).toContain('npm run verify:win-release');
    expect(packageJson.scripts['verify:win-release']).toContain('scripts/verify-windows-release.mjs');
    expect(packageJson.build.publish).toBeNull();
  });
});
