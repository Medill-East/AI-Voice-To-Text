import type { InputMode } from '../core/types';

export type RecordingOverlayUiState = 'idle' | 'starting' | 'recording' | 'processing' | 'error';

export interface RecordingOverlayUpdate {
  state: RecordingOverlayUiState;
  mode: InputMode;
  startedAt?: number;
  now?: number;
  elapsedMs?: number;
  level?: number;
  inputActive?: boolean;
  silenceMs?: number;
}

export interface NormalizedRecordingOverlayState {
  visible: boolean;
  state: RecordingOverlayUiState;
  mode: InputMode;
  elapsedMs: number;
  level: number;
  inputActive: boolean;
  silenceMs: number;
}

export interface DisplayBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function normalizeRecordingOverlayState(update: RecordingOverlayUpdate): NormalizedRecordingOverlayState {
  const visible = update.state === 'starting' || update.state === 'recording' || update.state === 'processing';
  const level = clamp(update.level ?? 0, 0, 1);
  return {
    visible,
    state: update.state,
    mode: update.mode,
    elapsedMs:
      visible && update.elapsedMs !== undefined
        ? Math.max(0, update.elapsedMs)
        : visible && update.startedAt
          ? Math.max(0, (update.now ?? Date.now()) - update.startedAt)
          : 0,
    level,
    inputActive: update.inputActive ?? level > 0.03,
    silenceMs: Math.max(0, update.silenceMs ?? 0)
  };
}

export function recordingOverlayBounds(bounds: DisplayBounds, size = { width: 196, height: 50 }): DisplayBounds {
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
