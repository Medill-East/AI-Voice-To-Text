export type RecordingTriggerMode = 'toggle' | 'hold';

export type HotkeyAction =
  | { type: 'start-recording'; mode: RecordingTriggerMode; inputMode: 'natural' | 'structured' }
  | { type: 'stop-recording'; mode: RecordingTriggerMode };

type GestureState = 'idle' | 'pressed' | 'waiting-second-click' | 'recording';

export class HotkeyGestureDetector {
  private state: GestureState = 'idle';
  private firstClickUpAt: number | null = null;
  private suppressNextKeyUp = false;
  private readonly longPressMs: number;

  constructor(options: { longPressMs: number }) {
    this.longPressMs = options.longPressMs;
  }

  keyDown(timestampMs: number): HotkeyAction[] {
    if (this.state === 'recording') {
      this.state = 'idle';
      this.firstClickUpAt = null;
      this.suppressNextKeyUp = true;
      return [{ type: 'stop-recording', mode: 'toggle' }];
    }

    if (this.state === 'waiting-second-click' && this.firstClickUpAt !== null && timestampMs - this.firstClickUpAt <= this.longPressMs) {
      this.state = 'recording';
      this.firstClickUpAt = null;
      this.suppressNextKeyUp = true;
      return [{ type: 'start-recording', mode: 'toggle', inputMode: 'structured' }];
    }

    this.state = 'pressed';
    return [];
  }

  thresholdElapsed(timestampMs: number): HotkeyAction[] {
    if (this.state !== 'waiting-second-click' || this.firstClickUpAt === null) {
      return [];
    }

    if (timestampMs - this.firstClickUpAt < this.longPressMs) {
      return [];
    }

    this.state = 'recording';
    this.firstClickUpAt = null;
    return [{ type: 'start-recording', mode: 'toggle', inputMode: 'natural' }];
  }

  keyUp(timestampMs: number): HotkeyAction[] {
    if (this.suppressNextKeyUp) {
      this.suppressNextKeyUp = false;
      return [];
    }

    if (this.state === 'pressed') {
      this.state = 'waiting-second-click';
      this.firstClickUpAt = timestampMs;
    }

    return [];
  }

  shortcutActivated(timestampMs: number): HotkeyAction[] {
    if (this.state === 'recording') {
      this.state = 'idle';
      this.firstClickUpAt = null;
      return [{ type: 'stop-recording', mode: 'toggle' }];
    }

    if (this.state === 'waiting-second-click' && this.firstClickUpAt !== null && timestampMs - this.firstClickUpAt <= this.longPressMs) {
      this.state = 'recording';
      this.firstClickUpAt = null;
      return [{ type: 'start-recording', mode: 'toggle', inputMode: 'structured' }];
    }

    this.state = 'waiting-second-click';
    this.firstClickUpAt = timestampMs;
    return [];
  }

  reset(): void {
    this.state = 'idle';
    this.firstClickUpAt = null;
    this.suppressNextKeyUp = false;
  }
}
