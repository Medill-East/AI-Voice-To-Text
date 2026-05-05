import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { UserFacingAsrError } from '../src/core/asrProviders';
import type { ProcessingDiagnostic } from '../src/core/types';
import { RecoverableAsrTranscriber } from '../src/main/recoverableAsrTranscriber';
import { VoiceInputRecoveryStore } from '../src/main/voiceInputRecoveryStore';

describe('VoiceInputRecoveryStore', () => {
  it('persists recovery audio and deletes a completed job', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'v2t-recovery-'));
    const store = new VoiceInputRecoveryStore(dir);
    const job = await store.createJob(diagnostic('job-a'), Buffer.from('wav bytes'));

    expect(job.audioPath).toContain('recording.wav');
    await expect(readFile(job.audioPath, 'utf8')).resolves.toBe('wav bytes');
    await expect(store.listJobs()).resolves.toEqual([]);

    await store.updateDiagnostic(job.id, { stage: 'failed', error: 'native crash', failedChunkIndex: 4 });
    const jobs = await store.listJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ id: 'job-a', status: 'failed', failedChunkIndex: 4 });

    await store.deleteJob(job.id);
    await expect(store.listJobs()).resolves.toEqual([]);
  });
});

describe('RecoverableAsrTranscriber', () => {
  it('keeps completed chunk results when a later chunk worker crashes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'v2t-recovery-runner-'));
    const store = new VoiceInputRecoveryStore(dir);
    const job = await store.createJob(diagnostic('job-b'), Buffer.from('recording'));
    const chunkPaths = await createChunks(store.chunksDir(job.id), 4);

    const transcriber = new RecoverableAsrTranscriber({
      recoveryStore: store,
      workerPath: '/tmp/asrTranscriptionWorker.js',
      splitWav: async () => chunkPaths,
      runChunk: async (request) => {
        const current = request.processing.chunkProgress?.current ?? 0;
        if (current === 4) {
          throw new UserFacingAsrError('exit=none signal=SIGTRAP', 'asr-local-worker-crashed', undefined, {
            reason: 'runtime-error',
            workerSignal: 'SIGTRAP'
          });
        }
        return { text: `chunk-${current}` };
      }
    });

    await expect(
      transcriber.transcribe({
        ...runnerRequest(job.id, job.audioPath, store.chunksDir(job.id), diagnostic('job-b')),
        processing: {
          ...diagnostic('job-b'),
          recoveryJobId: job.id,
          audioPath: job.audioPath,
          partialResultPath: job.partialResultPath
        }
      })
    ).rejects.toMatchObject({
      code: 'asr-local-worker-crashed'
    });

    const partials = await store.readPartialResults(job.id);
    expect(partials.chunks.filter((chunk) => chunk.status === 'done').map((chunk) => chunk.text)).toEqual(['chunk-1', 'chunk-2', 'chunk-3']);
    const failedJob = await store.loadJob(job.id);
    expect(failedJob).toMatchObject({ status: 'failed', failedChunkIndex: 4 });
  });

  it('resumes from unfinished chunks on retry', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'v2t-recovery-resume-'));
    const store = new VoiceInputRecoveryStore(dir);
    const job = await store.createJob(diagnostic('job-c'), Buffer.from('recording'));
    const chunkPaths = await createChunks(store.chunksDir(job.id), 3);
    await store.writePartialChunk(job.id, { index: 0, status: 'done', text: 'saved-1' });

    const seen: number[] = [];
    const transcriber = new RecoverableAsrTranscriber({
      recoveryStore: store,
      workerPath: '/tmp/asrTranscriptionWorker.js',
      splitWav: async () => chunkPaths,
      runChunk: async (request) => {
        const current = request.processing.chunkProgress?.current ?? 0;
        seen.push(current);
        return { text: `chunk-${current}` };
      }
    });

    const result = await transcriber.transcribe({
      ...runnerRequest(job.id, job.audioPath, store.chunksDir(job.id), diagnostic('job-c')),
      processing: {
        ...diagnostic('job-c'),
        recoveryJobId: job.id,
        audioPath: job.audioPath,
        partialResultPath: job.partialResultPath
      }
    });

    expect(seen).toEqual([2, 3]);
    expect(result.text).toBe('saved-1 chunk-2 chunk-3');
  });

  it('treats an empty trailing chunk as completed instead of failing the recording', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'v2t-recovery-empty-tail-'));
    const store = new VoiceInputRecoveryStore(dir);
    const job = await store.createJob(diagnostic('job-d'), Buffer.from('recording'));
    const chunkPaths = await createChunks(store.chunksDir(job.id), 3);
    const allowEmptyFlags: Array<boolean | undefined> = [];

    const transcriber = new RecoverableAsrTranscriber({
      recoveryStore: store,
      workerPath: '/tmp/asrTranscriptionWorker.js',
      splitWav: async () => chunkPaths,
      runChunk: async (request) => {
        const current = request.processing.chunkProgress?.current ?? 0;
        allowEmptyFlags.push(request.allowEmptyResult);
        return { text: current === 3 ? '' : `chunk-${current}` };
      }
    });

    const result = await transcriber.transcribe({
      ...runnerRequest(job.id, job.audioPath, store.chunksDir(job.id), diagnostic('job-d')),
      processing: {
        ...diagnostic('job-d'),
        recoveryJobId: job.id,
        audioPath: job.audioPath,
        partialResultPath: job.partialResultPath
      }
    });

    expect(result.text).toBe('chunk-1 chunk-2');
    expect(allowEmptyFlags).toEqual([true, true, true]);
    const partials = await store.readPartialResults(job.id);
    expect(partials.chunks).toMatchObject([
      { index: 0, status: 'done', text: 'chunk-1' },
      { index: 1, status: 'done', text: 'chunk-2' },
      { index: 2, status: 'done', text: '' }
    ]);
  });
});

function diagnostic(id: string): ProcessingDiagnostic {
  return {
    id,
    recoveryJobId: id,
    createdAt: '2026-05-05T07:26:58.667Z',
    stage: 'processing',
    mode: 'structured',
    modelId: 'qwen3-asr-0.6b',
    modelKind: 'local-sherpa-onnx',
    sherpaModelType: 'qwen3Asr',
    asrRuntimeProvider: 'cpu',
    asrRuntimeThreads: 5,
    audioBytes: 100,
    audioDurationSeconds: 60,
    chunkCount: 3
  };
}

function runnerRequest(jobId: string, audioPath: string, chunksDir: string, processing: ProcessingDiagnostic) {
  return {
    jobId,
    audioPath,
    chunksDir,
    modelId: 'qwen3-asr-0.6b',
    modelPath: '/tmp/model/encoder.int8.onnx',
    sherpaModelType: 'qwen3Asr' as const,
    language: 'zh',
    processing
  };
}

async function createChunks(dir: string, count: number): Promise<string[]> {
  const paths: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const path = join(dir, `chunk-${index + 1}.wav`);
    await writeFile(path, `chunk ${index + 1}`, 'utf8');
    paths.push(path);
  }
  return paths;
}
