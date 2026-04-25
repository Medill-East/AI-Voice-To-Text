import { describe, expect, it } from 'vitest';
import { closeShouldHideToTray, quitMenuItemConfig, quitTrayMenuLabel } from '../src/main/windowLifecycle';

describe('window lifecycle helpers', () => {
  it('hides close events only when the app is not quitting', () => {
    expect(closeShouldHideToTray(false)).toBe(true);
    expect(closeShouldHideToTray(true)).toBe(false);
  });

  it('uses explicit wording for the real quit menu item', () => {
    expect(quitTrayMenuLabel()).toBe('完全退出 V2T');
  });

  it('defines a Command+Q quit menu item for macOS app menus', () => {
    expect(quitMenuItemConfig()).toEqual({
      label: '完全退出 V2T',
      accelerator: 'Command+Q'
    });
  });
});
