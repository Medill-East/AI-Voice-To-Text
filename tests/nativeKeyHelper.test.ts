import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  bundledV2TMacKeyServerPath,
  ensureStableMacKeyServer,
  resolveBundledMacKeyServerPath,
  stableMacKeyServerPath,
  unpackedAsarPath
} from '../src/main/nativeKeyHelper';

describe('native key helper', () => {
  it('copies MacKeyServer into a stable app data path with executable permissions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'v2t-key-helper-'));
    const source = join(root, 'source-MacKeyServer');
    const userData = join(root, 'Application Support', 'V2T');
    await writeFile(source, 'fake helper');

    const target = await ensureStableMacKeyServer(source, userData);

    expect(target).toBe(join(userData, 'keyboard-listener', 'MacKeyServer'));
    expect(target).toBe(stableMacKeyServerPath(userData));
    await expect(readFile(target, 'utf8')).resolves.toBe('fake helper');
    expect((await stat(target)).mode & 0o111).not.toBe(0);
  });

  it('resolves packaged asar paths to asar.unpacked paths', () => {
    expect(unpackedAsarPath('/Applications/V2T.app/Contents/Resources/app.asar/node_modules/pkg/bin/MacKeyServer')).toBe(
      '/Applications/V2T.app/Contents/Resources/app.asar.unpacked/node_modules/pkg/bin/MacKeyServer'
    );
    expect(unpackedAsarPath('/Users/me/V2T/node_modules/pkg/bin/MacKeyServer')).toBe('/Users/me/V2T/node_modules/pkg/bin/MacKeyServer');
  });

  it('prefers the V2T bundled helper over the npm package fallback', async () => {
    const root = await mkdtemp(join(tmpdir(), 'v2t-bundled-helper-'));
    const mainDir = join(root, 'dist', 'main');
    const helper = join(root, 'dist', 'native', 'MacKeyServer');
    const fallback = join(root, 'node_modules', 'node-global-key-listener', 'bin', 'MacKeyServer');
    await mkdir(join(root, 'dist', 'native'), { recursive: true });
    await mkdir(join(root, 'node_modules', 'node-global-key-listener', 'bin'), { recursive: true });
    await writeFile(helper, 'v2t helper');
    await writeFile(fallback, 'fallback helper');

    expect(bundledV2TMacKeyServerPath(mainDir)).toBe(helper);
    await expect(resolveBundledMacKeyServerPath(mainDir, fallback)).resolves.toBe(helper);
  });

  it('resolves packaged V2T helper paths outside app.asar', () => {
    expect(bundledV2TMacKeyServerPath('/Applications/V2T.app/Contents/Resources/app.asar/dist/main')).toBe(
      '/Applications/V2T.app/Contents/Resources/app.asar.unpacked/dist/native/MacKeyServer'
    );
  });
});
