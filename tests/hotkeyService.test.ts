import { beforeEach, describe, expect, it, vi } from 'vitest';
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
  });

  it('uses the fallback shortcut when a pure modifier needs accessibility permission', async () => {
    const { HotkeyService } = await import('../src/main/hotkeyService');
    const onAction = vi.fn();
    const service = new HotkeyService();

    const status = await service.register({
      accelerator: 'RightAlt',
      fallbackAccelerator: 'CommandOrControl+Alt+Space',
      longPressMs: 250,
      accessibilityTrusted: false,
      onAction
    });

    expect(register).toHaveBeenCalledWith('CommandOrControl+Alt+Space', expect.any(Function));
    expect(status).toMatchObject({
      backend: 'electron-shortcut',
      registered: true,
      activeAccelerator: 'CommandOrControl+Alt+Space',
      requestedAccelerator: 'RightAlt',
      fallbackRegistered: true,
      needsAccessibilityPermission: true
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
      activeAccelerator: 'RightAlt',
      fallbackRegistered: true,
      nativeActive: true
    });

    reportNativeError?.(new Error('MacKeyServer exited'));

    expect(onStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({
        backend: 'electron-shortcut',
        registered: true,
        activeAccelerator: 'CommandOrControl+Alt+Space',
        fallbackRegistered: true,
        nativeActive: false,
        lastError: 'MacKeyServer exited'
      })
    );
  });
});
