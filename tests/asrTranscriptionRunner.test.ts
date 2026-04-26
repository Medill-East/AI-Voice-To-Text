import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { AsrTranscriptionRunner } from '../src/main/asrTranscriptionRunner';

describe('AsrTranscriptionRunner', () => {
  it('returns a user-facing ASR error when the worker crashes', async () => {
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
    const runner = new AsrTranscriptionRunner({
      workerPath: '/tmp/asrTranscriptionWorker.js',
      forkProcess: forkProcess as never,
      timeoutMs: 1000
    });

    const promise = runner.transcribe({
      audio: new Uint8Array([1, 2, 3]),
      modelId: 'qwen3-asr-0.6b',
      modelPath: '/tmp/model/encoder.int8.onnx',
      sherpaModelType: 'qwen3Asr',
      language: 'zh',
      processing: {
        id: 'diag-a',
        createdAt: '2026-04-26T15:31:17.923Z',
        stage: 'processing',
        mode: 'structured',
        modelId: 'qwen3-asr-0.6b',
        audioBytes: 857472,
        audioDurationSeconds: 26.79,
        chunkCount: 2
      }
    });

    child.stderr.emit('data', Buffer.from('native sherpa crash'));
    child.emit('exit', 139, null);

    await expect(promise).rejects.toMatchObject({
      name: 'UserFacingAsrError',
      code: 'asr-local-worker-crashed',
      diagnostic: expect.objectContaining({
        reason: 'runtime-error',
        workerExitCode: 139,
        workerStderr: expect.stringContaining('native sherpa crash')
      })
    });
    expect(forkProcess).toHaveBeenCalledWith(
      '/tmp/asrTranscriptionWorker.js',
      [],
      expect.objectContaining({
        env: expect.objectContaining({ ELECTRON_RUN_AS_NODE: '1' }),
        stdio: ['ignore', 'pipe', 'pipe', 'ipc']
      })
    );
  });

  it('times out a stuck worker and kills it', async () => {
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
    const runner = new AsrTranscriptionRunner({
      workerPath: '/tmp/asrTranscriptionWorker.js',
      forkProcess: vi.fn(() => child) as never,
      timeoutMs: 10
    });

    await expect(
      runner.transcribe({
        audio: new Uint8Array([1]),
        modelId: 'model-a',
        modelPath: '/tmp/model/model.int8.onnx',
        sherpaModelType: 'senseVoice',
        language: 'zh',
        processing: {
          id: 'diag-b',
          createdAt: '2026-04-26T15:31:17.923Z',
          stage: 'processing',
          mode: 'natural',
          modelId: 'model-a',
          audioBytes: 1,
          chunkCount: 1
        }
      })
    ).rejects.toMatchObject({
      code: 'asr-local-worker-timeout',
      diagnostic: expect.objectContaining({ workerSignal: 'timeout' })
    });
    expect(child.kill).toHaveBeenCalled();
  });
});
