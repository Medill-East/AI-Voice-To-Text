import { describe, expect, it } from 'vitest';
import { normalizeRecordingOverlayState, recordingOverlayBounds, trayTitleForRecordingState } from '../src/main/recordingOverlay';

describe('recording overlay helpers', () => {
  it('shows recording and processing states but hides idle and error states', () => {
    expect(normalizeRecordingOverlayState({ state: 'recording', mode: 'structured', startedAt: 1000, now: 3500 })).toMatchObject({
      visible: true,
      state: 'recording',
      mode: 'structured',
      elapsedMs: 2500
    });
    expect(normalizeRecordingOverlayState({ state: 'processing', mode: 'natural', now: 3500 })).toMatchObject({
      visible: true,
      state: 'processing',
      mode: 'natural',
      elapsedMs: 0
    });
    expect(normalizeRecordingOverlayState({ state: 'idle', mode: 'natural', now: 3500 }).visible).toBe(false);
    expect(normalizeRecordingOverlayState({ state: 'error', mode: 'natural', now: 3500 }).visible).toBe(false);
  });

  it('places the overlay at the bottom center of the visible display area', () => {
    expect(recordingOverlayBounds({ x: 0, y: 0, width: 1440, height: 900 })).toEqual({
      x: 570,
      y: 794,
      width: 300,
      height: 72
    });
  });

  it('shows a macOS tray title while recording', () => {
    expect(trayTitleForRecordingState({ visible: true, state: 'recording', mode: 'natural', elapsedMs: 1200 })).toBe('V2T ●');
    expect(trayTitleForRecordingState({ visible: false, state: 'idle', mode: 'natural', elapsedMs: 0 })).toBe('V2T');
  });
});
