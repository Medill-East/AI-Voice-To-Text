import type { AsrProvider, AsrTranscription, SherpaModelType } from './types';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

interface FunAsrProviderOptions {
  endpoint: string;
  language?: string;
  fetchImpl?: typeof fetch;
}

interface LocalSherpaProviderOptions {
  modelId?: string;
  modelPath?: string;
  sherpaModelType?: SherpaModelType;
  language?: string;
  tokensPath?: string;
  recognizerFactory?: SherpaRecognizerFactory;
}

type SherpaRecognizerFactory = (config: SherpaOfflineRecognizerConfig) => SherpaRecognizer;

export interface SherpaOfflineRecognizerConfig {
  modelConfig: Record<string, unknown>;
}

interface SherpaRecognizer {
  transcribe(audioPath: string): Promise<string> | string;
}

export class FunAsrHttpProvider implements AsrProvider {
  private readonly endpoint: string;
  private readonly language?: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: FunAsrProviderOptions) {
    this.endpoint = options.endpoint;
    this.language = options.language;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async transcribe(audio: Buffer | Uint8Array, options: { language?: string } = {}): Promise<AsrTranscription> {
    const form = new FormData();
    const bytes = audio instanceof Uint8Array ? audio : new Uint8Array(audio);
    const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    form.set('file', new Blob([arrayBuffer], { type: 'audio/webm' }), 'recording.webm');
    form.set('language', options.language ?? this.language ?? 'zh');

    let response: Response;
    try {
      response = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        body: form
      });
    } catch (error) {
      throw new UserFacingAsrError(
        '没有检测到正在运行的语音识别服务。请先一键配置本地模型，或在高级设置里确认 FunASR 服务地址。',
        'asr-http-unreachable',
        error
      );
    }

    if (!response.ok) {
      throw new UserFacingAsrError(`语音识别服务返回错误：${response.status} ${response.statusText}`, 'asr-http-error');
    }

    const payload = (await response.json()) as unknown;
    const text = extractText(payload);
    if (!text) {
      throw new Error('FunASR response did not include transcript text');
    }

    return { text };
  }
}

export class LocalSherpaAsrProvider implements AsrProvider {
  private readonly modelId?: string;
  private readonly modelPath?: string;
  private readonly modelRoot?: string;
  private readonly sherpaModelType: SherpaModelType;
  private readonly language: string;
  private readonly recognizerFactory?: SherpaRecognizerFactory;

  constructor(options: LocalSherpaProviderOptions) {
    this.modelId = options.modelId;
    this.modelPath = options.modelPath;
    this.modelRoot = options.modelPath ? dirname(options.modelPath) : undefined;
    this.sherpaModelType = options.sherpaModelType ?? 'senseVoice';
    this.language = options.language ?? 'zh';
    this.recognizerFactory = options.recognizerFactory;
  }

  async transcribe(audio: Buffer | Uint8Array): Promise<AsrTranscription> {
    if (!this.modelRoot || !this.hasRequiredModelFiles()) {
      throw new UserFacingAsrError(
        '请先一键配置本地语音模型。当前没有可用的本地模型文件，所以无法转写。',
        'asr-local-model-missing'
      );
    }

    const recognizerConfig = createSherpaOfflineRecognizerConfig({
      modelRoot: this.modelRoot,
      sherpaModelType: this.sherpaModelType,
      language: this.language
    });
    const recognizer = this.recognizerFactory
      ? this.recognizerFactory(recognizerConfig)
      : createDefaultSherpaRecognizer(recognizerConfig);

    const workDir = await mkdtemp(join(tmpdir(), `v2t-${this.modelId ?? 'asr'}-`));
    const audioPath = join(workDir, 'recording.wav');

    try {
      await writeFile(audioPath, audio);
      const text = await recognizer.transcribe(audioPath);
      return { text: stripSherpaTags(text) };
    } catch (error) {
      if (error instanceof UserFacingAsrError) {
        throw error;
      }
      throw new UserFacingAsrError(
        '本地语音模型转写失败。请确认模型已完整下载，并重新录音再试。',
        'asr-local-transcribe-failed',
        error
      );
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }

  private hasRequiredModelFiles(): boolean {
    if (!this.modelRoot) {
      return false;
    }
    return requiredSherpaFiles(this.sherpaModelType).every((file) => existsSync(join(this.modelRoot!, file)));
  }
}

export class WhisperCppAsrProvider implements AsrProvider {
  async transcribe(): Promise<AsrTranscription> {
    throw new UserFacingAsrError('Whisper.cpp 运行时尚未启用。请先选择 SenseVoice 本地模型。', 'asr-whisper-runtime-missing');
  }
}

export class UserFacingAsrError extends Error {
  readonly code: string;
  readonly cause?: unknown;

