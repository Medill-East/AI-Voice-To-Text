import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  bundledV2TMacKeyServerPath,
  cleanupStaleWinKeyServerProcesses,
  cleanupStableWinKeyServer,
  ensureStableMacKeyServer,
  reinstallStableMacKeyServer,
  resolveBundledV2TAudioControlPath,
  resolveBundledV2TKeyboardListenerPath,
  resolveBundledMacKeyServerPath,
  selectStaleWinKeyServerProcesses,
  stableV2TKeyboardListenerPath,
  stableWinKeyServerPath,
  stableMacKeyServerPath,
  unpackedAsarPath,
  V2T_MAC_KEYSERVER_PROTOCOL_VERSION
} from '../src/main/nativeKeyHelper';

describe('native key helper', () => {
  it('copies MacKeyServer into a stable app data path with executable permissions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'v2t-key-helper-'));
    const source = join(root, 'source-MacKeyServer');
    const userData = join(root, 'Application Support', 'V2T');
    await writeFile(source, 'fake helper');

    const result = await ensureStableMacKeyServer(source, userData, {
      readVersion: () => ({ protocolVersion: V2T_MAC_KEYSERVER_PROTOCOL_VERSION })
    });
    const target = result.path;

    expect(target).toBe(join(userData, 'keyboard-listener', 'MacKeyServer'));
    expect(target).toBe(stableMacKeyServerPath(userData));
    expect(result).toMatchObject({ copied: true, reusedExisting: false, needsHelperUpgrade: false });
    await expect(readFile(target, 'utf8')).resolves.toBe('fake helper');
    expect((await stat(target)).mode & 0o111).not.toBe(0);
  });

  it('reuses a compatible stable MacKeyServer without overwriting permissions-sensitive file identity', async () => {
    const root = await mkdtemp(join(tmpdir(), 'v2t-key-helper-reuse-'));
    const source = join(root, 'source-MacKeyServer');
    const userData = join(root, 'Application Support', 'V2T');
    const target = stableMacKeyServerPath(userData);
    await mkdir(join(userData, 'keyboard-listener'), { recursive: true });
    await writeFile(source, 'new helper');
    await writeFile(target, 'already authorized helper');
    const before = await stat(target);

    const result = await ensureStableMacKeyServer(source, userData, {
      readVersion: (filePath) => (filePath === target ? { protocolVersion: V2T_MAC_KEYSERVER_PROTOCOL_VERSION } : { protocolVersion: V2T_MAC_KEYSERVER_PROTOCOL_VERSION })
    });

    expect(result).toMatchObject({ copied: false, reusedExisting: true, needsHelperUpgrade: false });
    await expect(readFile(target, 'utf8')).resolves.toBe('already authorized helper');
    expect((await stat(target)).mtimeMs).toBe(before.mtimeMs);
  });

  it('reports a helper upgrade requirement without silently replacing incompatible MacKeyServer', async () => {
    const root = await mkdtemp(join(tmpdir(), 'v2t-key-helper-upgrade-'));
    const source = join(root, 'source-MacKeyServer');
    const userData = join(root, 'Application Support', 'V2T');
    const target = stableMacKeyServerPath(userData);
    await mkdir(join(userData, 'keyboard-listener'), { recursive: true });
    await writeFile(source, 'new helper');
    await writeFile(target, 'old helper');

    const result = await ensureStableMacKeyServer(source, userData, {
      readVersion: (filePath) => (filePath === target ? { protocolVersion: '0' } : { protocolVersion: V2T_MAC_KEYSERVER_PROTOCOL_VERSION })
    });

    expect(result).toMatchObject({ copied: false, reusedExisting: false, needsHelperUpgrade: true });
    await expect(readFile(target, 'utf8')).resolves.toBe('old helper');
  });

  it('reinstalls MacKeyServer only when explicitly requested', async () => {
    const root = await mkdtemp(join(tmpdir(), 'v2t-key-helper-reinstall-'));
    const source = join(root, 'source-MacKeyServer');
    const userData = join(root, 'Application Support', 'V2T');
    const target = stableMacKeyServerPath(userData);
    await mkdir(join(userData, 'keyboard-listener'), { recursive: true });
    await writeFile(source, 'new helper');
    await writeFile(target, 'old helper');

    const result = await reinstallStableMacKeyServer(source, userData);

    expect(result).toMatchObject({ copied: true, needsHelperUpgrade: false });
    await expect(readFile(target, 'utf8')).resolves.toBe('new helper');
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
    expect(resolveBundledV2TKeyboardListenerPath('/Applications/V2T.app/Contents/Resources/app.asar/dist/main')).toBe(
      '/Applications/V2T.app/Contents/Resources/app.asar.unpacked/dist/native/V2TKeyboardListener.exe'
    );
  });

  it('resolves the V2T Windows Raw Input listener from dist/native', () => {
    expect(resolveBundledV2TKeyboardListenerPath('C:\\Program Files\\V2T\\resources\\app.asar\\dist\\main')).toBe(
      'C:\\Program Files\\V2T\\resources\\app.asar.unpacked\\dist\\native\\V2TKeyboardListener.exe'
    );
    expect(stableV2TKeyboardListenerPath('C:\\Users\\me\\AppData\\Roaming\\V2T')).toBe(
      'C:\\Users\\me\\AppData\\Roaming\\V2T\\keyboard-listener\\V2TKeyboardListener.exe'
    );
  });

  it('resolves the V2T Windows audio control helper from dist/native', () => {
    expect(resolveBundledV2TAudioControlPath('C:\\Program Files\\V2T\\resources\\app.asar\\dist\\main')).toBe(
      'C:\\Program Files\\V2T\\resources\\app.asar.unpacked\\dist\\native\\V2TAudioControl.exe'
    );
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

  it('deletes only the legacy stable WinKeyServer copy from V2T app data', async () => {
    const root = await mkdtemp(join(tmpdir(), 'v2t-win-key-delete-'));
    const userData = join(root, 'Roaming', 'V2T');
    await mkdir(join(userData, 'keyboard-listener'), { recursive: true });
    await writeFile(stableWinKeyServerPath(userData), 'legacy helper');
    await writeFile(stableV2TKeyboardListenerPath(userData), 'new helper');

    const result = await cleanupStableWinKeyServer(userData);

    expect(result).toMatchObject({ attempted: true, deleted: true });
    await expect(readFile(stableV2TKeyboardListenerPath(userData), 'utf8')).resolves.toBe('new helper');
    await expect(readFile(stableWinKeyServerPath(userData), 'utf8')).rejects.toThrow();
  });
});
