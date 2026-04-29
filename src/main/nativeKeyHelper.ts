import { constants } from 'node:fs';
import { access, chmod, copyFile, mkdir, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, join, win32 } from 'node:path';

export const V2T_MAC_KEYSERVER_PROTOCOL_VERSION = '1';

export interface MacKeyServerVersion {
  protocolVersion: string;
  buildVersion?: string;
}

export interface MacKeyServerSetupResult {
  path: string;
  sourcePath: string;
  copied: boolean;
  reusedExisting: boolean;
  needsHelperUpgrade: boolean;
  targetVersion?: MacKeyServerVersion;
  sourceVersion?: MacKeyServerVersion;
  upgradeReason?: string;
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

export function stableV2TKeyboardListenerPath(userDataPath: string): string {
  const joinPath = userDataPath.includes('\\') ? win32.join : join;
  return joinPath(userDataPath, 'keyboard-listener', 'V2TKeyboardListener.exe');
}

export function unpackedAsarPath(filePath: string): string {
  return filePath.replace(/([/\\])app\.asar([/\\])/, '$1app.asar.unpacked$2');
}

export function bundledV2TMacKeyServerPath(mainDir: string): string {
  return unpackedAsarPath(join(mainDir, '..', 'native', 'MacKeyServer'));
}

export function resolveBundledV2TKeyboardListenerPath(mainDir: string): string {
  const joinPath = mainDir.includes('\\') ? win32.join : join;
  return unpackedAsarPath(joinPath(mainDir, '..', 'native', 'V2TKeyboardListener.exe'));
}

export function resolveBundledV2TAudioControlPath(mainDir: string): string {
  const joinPath = mainDir.includes('\\') ? win32.join : join;
  return unpackedAsarPath(joinPath(mainDir, '..', 'native', 'V2TAudioControl.exe'));
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

export async function ensureStableMacKeyServer(
  sourcePath: string,
  userDataPath: string,
  options: {
    readVersion?: (filePath: string) => MacKeyServerVersion | undefined;
  } = {}
): Promise<MacKeyServerSetupResult> {
  const targetPath = stableMacKeyServerPath(userDataPath);
  const readVersion = options.readVersion ?? readMacKeyServerVersion;
  await mkdir(dirname(targetPath), { recursive: true });
  const sourceVersion = readVersion(sourcePath);

  if (!(await fileExists(targetPath))) {
    await copyFile(sourcePath, targetPath);
    await chmod(targetPath, 0o755);
    return {
      path: targetPath,
      sourcePath,
      copied: true,
      reusedExisting: false,
      needsHelperUpgrade: false,
      targetVersion: readVersion(targetPath),
      sourceVersion
    };
  }

  const targetVersion = readVersion(targetPath);
  if (targetVersion?.protocolVersion === V2T_MAC_KEYSERVER_PROTOCOL_VERSION) {
    await chmod(targetPath, 0o755);
    return {
      path: targetPath,
      sourcePath,
      copied: false,
      reusedExisting: true,
      needsHelperUpgrade: false,
      targetVersion,
      sourceVersion
    };
  }

  return {
    path: targetPath,
    sourcePath,
    copied: false,
    reusedExisting: false,
    needsHelperUpgrade: true,
    targetVersion,
    sourceVersion,
    upgradeReason: targetVersion
      ? `监听组件协议版本 ${targetVersion.protocolVersion} 与当前 V2T 需要的 ${V2T_MAC_KEYSERVER_PROTOCOL_VERSION} 不兼容。`
      : '稳定路径中的监听组件无法读取协议版本，可能来自旧版本或文件已损坏。'
  };
}

export async function reinstallStableMacKeyServer(sourcePath: string, userDataPath: string): Promise<MacKeyServerSetupResult> {
  const targetPath = stableMacKeyServerPath(userDataPath);
  await mkdir(dirname(targetPath), { recursive: true });
  await copyFile(sourcePath, targetPath);
  await chmod(targetPath, 0o755);
  return {
    path: targetPath,
    sourcePath,
    copied: true,
    reusedExisting: false,
    needsHelperUpgrade: false,
    targetVersion: readMacKeyServerVersion(targetPath),
    sourceVersion: readMacKeyServerVersion(sourcePath)
  };
}

export function readMacKeyServerVersion(filePath: string): MacKeyServerVersion | undefined {
  const result = spawnSync(filePath, ['--version'], { encoding: 'utf8' });
  if (result.status !== 0) {
    return undefined;
  }
  const text = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  if (!text) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(text) as Partial<MacKeyServerVersion>;
    return typeof parsed.protocolVersion === 'string' ? { protocolVersion: parsed.protocolVersion, buildVersion: parsed.buildVersion } : undefined;
  } catch {
    const match = text.match(/protocol(?:Version)?[=: ]+([0-9A-Za-z_.-]+)/i);
    return match ? { protocolVersion: match[1] } : undefined;
  }
}

export async function cleanupStableWinKeyServer(userDataPath: string): Promise<{ attempted: true; deleted: boolean; error?: string }> {
  const targetPath = stableWinKeyServerPath(userDataPath);
  try {
    await rm(targetPath, { force: true });
    return { attempted: true, deleted: true };
  } catch (error) {
    return { attempted: true, deleted: false, error: readableError(error) };
  }
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

async function fileExists(filePath: string): Promise<boolean> {
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
