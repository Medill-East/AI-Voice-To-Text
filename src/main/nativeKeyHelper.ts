import { constants } from 'node:fs';
import { access, chmod, copyFile, mkdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export function stableMacKeyServerPath(userDataPath: string): string {
  return join(userDataPath, 'keyboard-listener', 'MacKeyServer');
}

export function unpackedAsarPath(filePath: string): string {
  return filePath.replace('/app.asar/', '/app.asar.unpacked/');
}

export function bundledMacKeyServerPath(): string {
  return unpackedAsarPath(require.resolve('node-global-key-listener/bin/MacKeyServer'));
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

async function shouldCopy(sourcePath: string, targetPath: string): Promise<boolean> {
  try {
    await access(targetPath, constants.F_OK);
  } catch {
    return true;
  }

  const [source, target] = await Promise.all([stat(sourcePath), stat(targetPath)]);
  return source.size !== target.size || source.mtimeMs > target.mtimeMs;
}
