import type { InputMode } from '../core/types';

export type RecordingOverlayUiState = 'idle' | 'recording' | 'processing' | 'error';

export interface RecordingOverlayUpdate {
  state: RecordingOverlayUiState;
  mode: InputMode;
  startedAt?: number;
  now?: number;
}

export interface NormalizedRecordingOverlayState {
  visible: boolean;
  state: RecordingOverlayUiState;
  mode: InputMode;
  elapsedMs: number;
}

export interface DisplayBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function normalizeRecordingOverlayState(update: RecordingOverlayUpdate): NormalizedRecordingOverlayState {
  const visible = update.state === 'recording' || update.state === 'processing';
  return {
    visible,
    state: update.state,
    mode: update.mode,
    elapsedMs: visible && update.startedAt ? Math.max(0, (update.now ?? Date.now()) - update.startedAt) : 0
  };
}

export function recordingOverlayBounds(bounds: DisplayBounds, size = { width: 300, height: 72 }): DisplayBounds {
  return {
    width: size.width,
    height: size.height,
    x: Math.round(bounds.x + (bounds.width - size.width) / 2),
    y: Math.round(bounds.y + bounds.height - size.height - 34)
  };
}

export function trayTitleForRecordingState(state: NormalizedRecordingOverlayState): string {
  return state.visible && state.state === 'recording' ? 'V2T ●' : 'V2T';
}
