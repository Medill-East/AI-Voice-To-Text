import { describe, expect, it } from 'vitest';
import { HotkeyGestureDetector } from '../src/core/hotkeyGesture';

describe('HotkeyGestureDetector', () => {
  it('starts and stops toggle recording on repeated short presses', () => {
    const detector = new HotkeyGestureDetector({ longPressMs: 250 });

    expect(detector.keyDown(0)).toEqual([]);
    expect(detector.keyUp(120)).toEqual([{ type: 'start-recording', mode: 'toggle' }]);

    expect(detector.keyDown(500)).toEqual([]);
    expect(detector.keyUp(620)).toEqual([{ type: 'stop-recording', mode: 'toggle' }]);
  });

  it('starts hold recording after the long-press threshold and stops on release', () => {
    const detector = new HotkeyGestureDetector({ longPressMs: 250 });

    detector.keyDown(1000);

    expect(detector.thresholdElapsed(1249)).toEqual([]);
    expect(detector.thresholdElapsed(1250)).toEqual([{ type: 'start-recording', mode: 'hold' }]);
    expect(detector.thresholdElapsed(1300)).toEqual([]);
    expect(detector.keyUp(1500)).toEqual([{ type: 'stop-recording', mode: 'hold' }]);
  });
});
