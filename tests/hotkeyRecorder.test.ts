import { describe, expect, it } from 'vitest';
import { normalizeAccelerator, shortcutFromRecordedKeys } from '../src/core/hotkeyRecorder';

describe('hotkey recorder', () => {
  it('normalizes recorded macOS keys to an Electron accelerator', () => {
    expect(shortcutFromRecordedKeys(['Meta', 'Shift', 'Space'], 'darwin')).toBe('CommandOrControl+Shift+Space');
  });

  it('normalizes user input and rejects single unmodified keys', () => {
    expect(normalizeAccelerator('cmd + shift + space', 'darwin')).toBe('CommandOrControl+Shift+Space');
    expect(() => normalizeAccelerator('Space', 'darwin')).toThrow('至少包含一个修饰键');
  });
});
