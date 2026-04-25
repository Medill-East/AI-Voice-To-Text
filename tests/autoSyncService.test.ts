import { describe, expect, it, vi } from 'vitest';
import { AutoSyncService } from '../src/core/autoSyncService';

describe('AutoSyncService', () => {
  it('queues successful input sync without blocking and coalesces rapid changes', async () => {
    vi.useFakeTimers();
    const sync = vi.fn(async () => undefined);
    const statuses: string[] = [];
    const service = new AutoSyncService({
      delayMs: 10_000,
      isEnabled: () => true,
      sync,
      onStatus: (state) => {
        statuses.push(state.status);
      }
    });

    expect(service.schedule('voice-input')).toBe(true);
    expect(service.schedule('prompt-save')).toBe(true);
    expect(statuses).toEqual(['queued', 'queued']);
    expect(sync).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(10_000);

    expect(sync).toHaveBeenCalledTimes(1);
    expect(statuses).toEqual(['queued', 'queued', 'syncing', 'success']);
    vi.useRealTimers();
  });

  it('does nothing when auto sync is disabled and reports failed sync without throwing', async () => {
    vi.useFakeTimers();
    const sync = vi.fn(async () => {
      throw new Error('remote rejected');
    });
    const states: Array<{ status: string; error?: string }> = [];
    const disabled = new AutoSyncService({
      delayMs: 10,
      isEnabled: () => false,
      sync,
      onStatus: (state) => {
        states.push({ status: state.status, error: state.error });
      }
    });

    expect(disabled.schedule('voice-input')).toBe(false);
    expect(sync).not.toHaveBeenCalled();

    const enabled = new AutoSyncService({
      delayMs: 10,
      isEnabled: () => true,
      sync,
      onStatus: (state) => {
        states.push({ status: state.status, error: state.error });
      }
    });
    enabled.schedule('voice-input');
    await vi.advanceTimersByTimeAsync(10);

    expect(states.at(-1)).toEqual({ status: 'failed', error: 'remote rejected' });
    vi.useRealTimers();
  });
});
