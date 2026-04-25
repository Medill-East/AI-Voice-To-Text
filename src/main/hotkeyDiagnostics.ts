import type { HotkeyStatus } from './hotkeyService';

export function createCheckingHotkeyStatus(options: {
  accelerator: string;
  fallbackAccelerator?: string;
  accessibilityTrusted?: boolean;
  nativeHelperPath?: string;
  diagnosticMessage?: string;
}): HotkeyStatus {
  return {
    backend: 'native-listener',
    checking: true,
    registered: false,
    requestedAccelerator: options.accelerator,
    activeAccelerator: options.accelerator,
    fallbackAccelerator: options.fallbackAccelerator,
    fallbackRegistered: false,
    helperAttempted: false,
    helperStarted: false,
    helperVerified: false,
    nativeActive: false,
    nativeHelperPath: options.nativeHelperPath,
    appAccessibilityTrusted: options.accessibilityTrusted,
    accessibilityTrusted: options.accessibilityTrusted,
    diagnosticMessage: options.diagnosticMessage ?? '正在重新检测系统键盘监听。',
    recommendedAction: 'none',
    message: options.diagnosticMessage ?? '正在重新检测系统键盘监听。'
  };
}