  constructor(message: string, code: string, cause?: unknown) {
    super(message);
    this.name = 'UserFacingAsrError';
    this.code = code;
    this.cause = cause;
  }
}

export function createSherpaOfflineRecognizerConfig(options: {
  modelRoot: string;
  sherpaModelType: SherpaModelType;
  language: string;
}): SherpaOfflineRecognizerConfig {
  const baseModelConfig = {
    tokens: join(options.modelRoot, 'tokens.txt'),
    debug: false,
    numThreads: 2
  };

  if (options.sherpaModelType === 'funasrNano') {
    return {
      modelConfig: {
        ...baseModelConfig,
        tokens: '',
        funasrNano: {
          encoderAdaptor: join(options.modelRoot, 'encoder_adaptor.int8.onnx'),
          llm: join(options.modelRoot, 'llm.int8.onnx'),
          embedding: join(options.modelRoot, 'embedding.int8.onnx'),
          tokenizer: join(options.modelRoot, 'Qwen3-0.6B'),
          systemPrompt: 'You are a helpful assistant.',
          userPrompt: '语音转写：',
          maxNewTokens: 512,
          temperature: 1e-6,
          topP: 0.8,
          seed: 42,
          language: '',
          itn: 1,
          hotwords: ''
        }
      }
    };
  }

  if (options.sherpaModelType === 'fireRedAsr') {
    return {
      modelConfig: {
        ...baseModelConfig,
        fireRedAsr: {
          encoder: join(options.modelRoot, 'encoder.int8.onnx'),
          decoder: join(options.modelRoot, 'decoder.int8.onnx')
        }
      }
    };
  }

  if (options.sherpaModelType === 'fireRedAsrCtc') {
    return {
      modelConfig: {
        ...baseModelConfig,
        fireRedAsrCtc: {
          model: join(options.modelRoot, 'model.int8.onnx')
        }
      }
    };
  }

  if (options.sherpaModelType === 'paraformer') {
    return {
      modelConfig: {
        ...baseModelConfig,
        paraformer: {
          model: join(options.modelRoot, 'model.int8.onnx')
        }
      }
    };
  }

  if (options.sherpaModelType === 'zipformerCtc') {
    return {
      modelConfig: {
        ...baseModelConfig,
        zipformerCtc: {
          model: join(options.modelRoot, 'model.int8.onnx')
        }
      }
    };
  }

  return {
    modelConfig: {
      ...baseModelConfig,
      senseVoice: {
        model: join(options.modelRoot, 'model.int8.onnx'),
        language: options.language,
        useInverseTextNormalization: 1
      }
    }
  };
}

function requiredSherpaFiles(modelType: SherpaModelType): string[] {
  if (modelType === 'funasrNano') {
    return [
      'encoder_adaptor.int8.onnx',
      'llm.int8.onnx',
      'embedding.int8.onnx',
      'Qwen3-0.6B/tokenizer.json',
      'Qwen3-0.6B/vocab.json',
      'Qwen3-0.6B/merges.txt'
    ];
  }
  if (modelType === 'fireRedAsr') {
    return ['encoder.int8.onnx', 'decoder.int8.onnx', 'tokens.txt'];
  }
  return ['model.int8.onnx', 'tokens.txt'];
}

function createDefaultSherpaRecognizer(config: SherpaOfflineRecognizerConfig): SherpaRecognizer {
  let sherpaOnnx: {
    createOfflineRecognizer: (config: unknown) => {
      createStream: () => {
        acceptWaveform: (sampleRate: number, samples: Float32Array) => void;
        free: () => void;
      };
      decode: (stream: unknown) => void;
      getResult: (stream: unknown) => { text: string };
      free: () => void;
    };
    readWave: (audioPath: string) => { sampleRate: number; samples: Float32Array };
  };

  try {
    sherpaOnnx = require('sherpa-onnx');
  } catch (error) {
    throw new UserFacingAsrError(
      '本地语音识别运行库尚未安装。请重新安装应用，或在开发环境运行 npm install。',
      'asr-local-runtime-missing',
      error
    );
  }

  const recognizer = sherpaOnnx.createOfflineRecognizer(config);

  return {
    transcribe(audioPath: string): string {
      const stream = recognizer.createStream();
      try {
        const wave = sherpaOnnx.readWave(audioPath);
        stream.acceptWaveform(wave.sampleRate, wave.samples);
        recognizer.decode(stream);
        return recognizer.getResult(stream).text;
      } finally {
        stream.free();
        recognizer.free();
      }
    }
  };
}

function stripSherpaTags(input: string): string {
  return input.replace(/<\|[^|]+?\|>/g, '').trim();
}

function extractText(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const objectPayload = payload as Record<string, unknown>;
  if (typeof objectPayload.text === 'string') {
    return objectPayload.text;
  }

  if (typeof objectPayload.result === 'string') {
    return objectPayload.result;
  }

  if (Array.isArray(objectPayload.result)) {
    return objectPayload.result
      .map((item) => (item && typeof item === 'object' && 'text' in item ? String((item as { text: unknown }).text) : ''))
      .filter(Boolean)
      .join('');
  }

  if (objectPayload.data && typeof objectPayload.data === 'object') {
    const data = objectPayload.data as Record<string, unknown>;
    if (typeof data.text === 'string') {
      return data.text;
    }
  }

  return null;
}
