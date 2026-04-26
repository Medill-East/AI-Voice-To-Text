import { PostProcessor } from './postProcessor';
import type { AsrProvider, AsrProviderKind, InputMode, ProcessedText, ProcessTextOptions, TextInjector, VoiceInputPipelineResult } from './types';
import { UserDataStore } from './userDataStore';

interface PipelinePostProcessor {
  process(input: string, options: ProcessTextOptions): Promise<ProcessedText>;
}

interface PipelineDependencies {
  store: UserDataStore;
  asr: AsrProvider;
  injector: TextInjector;
  postProcessor?: PipelinePostProcessor;
  now?: () => Date;
  idFactory?: () => string;
}

interface HandleAudioOptions {
  mode: InputMode;
  targetApp?: string;
  prompt?: string;
  audioDurationSeconds?: number;
  asrModelId?: string;
  asrProviderKind?: AsrProviderKind;
  llmModel?: string;
}

export function createVoiceInputPipeline(dependencies: PipelineDependencies) {
  const postProcessor = dependencies.postProcessor ?? new PostProcessor();
  const now = dependencies.now ?? (() => new Date());
  const idFactory =
    dependencies.idFactory ??
    (() => {
      if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
        return crypto.randomUUID();
      }
      return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    });

  return {
    async handleAudio(audio: Buffer | Uint8Array, options: HandleAudioOptions): Promise<VoiceInputPipelineResult> {
      const totalStartedAt = Date.now();
      const lexicon = await dependencies.store.loadLexicon();
      const asrStartedAt = Date.now();
      const asrResult = await dependencies.asr.transcribe(audio);
      const asrDurationMs = Date.now() - asrStartedAt;
      if (!hasEffectiveText(asrResult.text)) {
        throw new EmptyVoiceInputError();
      }
      const postProcessStartedAt = Date.now();
      const processed = await postProcessor.process(asrResult.text, {
        mode: options.mode,
        lexicon,
        prompt: options.prompt
      });
      const postProcessDurationMs = Date.now() - postProcessStartedAt;
      if (!hasEffectiveText(processed.text)) {
        throw new EmptyVoiceInputError();
      }
      const injectionStartedAt = Date.now();
      const injection = await dependencies.injector.injectText(processed.text);
      const injectionDurationMs = Date.now() - injectionStartedAt;
      const id = idFactory();
      const createdAt = now().toISOString();
      const audioDurationSeconds = options.audioDurationSeconds ?? (asrResult.durationMs ? asrResult.durationMs / 1000 : undefined);
      const metrics = {
        audioDurationSeconds,
        audioBytes: audio.byteLength,
        rawCharCount: countTextChars(asrResult.text),
        outputCharCount: countTextChars(processed.text),
        asrModelId: options.asrModelId,
        asrProviderKind: options.asrProviderKind,
        asrDurationMs,
        postProcessDurationMs,
        injectionDurationMs,
        totalDurationMs: Date.now() - totalStartedAt,
        llmModel: processed.usedLlm ? options.llmModel : undefined
      };

      await dependencies.store.appendHistory({
        id,
        createdAt,
        mode: options.mode,
        rawText: asrResult.text,
        outputText: processed.text,
        targetApp: options.targetApp,
        injectionMethod: injection.method,
        postProcessorEngine: processed.engine,
        ...metrics,
        error: injection.error
      });

      return {
        id,
        rawText: asrResult.text,
        outputText: processed.text,
        injection,
        usedLlm: processed.usedLlm,
        postProcessorEngine: processed.engine,
        metrics
      };
    }
  };
}

export class EmptyVoiceInputError extends Error {
  constructor() {
    super('未检测到有效语音输入');
    this.name = 'EmptyVoiceInputError';
  }
}

function hasEffectiveText(text: string): boolean {
  return text.replace(/[\s，,。.!！?？；;、:：'"“”‘’()[\]{}<>《》\-—_~`|/\\]+/g, '').length > 0;
}

function countTextChars(text: string): number {
  return [...text.replace(/\s+/g, '')].length;
}
