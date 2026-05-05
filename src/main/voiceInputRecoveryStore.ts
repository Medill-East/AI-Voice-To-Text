import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import type { ProcessingDiagnostic, VoiceInputRecoveryJob } from '../core/types';

export interface RecoveryPartialChunk {
  index: number;
  status: 'done' | 'failed';
  text?: string;
  error?: string;
  updatedAt: string;
}

export interface RecoveryPartialResults {
  jobId: string;
  chunks: RecoveryPartialChunk[];
}

export class VoiceInputRecoveryStore {
  private readonly rootDir: string;

  constructor(userDataDir: string) {
    this.rootDir = join(userDataDir, 'recovery', 'voice-input');
  }

  root(): string {
    return this.rootDir;
  }

  jobDir(jobId: string): string {
    return join(this.rootDir, jobId);
  }

  audioPath(jobId: string): string {
    return join(this.jobDir(jobId), 'recording.wav');
  }

  diagnosticPath(jobId: string): string {
    return join(this.jobDir(jobId), 'diagnostic.json');
  }

  partialResultPath(jobId: string): string {
    return join(this.jobDir(jobId), 'partial-results.json');
  }

  chunksDir(jobId: string): string {
    return join(this.jobDir(jobId), 'chunks');
  }

  async createJob(diagnostic: ProcessingDiagnostic, audio: Buffer | Uint8Array): Promise<VoiceInputRecoveryJob> {
    const jobId = diagnostic.recoveryJobId ?? diagnostic.id;
    await mkdir(this.chunksDir(jobId), { recursive: true });
    const audioPath = this.audioPath(jobId);
    const partialResultPath = this.partialResultPath(jobId);
    const diagnosticPath = this.diagnosticPath(jobId);
    const nextDiagnostic: ProcessingDiagnostic = {
      ...diagnostic,
      recoveryJobId: jobId,
      audioPath,
      partialResultPath
    };
    const job = diagnosticToJob(nextDiagnostic, {
      audioPath,
      diagnosticPath,
      partialResultPath
    });

    await writeFile(audioPath, Buffer.from(audio));
    await writeJson(partialResultPath, { jobId, chunks: [] } satisfies RecoveryPartialResults);
    await writeJson(diagnosticPath, nextDiagnostic);
    return job;
  }

  async loadJob(jobId: string): Promise<VoiceInputRecoveryJob | undefined> {
    const diagnostic = await this.readDiagnostic(jobId);
    if (!diagnostic) {
      return undefined;
    }
    return diagnosticToJob(diagnostic, {
      audioPath: diagnostic.audioPath ?? this.audioPath(jobId),
      diagnosticPath: this.diagnosticPath(jobId),
      partialResultPath: diagnostic.partialResultPath ?? this.partialResultPath(jobId)
    });
  }

  async listJobs(): Promise<VoiceInputRecoveryJob[]> {
    if (!existsSync(this.rootDir)) {
      return [];
    }
    const entries = await readdir(this.rootDir, { withFileTypes: true });
    const jobs = await Promise.all(entries.filter((entry) => entry.isDirectory()).map((entry) => this.loadJob(entry.name)));
    return jobs
      .filter((job): job is VoiceInputRecoveryJob => Boolean(job))
      .filter((job) => job.status === 'failed')
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async deleteJob(jobId: string): Promise<void> {
    await rm(this.jobDir(jobId), { recursive: true, force: true });
  }

  async readAudio(jobId: string): Promise<Buffer> {
    return readFile(this.audioPath(jobId));
  }

  async readDiagnostic(jobId: string): Promise<ProcessingDiagnostic | undefined> {
    const path = this.diagnosticPath(jobId);
    if (!existsSync(path)) {
      return undefined;
    }
    return JSON.parse(await readFile(path, 'utf8')) as ProcessingDiagnostic;
  }

  async updateDiagnostic(jobId: string, patch: Partial<ProcessingDiagnostic>): Promise<ProcessingDiagnostic> {
    await mkdir(this.jobDir(jobId), { recursive: true });
    const current = (await this.readDiagnostic(jobId)) ?? {
      id: jobId,
      recoveryJobId: jobId,
      createdAt: new Date().toISOString(),
      stage: 'processing',
      mode: 'natural',
      audioBytes: 0,
      audioPath: this.audioPath(jobId),
      partialResultPath: this.partialResultPath(jobId)
    };
    const next: ProcessingDiagnostic = {
      ...current,
      ...patch,
      recoveryJobId: jobId,
      audioPath: patch.audioPath ?? current.audioPath ?? this.audioPath(jobId),
      partialResultPath: patch.partialResultPath ?? current.partialResultPath ?? this.partialResultPath(jobId)
    };
    await writeJson(this.diagnosticPath(jobId), next);
    return next;
  }

  async readPartialResults(jobId: string): Promise<RecoveryPartialResults> {
    const path = this.partialResultPath(jobId);
    if (!existsSync(path)) {
      return { jobId, chunks: [] };
    }
    return JSON.parse(await readFile(path, 'utf8')) as RecoveryPartialResults;
  }

  async writePartialChunk(jobId: string, chunk: Omit<RecoveryPartialChunk, 'updatedAt'>): Promise<RecoveryPartialResults> {
    await mkdir(this.jobDir(jobId), { recursive: true });
    const current = await this.readPartialResults(jobId);
    const nextChunk: RecoveryPartialChunk = { ...chunk, updatedAt: new Date().toISOString() };
    const chunks = current.chunks.filter((item) => item.index !== chunk.index).concat(nextChunk).sort((left, right) => left.index - right.index);
    const next = { jobId, chunks };
    await writeJson(this.partialResultPath(jobId), next);
    return next;
  }

  async writeChunkPaths(jobId: string, chunkPaths: string[]): Promise<void> {
    await this.updateDiagnostic(jobId, { chunkPaths, chunkCount: chunkPaths.length });
  }
}

function diagnosticToJob(
  diagnostic: ProcessingDiagnostic,
  paths: { audioPath: string; diagnosticPath: string; partialResultPath: string }
): VoiceInputRecoveryJob {
  return {
    id: diagnostic.recoveryJobId ?? diagnostic.id,
    createdAt: diagnostic.createdAt,
    mode: diagnostic.mode,
    audioDurationSeconds: diagnostic.audioDurationSeconds,
    modelId: diagnostic.modelId,
    sherpaModelType: diagnostic.sherpaModelType,
    status: diagnostic.stage === 'failed' ? 'failed' : 'processing',
    failedChunkIndex: diagnostic.failedChunkIndex,
    error: diagnostic.error,
    audioPath: paths.audioPath,
    diagnosticPath: paths.diagnosticPath,
    partialResultPath: paths.partialResultPath,
    chunkPaths: diagnostic.chunkPaths
  };
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
