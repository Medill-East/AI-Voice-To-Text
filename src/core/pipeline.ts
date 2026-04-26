import { PostProcessor } from './postProcessor';
import type { AsrProvider, InputMode, ProcessedText, ProcessTextOptions, TextInjector, VoiceInputPipelineResult } from './types';
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
      const lexicon = await dependencies.store.loadLexicon();
      const asrResult = await dependencies.asr.transcribe(audio);
      if (!hasEffectiveText(asrResult.text)) {
        throw new EmptyVoiceInputError();
      }
      const processed = await postProcessor.process(asrResult.text, {
        mode: options.mode,
        lexicon,
        prompt: options.prompt
      });
      if (!hasEffectiveText(processed.text)) {
        throw new EmptyVoiceInputError();
      }
      const injection = await dependencies.injector.injectText(processed.text);
      const id = idFactory();
      const createdAt = now().toISOString();

      await dependencies.store.appendHistory({
        id,
        createdAt,
        mode: options.mode,
        rawText: asrResult.text,
        outputText: processed.text,
        targetApp: options.targetApp,
        injectionMethod: injection.method,
        postProcessorEngine: processed.engine,
        error: injection.error
      });

      return {
        id,
        rawText: asrResult.text,
        outputText: processed.text,
        injection,
        usedLlm: processed.usedLlm,
        postProcessorEngine: processed.engine
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
