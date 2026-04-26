import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  bundledWinKeyServerPath,
  bundledV2TMacKeyServerPath,
  cleanupStaleWinKeyServerProcesses,
  ensureStableMacKeyServer,
  ensureStableWinKeyServer,
  ensureWindowsKeyServerAvailable,
  resolveBundledMacKeyServerPath,
  selectStaleWinKeyServerProcesses,
  stableWinKeyServerPath,
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

  it('copies WinKeyServer.exe into a stable app data path', async () => {
    const root = await mkdtemp(join(tmpdir(), 'v2t-win-key-helper-'));
    const source = join(root, 'WinKeyServer.exe');
    const userData = join(root, 'AppData', 'Roaming', 'V2T');
    await writeFile(source, 'fake windows helper');

    const target = await ensureStableWinKeyServer(source, userData);

    expect(target).toBe(join(userData, 'keyboard-listener', 'WinKeyServer.exe'));
    expect(target).toBe(stableWinKeyServerPath(userData));
    await expect(readFile(target, 'utf8')).resolves.toBe('fake windows helper');
  });

  it('resolves packaged asar paths to asar.unpacked paths', () => {
    expect(unpackedAsarPath('/Applications/V2T.app/Contents/Resources/app.asar/node_modules/pkg/bin/MacKeyServer')).toBe(
      '/Applications/V2T.app/Contents/Resources/app.asar.unpacked/node_modules/pkg/bin/MacKeyServer'
    );
    expect(unpackedAsarPath('C:\\Program Files\\V2T\\resources\\app.asar\\node_modules\\pkg\\bin\\WinKeyServer.exe')).toBe(
      'C:\\Program Files\\V2T\\resources\\app.asar.unpacked\\node_modules\\pkg\\bin\\WinKeyServer.exe'
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

  it('resolves packaged Windows helper paths outside app.asar', () => {
    expect(
      bundledWinKeyServerPath(
        '/Applications/V2T.app/Contents/Resources/app.asar/node_modules/node-global-key-listener/bin/WinKeyServer.exe'
      )
    ).toBe('/Applications/V2T.app/Contents/Resources/app.asar.unpacked/node_modules/node-global-key-listener/bin/WinKeyServer.exe');
  });

  it('prefers the bundled Windows helper and repairs the stable AppData copy', async () => {
    const root = await mkdtemp(join(tmpdir(), 'v2t-win-key-available-'));
    const source = join(root, 'app.asar.unpacked', 'node_modules', 'node-global-key-listener', 'bin', 'WinKeyServer.exe');
    const userData = join(root, 'Roaming', 'V2T');
    await mkdir(join(root, 'app.asar.unpacked', 'node_modules', 'node-global-key-listener', 'bin'), { recursive: true });
    await writeFile(source, 'bundled helper');

    const result = await ensureWindowsKeyServerAvailable(source, userData);

    expect(result).toMatchObject({
      helperPath: source,
      helperSourcePath: source,
      stablePath: stableWinKeyServerPath(userData),
      helperFileExists: true,
      repairAttempted: true
    });
    await expect(readFile(stableWinKeyServerPath(userData), 'utf8')).resolves.toBe('bundled helper');
  });

  it('falls back to the stable Windows helper when the bundled helper is unavailable', async () => {
    const root = await mkdtemp(join(tmpdir(), 'v2t-win-key-stable-'));
    const source = join(root, 'missing', 'WinKeyServer.exe');
    const userData = join(root, 'Roaming', 'V2T');
    await mkdir(join(userData, 'keyboard-listener'), { recursive: true });
    await writeFile(stableWinKeyServerPath(userData), 'stable helper');

    const result = await ensureWindowsKeyServerAvailable(source, userData);

    expect(result).toMatchObject({
      helperPath: stableWinKeyServerPath(userData),
      helperSourcePath: source,
      stablePath: stableWinKeyServerPath(userData),
      helperFileExists: true,
      repairAttempted: false
    });
  });

  it('reports a missing Windows helper when neither bundled nor stable copy exists', async () => {
    const root = await mkdtemp(join(tmpdir(), 'v2t-win-key-missing-'));
    const source = join(root, 'missing', 'WinKeyServer.exe');
    const userData = join(root, 'Roaming', 'V2T');

    await expect(ensureWindowsKeyServerAvailable(source, userData)).rejects.toThrow('WinKeyServer.exe 未找到');
  });

  it('selects only V2T-owned stale WinKeyServer processes', () => {
    const processes = [
      { processId: 11, executablePath: 'C:\\Users\\me\\AppData\\Roaming\\V2T\\keyboard-listener\\WinKeyServer.exe' },
      { processId: 12, executablePath: 'C:\\Users\\me\\Downloads\\Other\\WinKeyServer.exe' },
      { processId: 13, commandLine: '"C:\\Program Files\\V2T\\resources\\app.asar.unpacked\\node_modules\\node-global-key-listener\\bin\\WinKeyServer.exe"' },
      { processId: 14, executablePath: 'C:\\Program Files\\V2T-Other\\WinKeyServer.exe' }
    ];

    expect(
      selectStaleWinKeyServerProcesses(processes, [
        'C:\\Users\\me\\AppData\\Roaming\\V2T\\keyboard-listener',
        'C:\\Program Files\\V2T\\resources\\app.asar.unpacked'
      ]).map((process) => process.processId)
    ).toEqual([11, 13]);
  });

  it('returns a cleanup diagnostic instead of throwing when process listing fails', () => {
    const result = cleanupStaleWinKeyServerProcesses({
      roots: ['C:\\Users\\me\\AppData\\Roaming\\V2T\\keyboard-listener'],
      listProcesses: () => {
        throw new Error('PowerShell unavailable');
      },
      killProcess: () => true
    });

    expect(result).toMatchObject({
      staleHelperCount: 0,
      staleHelperKilled: 0,
      errors: ['PowerShell unavailable']
    });
  });

  it('cleans up only selected stale WinKeyServer processes', () => {
    const killed: number[] = [];

    const result = cleanupStaleWinKeyServerProcesses({
      roots: ['C:\\Users\\me\\AppData\\Roaming\\V2T\\keyboard-listener'],
      listProcesses: () => [
        { processId: 21, executablePath: 'C:\\Users\\me\\AppData\\Roaming\\V2T\\keyboard-listener\\WinKeyServer.exe' },
        { processId: 22, executablePath: 'C:\\Other\\WinKeyServer.exe' }
      ],
      killProcess: (processId) => {
        killed.push(processId);
        return true;
      }
    });

    expect(result).toMatchObject({ staleHelperCount: 1, staleHelperKilled: 1 });
    expect(killed).toEqual([21]);
  });
});
