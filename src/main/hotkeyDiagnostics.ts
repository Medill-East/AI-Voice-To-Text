import type { HotkeyStatus } from './hotkeyService';

export function createCheckingHotkeyStatus(options: {
  accelerator: string;
  fallbackAccelerator?: string;
  platform?: NodeJS.Platform;
  accessibilityTrusted?: boolean;
  nativeHelperPath?: string;
  nativeHelperSourcePath?: string;
  nativeHelperSignature?: string;
  hotkeyLogPath?: string;
  helperFileExists?: boolean;
  repairAttempted?: boolean;
  repairError?: string;
  staleHelperCount?: number;
  staleHelperKilled?: number;
  diagnosticMessage?: string;
}): HotkeyStatus {
  return {
    backend: 'native-listener',
    checking: true,
    registered: false,
    platform: options.platform ?? process.platform,
    permissionKind: permissionKindFor(options.platform, options.accelerator),
    requestedAccelerator: options.accelerator,
    activeAccelerator: options.accelerator,
    fallbackAccelerator: options.fallbackAccelerator,
    fallbackRegistered: false,
    helperAttempted: false,
    helperStarted: false,
    helperVerified: false,
    nativeActive: false,
    nativeHelperPath: options.nativeHelperPath,
    nativeHelperKind: nativeHelperKindFor(options.platform, options.nativeHelperPath),
    helperSourcePath: options.nativeHelperSourcePath,
    helperFileExists: options.helperFileExists,
    repairAttempted: options.repairAttempted,
    repairError: options.repairError,
    staleHelperCount: options.staleHelperCount,
    staleHelperKilled: options.staleHelperKilled,
    nativeHelperSignature: options.nativeHelperSignature,
    hotkeyLogPath: options.hotkeyLogPath,
    appAccessibilityTrusted: options.accessibilityTrusted,
    accessibilityTrusted: options.accessibilityTrusted,
    diagnosticMessage: options.diagnosticMessage ?? '正在重新检测系统键盘监听。',
    recommendedAction: 'none',
    message: options.diagnosticMessage ?? '正在重新检测系统键盘监听。'
  };
}

function nativeHelperKindFor(platform: NodeJS.Platform | undefined, nativeHelperPath?: string): HotkeyStatus['nativeHelperKind'] {
  if (!nativeHelperPath) {
    return undefined;
  }
  const resolvedPlatform = platform ?? process.platform;
  if (resolvedPlatform === 'darwin') {
    return 'mac-key-server';
  }
  if (resolvedPlatform === 'win32') {
    return 'v2t-windows-raw-input';
  }
  return undefined;
}

function permissionKindFor(platform: NodeJS.Platform | undefined, accelerator: string): HotkeyStatus['permissionKind'] {
  const resolvedPlatform = platform ?? process.platform;
  if (resolvedPlatform === 'darwin') {
    return 'macos-accessibility';
  }
  if (resolvedPlatform === 'win32' && (!accelerator.includes('+') || accelerator.split('+').every((part) => MODIFIER_KEYS.has(part)))) {
    return 'windows-native-hook';
  }
  return 'none';
}

const MODIFIER_KEYS = new Set(['CommandOrControl', 'Command', 'Control', 'LeftControl', 'RightControl', 'Alt', 'LeftAlt', 'RightAlt', 'Shift', 'LeftShift', 'RightShift']);
