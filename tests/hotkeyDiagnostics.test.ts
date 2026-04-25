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
      diagnosticMessage: '正在重新检测系统键盘监听。',
      recommendedAction: 'none'
    });
  });
});
