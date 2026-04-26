import { constants } from 'node:fs';
import { access, chmod, copyFile, mkdir, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';

export interface WindowsKeyServerAvailability {
  helperPath: string;
  helperSourcePath: string;
  stablePath: string;
  helperFileExists: boolean;
  repairAttempted: boolean;
  repairError?: string;
}

export interface WindowsKeyServerProcess {
  processId: number;
  executablePath?: string;
  commandLine?: string;
}

export interface WindowsKeyServerCleanupResult {
  staleHelperCount: number;
  staleHelperKilled: number;
  errors: string[];
}

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

export async function ensureWindowsKeyServerAvailable(sourcePath: string, userDataPath: string): Promise<WindowsKeyServerAvailability> {
  const stablePath = stableWinKeyServerPath(userDataPath);
  if (await pathExists(sourcePath)) {
    const result: WindowsKeyServerAvailability = {
      helperPath: sourcePath,
      helperSourcePath: sourcePath,
      stablePath,
      helperFileExists: true,
      repairAttempted: true
    };
    try {
      await ensureStableWinKeyServer(sourcePath, userDataPath);
    } catch (error) {
      result.repairError = readableError(error);
    }
    return result;
  }

  if (await pathExists(stablePath)) {
    return {
      helperPath: stablePath,
      helperSourcePath: sourcePath,
      stablePath,
      helperFileExists: true,
      repairAttempted: false
    };
  }

  throw new Error(`WinKeyServer.exe 未找到：${sourcePath}`);
}

export function selectStaleWinKeyServerProcesses(processes: WindowsKeyServerProcess[], roots: string[]): WindowsKeyServerProcess[] {
  const normalizedRoots = roots.map(normalizeWindowsPath).filter(Boolean);
  return processes.filter((processInfo) => {
    const haystack = [processInfo.executablePath, processInfo.commandLine].filter(Boolean).map((value) => normalizeWindowsPath(value ?? ''));
    return haystack.some((value) => normalizedRoots.some((root) => value === root || value.startsWith(`${root}\\`)));
  });
}

export function cleanupStaleWinKeyServerProcesses(options: {
  roots: string[];
  listProcesses?: () => WindowsKeyServerProcess[];
  killProcess?: (processId: number) => boolean;
}): WindowsKeyServerCleanupResult {
  const listProcesses = options.listProcesses ?? listWinKeyServerProcesses;
  const killProcess = options.killProcess ?? killWindowsProcess;
  const errors: string[] = [];
  let staleProcesses: WindowsKeyServerProcess[] = [];
  try {
    staleProcesses = selectStaleWinKeyServerProcesses(listProcesses(), options.roots);
  } catch (error) {
    errors.push(readableError(error));
  }
  let killed = 0;

  for (const processInfo of staleProcesses) {
    try {
      if (killProcess(processInfo.processId)) {
        killed += 1;
      } else {
        errors.push(`无法结束 WinKeyServer.exe 进程 ${processInfo.processId}`);
      }
    } catch (error) {
      errors.push(readableError(error));
    }
  }

  return {
    staleHelperCount: staleProcesses.length,
    staleHelperKilled: killed,
    errors
  };
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

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function listWinKeyServerProcesses(): WindowsKeyServerProcess[] {
  const script = [
    "Get-CimInstance Win32_Process -Filter \"Name = 'WinKeyServer.exe'\"",
    'Select-Object ProcessId,ExecutablePath,CommandLine',
    'ConvertTo-Json -Compress'
  ].join(' | ');
  const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
    encoding: 'utf8',
    windowsHide: true
  });
  const output = result.stdout.trim();
  if (!output) {
    return [];
  }
  const parsed = JSON.parse(output) as unknown;
  const items = Array.isArray(parsed) ? parsed : [parsed];
  return items
    .map((item) => normalizeProcessInfo(item))
    .filter((item): item is WindowsKeyServerProcess => Boolean(item));
}

function normalizeProcessInfo(item: unknown): WindowsKeyServerProcess | null {
  if (!item || typeof item !== 'object') {
    return null;
  }
  const record = item as Record<string, unknown>;
  const rawProcessId = record.ProcessId ?? record.processId;
  const processId = typeof rawProcessId === 'number' ? rawProcessId : Number(rawProcessId);
  if (!Number.isFinite(processId)) {
    return null;
  }
  return {
    processId,
    executablePath: typeof record.ExecutablePath === 'string' ? record.ExecutablePath : undefined,
    commandLine: typeof record.CommandLine === 'string' ? record.CommandLine : undefined
  };
}

function killWindowsProcess(processId: number): boolean {
  const result = spawnSync('taskkill.exe', ['/PID', String(processId), '/F'], {
    encoding: 'utf8',
    windowsHide: true
  });
  return result.status === 0;
}

function normalizeWindowsPath(value: string): string {
  return value.replace(/^"+|"+$/g, '').replace(/\//g, '\\').toLowerCase();
}

function readableError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
