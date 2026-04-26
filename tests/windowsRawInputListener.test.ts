import { describe, expect, it, vi } from 'vitest';
import { parseWindowsRawInputLine, WindowsRawInputKeyboardListener } from '../src/main/windowsRawInputListener';

describe('Windows Raw Input listener', () => {
  it('parses side-specific modifier and regular key events', () => {
    expect(parseWindowsRawInputLine('{"type":"key","state":"DOWN","vKey":163,"scanCode":29}')).toMatchObject({
      name: 'RIGHT CTRL',
      state: 'DOWN',
      vKey: 163,
      scanCode: 29
    });
    expect(parseWindowsRawInputLine('{"type":"key","state":"UP","vKey":162,"scanCode":29}')).toMatchObject({
      name: 'LEFT CTRL',
      state: 'UP',
      vKey: 162
    });
    expect(parseWindowsRawInputLine('{"type":"key","state":"DOWN","vKey":165,"scanCode":56}')).toMatchObject({
      name: 'RIGHT ALT',
      state: 'DOWN',
      vKey: 165
    });
    expect(parseWindowsRawInputLine('{"type":"key","state":"DOWN","vKey":13,"scanCode":28}')).toMatchObject({
      name: 'RETURN',
      state: 'DOWN',
      vKey: 13
    });
  });

  it('ignores malformed or non-key sidecar lines', () => {
    expect(parseWindowsRawInputLine('raw-input-ready')).toBeNull();
    expect(parseWindowsRawInputLine('{"type":"info","message":"ready"}')).toBeNull();
    expect(parseWindowsRawInputLine('{"type":"key","state":"MAYBE","vKey":163,"scanCode":29}')).toBeNull();
  });

  it('tracks the down map without any propagation response channel', () => {
    const callback = vi.fn(() => true);
    const listener = new WindowsRawInputKeyboardListener(callback, { spawnProcess: vi.fn() as never });

    listener.handleLine('{"type":"key","state":"DOWN","vKey":163,"scanCode":29}');
    listener.handleLine('{"type":"key","state":"DOWN","vKey":13,"scanCode":28}');
    listener.handleLine('{"type":"key","state":"UP","vKey":13,"scanCode":28}');
    listener.handleLine('{"type":"key","state":"UP","vKey":163,"scanCode":29}');

    expect(callback).toHaveBeenNthCalledWith(1, expect.objectContaining({ name: 'RIGHT CTRL', state: 'DOWN' }), { 'RIGHT CTRL': true });
    expect(callback).toHaveBeenNthCalledWith(2, expect.objectContaining({ name: 'RETURN', state: 'DOWN' }), {
      'RIGHT CTRL': true,
      RETURN: true
    });
    expect(callback).toHaveBeenNthCalledWith(3, expect.objectContaining({ name: 'RETURN', state: 'UP' }), {
      'RIGHT CTRL': true,
      RETURN: false
    });
    expect(callback).toHaveBeenNthCalledWith(4, expect.objectContaining({ name: 'RIGHT CTRL', state: 'UP' }), {
      'RIGHT CTRL': false,
      RETURN: false
    });
  });
});
