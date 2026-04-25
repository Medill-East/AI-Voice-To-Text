export type RecordingTriggerMode = 'toggle' | 'hold';

export type HotkeyAction =
  | { type: 'start-recording'; mode: RecordingTriggerMode; inputMode: 'natural' | 'structured' }
  | { type: 'set-recording-mode'; inputMode: 'natural' | 'structured' }
  | { type: 'stop-recording'; mode: RecordingTriggerMode };

type InputMode = 'natural' | 'structured';
type GestureState = 'idle' | 'recording';

export class HotkeyGestureDetector {
  private state: GestureState = 'idle';
  private firstClickAt: number | null = null;
  private doubleClickApplied = false;
  private suppressNextKeyUp = false;
  private readonly longPressMs: number;
  private readonly singleClickMode: InputMode;
  private readonly doubleClickMode: InputMode;

  constructor(options: { longPressMs: number; singleClickMode?: InputMode; doubleClickMode?: InputMode }) {
    this.longPressMs = options.longPressMs;
    this.singleClickMode = options.singleClickMode ?? 'natural';
    this.doubleClickMode = options.doubleClickMode ?? 'structured';
  }

  keyDown(timestampMs: number): HotkeyAction[] {
    if (this.state === 'idle') {
      this.state = 'recording';
      this.firstClickAt = timestampMs;
      this.doubleClickApplied = false;
      return [{ type: 'start-recording', mode: 'toggle', inputMode: this.singleClickMode }];
    }

    if (this.isDoubleClick(timestampMs)) {
      this.doubleClickApplied = true;
      this.suppressNextKeyUp = true;
      return [{ type: 'set-recording-mode', inputMode: this.doubleClickMode }];
    }

    if (this.state === 'recording') {
      this.state = 'idle';
      this.firstClickAt = null;
      this.doubleClickApplied = false;
      this.suppressNextKeyUp = true;
      return [{ type: 'stop-recording', mode: 'toggle' }];
    }
    return [];
  }

  thresholdElapsed(timestampMs: number): HotkeyAction[] {
    if (this.state === 'recording' && this.firstClickAt !== null && timestampMs - this.firstClickAt >= this.longPressMs) {
      this.firstClickAt = null;
    }
    return [];
  }

  keyUp(timestampMs: number): HotkeyAction[] {
    if (this.suppressNextKeyUp) {
      this.suppressNextKeyUp = false;
      return [];
    }

    return [];
  }

  shortcutActivated(timestampMs: number): HotkeyAction[] {
    if (this.state === 'idle') {
      this.state = 'recording';
      this.firstClickAt = timestampMs;
      this.doubleClickApplied = false;
      return [{ type: 'start-recording', mode: 'toggle', inputMode: this.singleClickMode }];
    }

    if (this.isDoubleClick(timestampMs)) {
      this.doubleClickApplied = true;
      return [{ type: 'set-recording-mode', inputMode: this.doubleClickMode }];
    }

    this.state = 'idle';
    this.firstClickAt = null;
    this.doubleClickApplied = false;
    return [{ type: 'stop-recording', mode: 'toggle' }];
  }

  reset(): void {
    this.state = 'idle';
    this.firstClickAt = null;
    this.doubleClickApplied = false;
    this.suppressNextKeyUp = false;
  }

  private isDoubleClick(timestampMs: number): boolean {
    return (
      this.state === 'recording' &&
      this.firstClickAt !== null &&
      !this.doubleClickApplied &&
      timestampMs - this.firstClickAt <= this.longPressMs
    );
  }
}
