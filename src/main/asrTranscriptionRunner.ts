import { fork, type ChildProcess } from 'node:child_process';
import type { AsrTranscription, InputMode, ProcessingDiagnostic, SherpaModelType } from '../core/types';
import { UserFacingAsrError, type AsrErrorDiagnostic } from '../core/asrProviders';
import type { ResolvedAsrRuntime } from '../core/asrRuntime';

export interface AsrTranscriptionRunnerRequest {
  audio: Uint8Array;
  modelId?: string;
  modelPath?: string;
  sherpaModelType?: SherpaModelType;
  language: string;
  runtime?: ResolvedAsrRuntime;
  runtimeEnvPath?: string;
  allowEmptyResult?: boolean;
  processing: ProcessingDiagnostic & { mode: InputMode };
}

interface AsrTranscriptionRunnerOptions {
  workerPath: string;
  timeoutMs?: number;
  forkProcess?: typeof fork;
  onHeartbeat?: (at: string) => void;
  onChunkProgress?: (progress: { current: number; total: number }) => void;
}

type WorkerMessage =
  | { type: 'heartbeat'; at: string }
  | { type: 'chunk-progress'; current: number; total: number }
  | { type: 'result'; ok: true; text: string }
  | { type: 'result'; ok: false; error: string; diagnostic?: Partial<AsrErrorDiagnostic> };

export class AsrTranscriptionRunner {
  private readonly options: AsrTranscriptionRunnerOptions;
  private activeChild: ChildProcess | undefined;

  constructor(options: AsrTranscriptionRunnerOptions) {
    this.options = options;
  }

  transcribe(request: AsrTranscriptionRunnerRequest): Promise<AsrTranscription> {
    const forkProcess = this.options.forkProcess ?? fork;
    const child = forkProcess(this.options.workerPath, [], {
      env: {
        ...process.env,
        PATH: request.runtimeEnvPath ? `${request.runtimeEnvPath}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH ?? ''}` : process.env.PATH,
        Path: request.runtimeEnvPath && process.platform === 'win32' ? `${request.runtimeEnvPath};${process.env.Path ?? process.env.PATH ?? ''}` : process.env.Path,
        ELECTRON_RUN_AS_NODE: '1'
      },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      serialization: 'advanced'
    });
    this.activeChild = child;

    return new Promise((resolve, reject) => {
      let settled = false;
      let stderr = '';
      let heartbeatAt: string | undefined;
      let chunkProgress: { current: number; total: number } | undefined;
      const timeoutMs = this.options.timeoutMs ?? 180_000;
      const timeout = setTimeout(() => {
        child.kill();
        finishError(
          new UserFacingAsrError(
            `本地 ASR worker 超时：${Math.round(timeoutMs / 1000)} 秒内没有完成。`,
            'asr-local-worker-timeout',
            undefined,
            diagnostic(request, {
              runtimeError: 'timeout',
              workerSignal: 'timeout',
              workerStderr: stderr.trim() || undefined,
              heartbeatAt,
              chunkProgress
            })
          )
        );
      }, timeoutMs);

      const finish = () => {
        if (settled) {
          return false;
        }
        settled = true;
        clearTimeout(timeout);
        if (this.activeChild === child) {
          this.activeChild = undefined;
        }
        return true;
      };
      const finishError = (error: UserFacingAsrError) => {
        if (finish()) {
          reject(error);
        }
      };

      child.stderr?.on('data', (chunk) => {
        stderr += String(chunk);
      });
      child.stdout?.on('data', (chunk) => {
        stderr += String(chunk);
      });
      child.on('message', (message) => {
        const payload = message as WorkerMessage;
        if (payload.type === 'heartbeat') {
          heartbeatAt = payload.at;
          this.options.onHeartbeat?.(payload.at);
          return;
        }
        if (payload.type === 'chunk-progress') {
          chunkProgress = { current: payload.current, total: payload.total };
          this.options.onChunkProgress?.(chunkProgress);
          return;
        }
        if (payload.type === 'result' && payload.ok) {
          if (finish()) {
            resolve({ text: payload.text });
          }
          return;
        }
        if (payload.type === 'result' && !payload.ok) {
          finishError(
            new UserFacingAsrError(
              payload.error,
              'asr-local-worker-error',
              undefined,
              diagnostic(request, {
                ...(payload.diagnostic ?? {}),
                workerStderr: stderr.trim() || payload.diagnostic?.workerStderr,
                heartbeatAt,
                chunkProgress
              })
            )
          );
        }
      });
      child.on('error', (error) => {
        finishError(
          new UserFacingAsrError(
            `本地 ASR worker 启动失败：${error.message}`,
            'asr-local-worker-start-failed',
            error,
            diagnostic(request, { runtimeError: error.message, workerStderr: stderr.trim() || undefined, heartbeatAt, chunkProgress })
          )
        );
      });
      child.on('exit', (code, signal) => {
        if (!settled) {
          finishError(
            new UserFacingAsrError(
              `本地 ASR worker 异常退出：${stderr.trim() || `exit=${code ?? 'none'} signal=${signal ?? 'none'}`}`,
              'asr-local-worker-crashed',
              undefined,
              diagnostic(request, {
                runtimeError: stderr.trim() || `exit=${code ?? 'none'} signal=${signal ?? 'none'}`,
                workerExitCode: code,
                workerSignal: signal,
                workerStderr: stderr.trim() || undefined,
                heartbeatAt,
                chunkProgress
              })
            )
          );
        }
      });

      child.send?.(request);
    });
  }

  cancel(): void {
    this.activeChild?.kill();
  }
}

function diagnostic(request: AsrTranscriptionRunnerRequest, details: Partial<AsrErrorDiagnostic>): AsrErrorDiagnostic {
  return {
    reason: 'runtime-error',
    modelId: request.modelId,
    modelPath: request.modelPath,
    sherpaModelType: request.sherpaModelType,
    chunkCount: request.processing.chunkCount,
    ...details
  };
}
