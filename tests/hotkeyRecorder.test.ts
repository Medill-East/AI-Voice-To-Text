import { describe, expect, it } from 'vitest';
import { normalizeAccelerator, shortcutFromRecordedKeys } from '../src/core/hotkeyRecorder';

describe('hotkey recorder', () => {
  it('normalizes recorded macOS keys to an Electron accelerator', () => {
    expect(shortcutFromRecordedKeys(['Meta', 'Shift', 'Space'], 'darwin')).toBe('CommandOrControl+Shift+Space');
  });

  it('normalizes user input and allows safe single trigger keys', () => {
    expect(normalizeAccelerator('cmd + shift + space', 'darwin')).toBe('CommandOrControl+Shift+Space');
    expect(normalizeAccelerator('F9', 'darwin')).toBe('F9');
    expect(normalizeAccelerator('Space', 'darwin')).toBe('Space');
    expect(normalizeAccelerator('CapsLock', 'darwin')).toBe('CapsLock');
    expect(() => normalizeAccelerator('A', 'darwin')).toThrow('容易影响打字');
    expect(() => normalizeAccelerator('1', 'darwin')).toThrow('容易影响打字');
  });
});
