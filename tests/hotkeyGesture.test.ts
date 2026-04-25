import { describe, expect, it } from 'vitest';
import { HotkeyGestureDetector } from '../src/core/hotkeyGesture';

describe('HotkeyGestureDetector', () => {
  it('starts natural recording after a single click window and stops on the next click', () => {
    const detector = new HotkeyGestureDetector({ longPressMs: 350 });

    expect(detector.keyDown(0)).toEqual([]);
    expect(detector.keyUp(80)).toEqual([]);
    expect(detector.thresholdElapsed(429)).toEqual([]);
    expect(detector.thresholdElapsed(430)).toEqual([{ type: 'start-recording', mode: 'toggle', inputMode: 'natural' }]);

    expect(detector.keyDown(500)).toEqual([{ type: 'stop-recording', mode: 'toggle' }]);
    expect(detector.keyUp(580)).toEqual([]);
  });

  it('starts structured recording on double click without starting natural input first', () => {
    const detector = new HotkeyGestureDetector({ longPressMs: 350 });

    expect(detector.keyDown(1000)).toEqual([]);
    expect(detector.keyUp(1060)).toEqual([]);
    expect(detector.keyDown(1200)).toEqual([{ type: 'start-recording', mode: 'toggle', inputMode: 'structured' }]);
    expect(detector.keyUp(1260)).toEqual([]);
  });
});
