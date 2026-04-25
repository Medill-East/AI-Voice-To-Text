import { describe, expect, it } from 'vitest';
import { normalizeAccelerator, shortcutFromRecordedKeys } from '../src/core/hotkeyRecorder';

describe('hotkey recorder', () => {
  it('normalizes recorded macOS keys to an Electron accelerator', () => {
    expect(shortcutFromRecordedKeys(['Meta', 'Shift', 'Space'], 'darwin')).toBe('Command+Shift+Space');
  });

  it('normalizes user input and allows safe single trigger keys', () => {
    expect(normalizeAccelerator('CommandOrControl + shift + space', 'darwin')).toBe('CommandOrControl+Shift+Space');
    expect(normalizeAccelerator('cmd + shift + space', 'darwin')).toBe('Command+Shift+Space');
    expect(normalizeAccelerator('Command', 'darwin')).toBe('Command');
    expect(normalizeAccelerator('Control', 'darwin')).toBe('Control');
    expect(normalizeAccelerator('Option', 'darwin')).toBe('Alt');
    expect(normalizeAccelerator('RightAlt', 'darwin')).toBe('RightAlt');
    expect(normalizeAccelerator('LeftAlt', 'darwin')).toBe('LeftAlt');
    expect(normalizeAccelerator('RightCommand', 'darwin')).toBe('RightCommand');
    expect(normalizeAccelerator('Command + Option', 'darwin')).toBe('Command+Alt');
    expect(normalizeAccelerator('RightCommand + LeftAlt', 'darwin')).toBe('RightCommand+LeftAlt');
    expect(normalizeAccelerator('F9', 'darwin')).toBe('F9');
    expect(normalizeAccelerator('Space', 'darwin')).toBe('Space');
    expect(normalizeAccelerator('CapsLock', 'darwin')).toBe('CapsLock');
    expect(() => normalizeAccelerator('A', 'darwin')).toThrow('容易影响打字');
    expect(() => normalizeAccelerator('1', 'darwin')).toThrow('容易影响打字');
  });

  it('preserves side-specific modifier keys recorded from keyboard events', () => {
    expect(shortcutFromRecordedKeys(['AltRight'], 'darwin')).toBe('RightAlt');
    expect(shortcutFromRecordedKeys(['AltLeft'], 'darwin')).toBe('LeftAlt');
    expect(shortcutFromRecordedKeys(['MetaRight'], 'darwin')).toBe('RightCommand');
    expect(shortcutFromRecordedKeys(['MetaLeft', 'AltRight'], 'darwin')).toBe('LeftCommand+RightAlt');
  });
});
