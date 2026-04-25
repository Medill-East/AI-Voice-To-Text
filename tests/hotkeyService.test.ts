import { beforeEach, describe, expect, it, vi } from 'vitest';

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
});
