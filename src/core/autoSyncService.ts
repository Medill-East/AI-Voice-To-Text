import type { AutoSyncState } from './types';

type TimerHandle = ReturnType<typeof setTimeout>;

interface AutoSyncServiceOptions {
  delayMs: number;
  isEnabled(): boolean;
  sync(): Promise<string | void>;
  onStatus?(state: AutoSyncState): void | Promise<void>;
  setTimer?: typeof setTimeout;
  clearTimer?: typeof clearTimeout;
}

export class AutoSyncService {
  private readonly delayMs: number;
  private readonly isEnabled: () => boolean;
  private readonly sync: () => Promise<string | void>;
  private readonly onStatus?: (state: AutoSyncState) => void | Promise<void>;
  private readonly setTimer: typeof setTimeout;
  private readonly clearTimer: typeof clearTimeout;
  private timer?: TimerHandle;
  private running = false;
  private pendingReason?: string;

  constructor(options: AutoSyncServiceOptions) {
    this.delayMs = options.delayMs;
    this.isEnabled = options.isEnabled;
    this.sync = options.sync;
    this.onStatus = options.onStatus;
    this.setTimer = options.setTimer ?? setTimeout;
    this.clearTimer = options.clearTimer ?? clearTimeout;
  }

  schedule(reason: string): boolean {
    if (!this.isEnabled()) {
      return false;
    }

    this.pendingReason = reason;
    if (this.timer) {
      this.clearTimer(this.timer);
    }
    this.emit({ status: 'queued', reason });
    this.timer = this.setTimer(() => {
      this.timer = undefined;
      void this.flush();
    }, this.delayMs);
    return true;
  }

  async flush(): Promise<void> {
    if (this.running || !this.isEnabled()) {
      return;
    }

    const reason = this.pendingReason;
    this.pendingReason = undefined;
    this.running = true;
    this.emit({ status: 'syncing', reason });
    try {
      const message = await this.sync();
      this.emit({ status: 'success', reason, message: typeof message === 'string' ? message : undefined });
    } catch (error) {
      this.emit({ status: 'failed', reason, error: readableError(error) });
    } finally {
      this.running = false;
    }
  }

  dispose(): void {
    if (this.timer) {
      this.clearTimer(this.timer);
      this.timer = undefined;
    }
  }

  private emit(state: Omit<AutoSyncState, 'updatedAt'>): void {
    void this.onStatus?.({ ...state, updatedAt: new Date().toISOString() });
  }
}

function readableError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
