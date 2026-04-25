import { describe, expect, it } from 'vitest';
import { HotkeyGestureDetector } from '../src/core/hotkeyGesture';

describe('HotkeyGestureDetector', () => {
  it('starts the single-click mode immediately and stops on a later click', () => {
    const detector = new HotkeyGestureDetector({
      longPressMs: 350,
      singleClickMode: 'natural',
      doubleClickMode: 'structured'
    });

    expect(detector.keyDown(0)).toEqual([{ type: 'start-recording', mode: 'toggle', inputMode: 'natural' }]);
    expect(detector.keyUp(80)).toEqual([]);
    expect(detector.thresholdElapsed(430)).toEqual([]);

    expect(detector.keyDown(500)).toEqual([{ type: 'stop-recording', mode: 'toggle' }]);
    expect(detector.keyUp(580)).toEqual([]);
  });

  it('switches to the double-click mode when the second click arrives within the window', () => {
    const detector = new HotkeyGestureDetector({
      longPressMs: 350,
      singleClickMode: 'natural',
      doubleClickMode: 'structured'
    });

    expect(detector.keyDown(1000)).toEqual([{ type: 'start-recording', mode: 'toggle', inputMode: 'natural' }]);
    expect(detector.keyUp(1060)).toEqual([]);
    expect(detector.keyDown(1200)).toEqual([{ type: 'set-recording-mode', inputMode: 'structured' }]);
    expect(detector.keyUp(1260)).toEqual([]);
  });

  it('allows the user to make single click structured and double click natural', () => {
    const detector = new HotkeyGestureDetector({
      longPressMs: 350,
      singleClickMode: 'structured',
      doubleClickMode: 'natural'
    });

    expect(detector.shortcutActivated(0)).toEqual([{ type: 'start-recording', mode: 'toggle', inputMode: 'structured' }]);
    expect(detector.shortcutActivated(200)).toEqual([{ type: 'set-recording-mode', inputMode: 'natural' }]);
  });
});
