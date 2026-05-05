import { readFile } from 'node:fs/promises';
import { LOCAL_SHERPA_MAX_CHUNK_SECONDS, splitWavForLocalSherpa, UserFacingAsrError, type AsrErrorDiagnostic } from '../core/asrProviders';
import type { AsrTranscription } from '../core/types';
import { AsrTranscriptionRunner, type AsrTranscriptionRunnerRequest } from './asrTranscriptionRunner';
import { VoiceInputRecoveryStore, type RecoveryPartialResults } from './voiceInputRecoveryStore';

export interface RecoverableAsrTranscriberOptions {
  recoveryStore: VoiceInputRecoveryStore;
  workerPath: string;
  timeoutMs?: number;
  onHeartbeat?: (jobId: string, at: string) => void;
  onChunkProgress?: (jobId: string, progress: { current: number; total: number }) => void;
  runChunk?: (request: AsrTranscriptionRunnerRequest) => Promise<AsrTranscription>;
  splitWav?: (audioPath: string, chunksDir: string, maxChunkSeconds: number) => Promise<string[]>;
}

export interface RecoverableAsrRequest extends Omit<AsrTranscriptionRunnerRequest, 'audio'> {
  jobId: string;
  audioPath: string;
  chunksDir: string;
}

export class RecoverableAsrTranscriber {
  private readonly options: RecoverableAsrTranscriberOptions;

  constructor(options: RecoverableAsrTranscriberOptions) {
    this.options = options;
  }

  async transcribe(request: RecoverableAsrRequest): Promise<AsrTranscription> {
    const splitWav = this.options.splitWav ?? splitWavForLocalSherpa;
    const chunkPaths = await splitWav(request.audioPath, request.chunksDir, LOCAL_SHERPA_MAX_CHUNK_SECONDS);
    await this.options.recoveryStore.writeChunkPaths(request.jobId, chunkPaths);
    await this.options.recoveryStore.updateDiagnostic(request.jobId, {
      stage: 'asr',
      chunkCount: chunkPaths.length,
      chunkPaths,
      chunkProgress: { current: 0, total: chunkPaths.length }
    });

    const partials = await this.options.recoveryStore.readPartialResults(request.jobId);
    const completed = new Map(partials.chunks.filter((chunk) => chunk.status === 'done' && chunk.text !== undefined).map((chunk) => [chunk.index, chunk.text ?? '']));

    for (let index = 0; index < chunkPaths.length; index += 1) {
      if (completed.has(index)) {
        continue;
      }

      const progress = { current: index + 1, total: chunkPaths.length };
      this.options.onChunkProgress?.(request.jobId, progress);
      await this.options.recoveryStore.updateDiagnostic(request.jobId, {
        stage: 'asr',
        chunkProgress: progress
      });

      try {
        const chunkAudio = await readFile(chunkPaths[index]);
        const result = await this.runChunk({
          ...request,
          audio: new Uint8Array(chunkAudio),
          allowEmptyResult: true,
          processing: {
            ...request.processing,
            audioBytes: chunkAudio.byteLength,
            chunkCount: chunkPaths.length,
            chunkProgress: progress
          }
        });
        completed.set(index, result.text);
        await this.options.recoveryStore.writePartialChunk(request.jobId, {
          index,
          status: 'done',
          text: result.text
        });
      } catch (error) {
        const message = readableError(error);
        await this.options.recoveryStore.writePartialChunk(request.jobId, {
          index,
          status: 'failed',
          error: message
        });
        const diagnostic = asrDiagnostic(error, request, {
          chunkCount: chunkPaths.length,
          chunkProgress: progress,
          chunkPaths,
          failedChunkIndex: index + 1
        });
        await this.options.recoveryStore.updateDiagnostic(request.jobId, {
          stage: 'failed',
          error: message,
          failedChunkIndex: index + 1,
          chunkProgress: progress
        });
        throw new UserFacingAsrError(
          `本地 ASR 分片 ${index + 1}/${chunkPaths.length} 转写失败：${message}。已保留录音，可重新处理；如果同一分片反复失败，请换模型或降低 CPU 线程数。`,
          error instanceof UserFacingAsrError ? error.code : 'asr-local-chunk-worker-failed',
          error,
          diagnostic
        );
      }
    }

    const latestPartials = await this.options.recoveryStore.readPartialResults(request.jobId);
    await this.options.recoveryStore.updateDiagnostic(request.jobId, {
      stage: 'post-processing',
      chunkProgress: { current: chunkPaths.length, total: chunkPaths.length }
    });

    return {
      text: joinPartialText(latestPartials, chunkPaths.length)
    };
  }

  private runChunk(request: AsrTranscriptionRunnerRequest): Promise<AsrTranscription> {
    if (this.options.runChunk) {
      return this.options.runChunk(request);
    }
    const runner = new AsrTranscriptionRunner({
      workerPath: this.options.workerPath,
      timeoutMs: this.options.timeoutMs,
      onHeartbeat: (at) => {
        this.options.onHeartbeat?.(request.processing.recoveryJobId ?? request.processing.id, at);
      }
    });
    return runner.transcribe(request);
  }
}

function joinPartialText(partials: RecoveryPartialResults, chunkCount: number): string {
  const chunks = new Map(partials.chunks.filter((chunk) => chunk.status === 'done').map((chunk) => [chunk.index, chunk.text ?? '']));
  const texts: string[] = [];
  for (let index = 0; index < chunkCount; index += 1) {
    const text = chunks.get(index)?.trim();
    if (text) {
      texts.push(text);
    }
  }
  return texts.join('\n').trim();
}

function asrDiagnostic(
  error: unknown,
  request: RecoverableAsrRequest,
  patch: Partial<AsrErrorDiagnostic> & { failedChunkIndex: number }
): AsrErrorDiagnostic {
  const base = error instanceof UserFacingAsrError ? error.diagnostic : undefined;
  return {
    ...(base ?? {}),
    reason: 'chunk-failed',
    modelId: request.modelId,
    modelPath: request.modelPath,
    sherpaModelType: request.sherpaModelType,
    recoveryJobId: request.jobId,
    audioPath: request.audioPath,
    partialResultPath: request.processing.partialResultPath,
    chunkPaths: request.processing.chunkPaths,
    ...patch
  } as AsrErrorDiagnostic;
}

function readableError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
