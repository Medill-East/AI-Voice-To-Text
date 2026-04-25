import { describe, expect, it } from 'vitest';
import { closeShouldHideToTray, quitTrayMenuLabel } from '../src/main/windowLifecycle';

describe('window lifecycle helpers', () => {
  it('hides close events only when the app is not quitting', () => {
    expect(closeShouldHideToTray(false)).toBe(true);
    expect(closeShouldHideToTray(true)).toBe(false);
  });

  it('uses explicit wording for the real quit menu item', () => {
    expect(quitTrayMenuLabel()).toBe('完全退出 V2T');
  });
});
