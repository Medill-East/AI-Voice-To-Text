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
      activeAccelerator: 'CommandOrControl+Alt+Space',
      requestedAccelerator: 'RightAlt',
      fallbackRegistered: true,
      nativeActive: false,
      helperAttempted: true,
      appAccessibilityTrusted: false,
      nativeHelperPath: '/Users/me/Library/Application Support/V2T/keyboard-listener/MacKeyServer',
      diagnosticMessage: expect.stringContaining('/Users/me/Library/Application Support/V2T/keyboard-listener/MacKeyServer')
    });

    register.mock.calls[0][1]();
    expect(onAction).toHaveBeenCalledWith({ type: 'start-recording', mode: 'toggle' });
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
      activeAccelerator: 'CommandOrControl+Alt+Space',
      fallbackRegistered: true,
      helperAttempted: true,
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

  it('reports a helper permission diagnostic when native listener starts but never receives events', async () => {
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
        backend: 'electron-shortcut',
        registered: true,
        activeAccelerator: 'CommandOrControl+Alt+Space',
        nativeActive: false,
        helperAttempted: true,
        nativeHelperPath: '/Users/me/Library/Application Support/V2T/keyboard-listener/MacKeyServer',
        recommendedAction: 'grant-native-helper-accessibility',
        diagnosticMessage: expect.stringContaining('/Users/me/Library/Application Support/V2T/keyboard-listener/MacKeyServer')
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
