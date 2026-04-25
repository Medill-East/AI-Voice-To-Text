export type RecordingTriggerMode = 'toggle' | 'hold';

export type HotkeyAction =
  | { type: 'start-recording'; mode: RecordingTriggerMode }
  | { type: 'stop-recording'; mode: RecordingTriggerMode };

type GestureState = 'idle' | 'pending' | 'toggle-recording' | 'hold-recording';

export class HotkeyGestureDetector {
  private state: GestureState = 'idle';
  private keyDownAt: number | null = null;
  private readonly longPressMs: number;

  constructor(options: { longPressMs: number }) {
    this.longPressMs = options.longPressMs;
  }

  keyDown(timestampMs: number): HotkeyAction[] {
    if (this.state === 'idle' || this.state === 'toggle-recording') {
      this.keyDownAt = timestampMs;
      this.state = this.state === 'toggle-recording' ? 'toggle-recording' : 'pending';
    }

    return [];
  }

  thresholdElapsed(timestampMs: number): HotkeyAction[] {
    if (this.state !== 'pending' || this.keyDownAt === null) {
      return [];
    }

    if (timestampMs - this.keyDownAt < this.longPressMs) {
      return [];
    }

    this.state = 'hold-recording';
    return [{ type: 'start-recording', mode: 'hold' }];
  }

  keyUp(timestampMs: number): HotkeyAction[] {
    if (this.state === 'pending') {
      this.keyDownAt = null;
      this.state = 'toggle-recording';
      return [{ type: 'start-recording', mode: 'toggle' }];
    }

    if (this.state === 'hold-recording') {
      this.keyDownAt = null;
      this.state = 'idle';
      return [{ type: 'stop-recording', mode: 'hold' }];
    }

    if (this.state === 'toggle-recording') {
      const wasShortPress = this.keyDownAt === null || timestampMs - this.keyDownAt < this.longPressMs;
      this.keyDownAt = null;
      if (wasShortPress) {
        this.state = 'idle';
        return [{ type: 'stop-recording', mode: 'toggle' }];
      }
    }

    this.keyDownAt = null;
    return [];
  }

  reset(): void {
    this.state = 'idle';
    this.keyDownAt = null;
  }
}
