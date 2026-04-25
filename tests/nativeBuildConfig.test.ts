import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('native helper build configuration', () => {
  it('builds and unpacks the V2T MacKeyServer helper', async () => {
    const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as {
      scripts: Record<string, string>;
      build: { asarUnpack: string[]; mac: { identity?: string } };
    };
    const buildScript = await readFile(new URL('../scripts/build-mac-key-server.mjs', import.meta.url), 'utf8');
    const swiftSource = await readFile(new URL('../native/MacKeyServer/main.swift', import.meta.url), 'utf8');

    expect(packageJson.scripts['build:native']).toBe('node scripts/build-mac-key-server.mjs');
    expect(packageJson.scripts.build).toContain('npm run build:native');
    expect(packageJson.build.asarUnpack).toContain('dist/native/**/*');
    expect(packageJson.build.mac.identity).not.toBe('-');
    expect(buildScript).toContain('codesign');
    expect(swiftSource).toContain('CGPreflightListenEventAccess');
    expect(swiftSource).toContain('CGRequestListenEventAccess');
    expect(swiftSource).toContain('options: .listenOnly');
  });
});
