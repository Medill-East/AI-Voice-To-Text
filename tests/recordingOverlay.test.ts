import { describe, expect, it } from 'vitest';
import { normalizeRecordingOverlayState, recordingOverlayBounds, trayTitleForRecordingState } from '../src/main/recordingOverlay';

describe('recording overlay helpers', () => {
  it('shows recording and processing states but hides idle and error states', () => {
    expect(normalizeRecordingOverlayState({ state: 'recording', mode: 'structured', startedAt: 1000, now: 3500 })).toMatchObject({
      visible: true,
      state: 'recording',
      mode: 'structured',
      elapsedMs: 2500,
      level: 0,
      inputActive: false,
      silenceMs: 0
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

  it('normalizes audio level and silence metadata for the overlay', () => {
    expect(
      normalizeRecordingOverlayState({
        state: 'recording',
        mode: 'natural',
        level: 1.8,
        inputActive: true,
        silenceMs: 2200
      })
    ).toMatchObject({
      level: 1,
      inputActive: true,
      silenceMs: 2200
    });

    expect(
      normalizeRecordingOverlayState({
        state: 'recording',
        mode: 'natural',
        level: -0.2,
        silenceMs: -300
      })
    ).toMatchObject({
      level: 0,
      inputActive: false,
      silenceMs: 0
    });
  });

  it('places the overlay at the bottom center of the visible display area', () => {
    expect(recordingOverlayBounds({ x: 0, y: 0, width: 1440, height: 900 })).toEqual({
      x: 580,
      y: 806,
      width: 280,
      height: 60
    });
  });

  it('shows a macOS tray title while recording', () => {
    expect(
      trayTitleForRecordingState({ visible: true, state: 'recording', mode: 'natural', elapsedMs: 1200, level: 0, inputActive: false, silenceMs: 0 })
    ).toBe('V2T ●');
    expect(trayTitleForRecordingState({ visible: false, state: 'idle', mode: 'natural', elapsedMs: 0, level: 0, inputActive: false, silenceMs: 0 })).toBe(
      'V2T'
    );
  });
});
