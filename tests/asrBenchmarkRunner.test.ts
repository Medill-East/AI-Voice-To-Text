import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { AsrBenchmarkRunner } from '../src/main/asrBenchmarkRunner';

describe('AsrBenchmarkRunner', () => {
  it('returns a failed benchmark result when the worker crashes before sending a result', async () => {
    const child = new EventEmitter() as EventEmitter & {
      send: ReturnType<typeof vi.fn>;
      kill: ReturnType<typeof vi.fn>;
      stdout: EventEmitter;
      stderr: EventEmitter;
    };
    child.send = vi.fn();
    child.kill = vi.fn();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    const forkProcess = vi.fn(() => child);
    const runner = new AsrBenchmarkRunner({
      workerPath: '/tmp/asrBenchmarkWorker.js',
      dataDir: '/tmp/data',
      modelRoot: '/tmp/models',
      deviceId: 'device-a',
      catalog: [],
      forkProcess: forkProcess as never,
      timeoutMs: 1000
    });

    const promise = runner.runModel('model-a');
    child.stderr.emit('data', Buffer.from('native runtime crashed'));
    child.emit('exit', 139, null);

    await expect(promise).resolves.toMatchObject({
      modelId: 'model-a',
      ok: false,
      error: expect.stringContaining('native runtime crashed')
    });
    expect(forkProcess).toHaveBeenCalledWith(
      '/tmp/asrBenchmarkWorker.js',
      [],
      expect.objectContaining({
        env: expect.objectContaining({ ELECTRON_RUN_AS_NODE: '1' }),
        stdio: ['ignore', 'pipe', 'pipe', 'ipc']
      })
    );
  });

  it('can cancel an active worker without throwing in the caller', async () => {
    const child = new EventEmitter() as EventEmitter & {
      send: ReturnType<typeof vi.fn>;
      kill: ReturnType<typeof vi.fn>;
      stdout: EventEmitter;
      stderr: EventEmitter;
    };
    child.send = vi.fn();
    child.kill = vi.fn();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    const runner = new AsrBenchmarkRunner({
      workerPath: '/tmp/asrBenchmarkWorker.js',
      dataDir: '/tmp/data',
      modelRoot: '/tmp/models',
      deviceId: 'device-a',
      catalog: [],
      forkProcess: vi.fn(() => child) as never,
      timeoutMs: 1000
    });

    const promise = runner.runModel('model-a');
    runner.cancel();
    child.emit('exit', null, 'SIGTERM');

    await expect(promise).resolves.toMatchObject({ modelId: 'model-a', ok: false });
    expect(child.kill).toHaveBeenCalled();
  });
});
