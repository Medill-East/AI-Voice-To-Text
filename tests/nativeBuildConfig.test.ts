import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('native helper build configuration', () => {
  it('builds and unpacks the V2T MacKeyServer helper', async () => {
    const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as {
      scripts: Record<string, string>;
      build: { asarUnpack: string[]; mac: { identity?: string } };
    };
    const nativeBuildScript = await readFile(new URL('../scripts/build-native.mjs', import.meta.url), 'utf8');
    const windowsBuildScript = await readFile(new URL('../scripts/build-windows-key-listener.mjs', import.meta.url), 'utf8');
    const cargoToml = await readFile(new URL('../native/windows-key-listener/Cargo.toml', import.meta.url), 'utf8');
    const windowsSource = await readFile(new URL('../native/windows-key-listener/src/main.rs', import.meta.url), 'utf8');
    const swiftSource = await readFile(new URL('../native/MacKeyServer/main.swift', import.meta.url), 'utf8');

    expect(packageJson.scripts['build:native']).toBe('node scripts/build-native.mjs');
    expect(packageJson.scripts.build).toContain('npm run build:native');
    expect(packageJson.build.asarUnpack).toContain('dist/native/**/*');
    expect(packageJson.build.asarUnpack).not.toContain('node_modules/node-global-key-listener/**/*');
    expect(JSON.stringify(packageJson.build)).toContain('!node_modules/node-global-key-listener/bin/WinKeyServer.exe');
    expect(packageJson.build.mac.identity).not.toBe('-');
    expect(nativeBuildScript).toContain('build-windows-key-listener.mjs');
    expect(windowsBuildScript).toContain('V2TKeyboardListener.exe');
    expect(windowsBuildScript).toContain('cargo');
    expect(cargoToml).toContain('windows');
    expect(windowsSource).toContain('RegisterRawInputDevices');
    expect(windowsSource).toContain('RIDEV_INPUTSINK');
    expect(windowsSource).toContain('normalize_side_specific_vkey');
    expect(windowsSource).toContain('VK_RCONTROL');
    expect(windowsSource).toContain('VK_RMENU');
    expect(windowsSource).not.toContain('SetWindowsHookEx');
    expect(windowsSource).not.toContain('SendInput');
    expect(swiftSource).toContain('CGPreflightListenEventAccess');
    expect(swiftSource).toContain('CGRequestListenEventAccess');
    expect(swiftSource).toContain('options: .listenOnly');
  });
});
