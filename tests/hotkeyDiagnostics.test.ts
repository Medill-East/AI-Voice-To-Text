import { describe, expect, it } from 'vitest';
import { createCheckingHotkeyStatus } from '../src/main/hotkeyDiagnostics';

describe('hotkey diagnostics', () => {
  it('creates an immediate checking status for refresh actions', () => {
    expect(
      createCheckingHotkeyStatus({
        accelerator: 'RightAlt',
        fallbackAccelerator: 'CommandOrControl+Alt+Space',
        accessibilityTrusted: true,
        nativeHelperPath: '/Users/me/Library/Application Support/V2T/keyboard-listener/MacKeyServer'
      })
    ).toMatchObject({
      backend: 'native-listener',
      checking: true,
      registered: false,
      requestedAccelerator: 'RightAlt',
      activeAccelerator: 'RightAlt',
      fallbackAccelerator: 'CommandOrControl+Alt+Space',
      nativeHelperPath: '/Users/me/Library/Application Support/V2T/keyboard-listener/MacKeyServer',
      helperAttempted: false,
      appAccessibilityTrusted: true,
      diagnosticMessage: '正在重新检测系统键盘监听。',
      recommendedAction: 'none'
    });
  });

  it('describes Windows native checks without macOS permission wording', () => {
    const status = createCheckingHotkeyStatus({
      accelerator: 'RightControl',
      fallbackAccelerator: 'CommandOrControl+Alt+Space',
      platform: 'win32',
      nativeHelperPath: 'C:\\Program Files\\V2T\\resources\\app.asar.unpacked\\dist\\native\\V2TKeyboardListener.exe'
    });

    expect(status).toMatchObject({
      permissionKind: 'windows-native-hook',
      nativeHelperKind: 'v2t-windows-raw-input',
      nativeHelperPath: 'C:\\Program Files\\V2T\\resources\\app.asar.unpacked\\dist\\native\\V2TKeyboardListener.exe'
    });
    expect(status.diagnosticMessage).not.toContain('macOS');
    expect(status.diagnosticMessage).not.toContain('MacKeyServer');
  });
});
