import { constants } from 'node:fs';
import { access, chmod, copyFile, mkdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export function stableMacKeyServerPath(userDataPath: string): string {
  return join(userDataPath, 'keyboard-listener', 'MacKeyServer');
}

export function stableWinKeyServerPath(userDataPath: string): string {
  return join(userDataPath, 'keyboard-listener', 'WinKeyServer.exe');
}

export function unpackedAsarPath(filePath: string): string {
  return filePath.replace(/([/\\])app\.asar([/\\])/, '$1app.asar.unpacked$2');
}

export function bundledV2TMacKeyServerPath(mainDir: string): string {
  return unpackedAsarPath(join(mainDir, '..', 'native', 'MacKeyServer'));
}

export function bundledMacKeyServerPath(): string {
  return unpackedAsarPath(require.resolve('node-global-key-listener/bin/MacKeyServer'));
}

export function bundledWinKeyServerPath(filePath = require.resolve('node-global-key-listener/bin/WinKeyServer.exe')): string {
  return unpackedAsarPath(filePath);
}

export async function resolveBundledMacKeyServerPath(mainDir: string, fallbackPath = bundledMacKeyServerPath()): Promise<string> {
  const v2tHelperPath = bundledV2TMacKeyServerPath(mainDir);
  try {
    await access(v2tHelperPath, constants.F_OK);
    return v2tHelperPath;
  } catch {
    return fallbackPath;
  }
}

export async function ensureStableMacKeyServer(sourcePath: string, userDataPath: string): Promise<string> {
  const targetPath = stableMacKeyServerPath(userDataPath);
  await mkdir(dirname(targetPath), { recursive: true });
  if (await shouldCopy(sourcePath, targetPath)) {
    await copyFile(sourcePath, targetPath);
  }
  await chmod(targetPath, 0o755);
  return targetPath;
}

export async function resolveBundledWinKeyServerPath(fallbackPath = bundledWinKeyServerPath()): Promise<string> {
  await access(fallbackPath, constants.F_OK);
  return fallbackPath;
}

export async function ensureStableWinKeyServer(sourcePath: string, userDataPath: string): Promise<string> {
  const targetPath = stableWinKeyServerPath(userDataPath);
  await mkdir(dirname(targetPath), { recursive: true });
  if (await shouldCopy(sourcePath, targetPath)) {
    await copyFile(sourcePath, targetPath);
  }
  return targetPath;
}

async function shouldCopy(sourcePath: string, targetPath: string): Promise<boolean> {
  try {
    await access(targetPath, constants.F_OK);
  } catch {
    return true;
  }

  const [source, target] = await Promise.all([stat(sourcePath), stat(targetPath)]);
  return source.size !== target.size || source.mtimeMs > target.mtimeMs;
}
