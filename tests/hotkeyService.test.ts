import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NativeKeyListenerFactory } from '../src/main/hotkeyService';

const register = vi.fn();
const unregisterAll = vi.fn();

vi.mock('electron', () => ({
  globalShortcut: {
    register,
    unregisterAll
  }
}));

describe('HotkeyService', () => {
  beforeEach(() => {
    register.mockReset();
    register.mockReturnValue(true);
    unregisterAll.mockReset();
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('attempts native listener even when app accessibility trust is false', async () => {
    vi.useFakeTimers();
    const { HotkeyService } = await import('../src/main/hotkeyService');
    const onAction = vi.fn();
    const nativeFactory: NativeKeyListenerFactory = {
      addListener: vi.fn(async () => ({
        remove: vi.fn(),
        kill: vi.fn()
      }))
    };
    const service = new HotkeyService({ nativeFactory });

    const status = await service.register({
      accelerator: 'RightAlt',
      fallbackAccelerator: 'CommandOrControl+Alt+Space',
      longPressMs: 250,
      accessibilityTrusted: false,
      nativeHelperPath: '/Users/me/Library/Application Support/V2T/keyboard-listener/MacKeyServer',
      onAction
    });

    expect(nativeFactory.addListener).toHaveBeenCalledWith(
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
      '/Users/me/Library/Application Support/V2T/keyboard-listener/MacKeyServer'
    );
    expect(register).toHaveBeenCalledWith('CommandOrControl+Alt+Space', expect.any(Function));
    expect(status).toMatchObject({
      backend: 'native-listener',
      registered: true,
      activeAccelerator: 'RightAlt',
      requestedAccelerator: 'RightAlt',
      fallbackRegistered: true,
      helperStarted: true,
      helperVerified: false,
      nativeActive: false,
      helperAttempted: true,
      appAccessibilityTrusted: false,
      nativeHelperPath: '/Users/me/Library/Application Support/V2T/keyboard-listener/MacKeyServer',
      diagnosticMessage: expect.stringContaining('按一次快捷键完成验证')
    });

    register.mock.calls[0][1]();
    vi.advanceTimersByTime(250);
    expect(onAction).toHaveBeenCalledWith({ type: 'start-recording', mode: 'toggle', inputMode: 'natural' });
  });

  it('keeps a fallback shortcut active when native listener later reports an error', async () => {
    const { HotkeyService } = await import('../src/main/hotkeyService');
    const onStatus = vi.fn();
    let reportNativeError: ((error: unknown) => void) | undefined;
    const nativeFactory: NativeKeyListenerFactory = {
      addListener: vi.fn(async (_callback, onError) => {
        reportNativeError = onError;
        return {
          remove: vi.fn(),
          kill: vi.fn()
        };
      })
    };
    const service = new HotkeyService({ nativeFactory });

    const status = await service.register({
      accelerator: 'RightAlt',
      fallbackAccelerator: 'CommandOrControl+Alt+Space',
      longPressMs: 250,
      accessibilityTrusted: true,
      onAction: vi.fn(),
      onStatus
    });

    expect(register).toHaveBeenCalledWith('CommandOrControl+Alt+Space', expect.any(Function));
    expect(status).toMatchObject({
      backend: 'native-listener',
      registered: true,
      activeAccelerator: 'RightAlt',
      fallbackRegistered: true,
      helperAttempted: true,
      helperStarted: true,
      helperVerified: false,
      nativeActive: false
    });

    reportNativeError?.(new Error('MacKeyServer exited'));

    expect(onStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({
        backend: 'electron-shortcut',
        registered: true,
        activeAccelerator: 'CommandOrControl+Alt+Space',
        fallbackRegistered: true,
        nativeActive: false,
        helperAttempted: true,
        lastError: 'MacKeyServer exited'
      })
    );
  });

  it('uses Electron globalShortcut for Windows combination hotkeys', async () => {
    const { HotkeyService } = await import('../src/main/hotkeyService');
    const nativeFactory: NativeKeyListenerFactory = {
      addListener: vi.fn(async () => ({
        remove: vi.fn(),
        kill: vi.fn()
      }))
    };
    const service = new HotkeyService({ nativeFactory });

    const status = await service.register({
      accelerator: 'CommandOrControl+Shift+Space',
      fallbackAccelerator: 'CommandOrControl+Alt+Space',
      longPressMs: 350,
      platform: 'win32',
      accessibilityTrusted: true,
      onAction: vi.fn()
    });

    expect(nativeFactory.addListener).not.toHaveBeenCalled();
    expect(register).toHaveBeenCalledWith('CommandOrControl+Shift+Space', expect.any(Function));
    expect(status).toMatchObject({
      backend: 'electron-shortcut',
      registered: true,
      platform: 'win32',
      permissionKind: 'none',
      activeAccelerator: 'CommandOrControl+Shift+Space',
      fallbackRegistered: false
    });
  });

  it('uses Windows native listener for pure modifier hotkeys without macOS permission wording', async () => {
    const { HotkeyService } = await import('../src/main/hotkeyService');
    const onStatus = vi.fn();
    let reportNativeError: ((error: unknown) => void) | undefined;
    const nativeFactory: NativeKeyListenerFactory = {
      addListener: vi.fn(async (_callback, onError) => {
        reportNativeError = onError;
        return {
          remove: vi.fn(),
          kill: vi.fn()
        };
      })
    };
    const service = new HotkeyService({ nativeFactory });

    await service.register({
      accelerator: 'RightAlt',
      fallbackAccelerator: 'CommandOrControl+Alt+Space',
      longPressMs: 350,
      platform: 'win32',
      accessibilityTrusted: true,
      onAction: vi.fn(),
      onStatus
    });

    expect(nativeFactory.addListener).toHaveBeenCalledWith(expect.any(Function), expect.any(Function), expect.any(Function), undefined);
    reportNativeError?.(new Error('Windows hook failed'));

    expect(onStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({
        platform: 'win32',
        permissionKind: 'windows-native-hook',
        backend: 'electron-shortcut',
        activeAccelerator: 'CommandOrControl+Alt+Space',
        diagnosticMessage: expect.stringContaining('Windows 系统键盘监听')
      })
    );
    expect(onStatus.mock.calls.at(-1)?.[0].diagnosticMessage).not.toContain('macOS');
    expect(onStatus.mock.calls.at(-1)?.[0].diagnosticMessage).not.toContain('MacKeyServer');
  });

  it('keeps primary hotkey pending when helper starts but no events arrive yet', async () => {
    vi.useFakeTimers();
    const { HotkeyService } = await import('../src/main/hotkeyService');
    const onStatus = vi.fn();
    const nativeFactory: NativeKeyListenerFactory = {
      addListener: vi.fn(async () => ({
        remove: vi.fn(),
        kill: vi.fn()
      }))
    };
    const service = new HotkeyService({ nativeFactory, noNativeEventTimeoutMs: 3000 });

    await service.register({
      accelerator: 'RightAlt',
      fallbackAccelerator: 'CommandOrControl+Alt+Space',
      longPressMs: 250,
      accessibilityTrusted: true,
      nativeHelperPath: '/Users/me/Library/Application Support/V2T/keyboard-listener/MacKeyServer',
      onAction: vi.fn(),
      onStatus
    });

    await vi.advanceTimersByTimeAsync(3000);

    expect(onStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({
        backend: 'native-listener',
        registered: true,
        activeAccelerator: 'RightAlt',
        nativeActive: false,
        helperStarted: true,
        helperVerified: false,
        helperAttempted: true,
        nativeHelperPath: '/Users/me/Library/Application Support/V2T/keyboard-listener/MacKeyServer',
        fallbackRegistered: true,
        recommendedAction: 'none',
        diagnosticMessage: expect.stringContaining('按一次快捷键完成验证')
      })
    );
  });

  it('reports helper stderr when event tap creation fails', async () => {
    const { HotkeyService } = await import('../src/main/hotkeyService');
    const onStatus = vi.fn();
    let reportNativeError: ((error: unknown) => void) | undefined;
    let reportNativeInfo: ((info: string) => void) | undefined;
    const nativeFactory: NativeKeyListenerFactory = {
      addListener: vi.fn(async (_callback, onError, onInfo) => {
        reportNativeError = onError;
        reportNativeInfo = onInfo;
        return {
          remove: vi.fn(),
          kill: vi.fn()
        };
      })
    };
    const service = new HotkeyService({ nativeFactory });

    await service.register({
      accelerator: 'RightAlt',
      fallbackAccelerator: 'CommandOrControl+Alt+Space',
      longPressMs: 250,
      accessibilityTrusted: true,
      nativeHelperPath: '/Users/me/Library/Application Support/V2T/keyboard-listener/MacKeyServer',
      onAction: vi.fn(),
      onStatus
    });

    reportNativeInfo?.('Unable to create CGEvent tap. Grant Accessibility permission to V2T Keyboard Listener.');
    reportNativeError?.(2);

    expect(onStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({
        backend: 'electron-shortcut',
        activeAccelerator: 'CommandOrControl+Alt+Space',
        helperStarted: true,
        helperVerified: false,
        helperLastStderr: expect.stringContaining('Unable to create CGEvent tap'),
        helperEventTapCreated: false,
        nativeExitCode: 2,
        recommendedAction: 'grant-native-helper-accessibility',
        diagnosticMessage: expect.stringContaining('event tap 权限失败')
      })
    );
  });

  it('tests RightAlt by resolving when a RIGHT ALT native event is received', async () => {
    const { HotkeyService } = await import('../src/main/hotkeyService');
    let listener: Parameters<NativeKeyListenerFactory['addListener']>[0] | undefined;
    const nativeFactory: NativeKeyListenerFactory = {
      addListener: vi.fn(async (callback) => {
        listener = callback;
        return {
          remove: vi.fn(),
          kill: vi.fn()
        };
      })
    };
    const service = new HotkeyService({ nativeFactory });

    const resultPromise = service.testAccelerator({
      accelerator: 'RightAlt',
      timeoutMs: 5000,
      accessibilityTrusted: true,
      nativeHelperPath: '/Users/me/Library/Application Support/V2T/keyboard-listener/MacKeyServer'
    });

    await Promise.resolve();
    listener?.({ name: 'RIGHT ALT', state: 'DOWN', vKey: 0x3d, scanCode: 0x3d, _raw: 'KEYBOARD,DOWN,61,0,0,1' }, {});

    await expect(resultPromise).resolves.toMatchObject({
      ok: true,
      eventName: 'RIGHT ALT',
      nativeHelperPath: '/Users/me/Library/Application Support/V2T/keyboard-listener/MacKeyServer'
    });
  });
});
