import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  CloudAsrProvider,
  createSherpaOfflineRecognizerConfig,
  FunAsrHttpProvider,
  joinAsrChunkTexts,
  LocalSherpaAsrProvider,
  readWavAsFloat32,
  splitWavForLocalSherpa,
  UserFacingAsrError
} from '../src/core/asrProviders';
import { resolveAsrNumThreads, resolveLocalSherpaRuntime, localSherpaRuntimeLabel } from '../src/core/asrRuntime';

describe('ASR providers', () => {
  it('sends OpenAI-compatible transcription requests as multipart WAV uploads', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ text: '云端转写结果' })
    });
    const provider = new CloudAsrProvider({
      provider: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini-transcribe',
      apiKey: 'secret-key',
      fetchImpl
    });

    await expect(provider.transcribe(Buffer.from('wav-audio'), { language: 'zh' })).resolves.toMatchObject({
      text: '云端转写结果'
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.openai.com/v1/audio/transcriptions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer secret-key' }),
        body: expect.any(FormData)
      })
    );
    const body = fetchImpl.mock.calls[0][1].body as FormData;
    expect(body.get('model')).toBe('gpt-4o-mini-transcribe');
    expect(body.get('language')).toBe('zh');
    expect(body.get('file')).toBeInstanceOf(Blob);
  });

  it('sends Groq free-tier Whisper requests to its OpenAI-compatible transcription endpoint', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ text: 'Groq 转写结果' })
    });
    const provider = new CloudAsrProvider({
      provider: 'groq',
      baseUrl: 'https://api.groq.com/openai/v1',
      model: 'whisper-large-v3-turbo',
      apiKey: 'groq-test-key',
      fetchImpl
    });

    await expect(provider.transcribe(Buffer.from('wav-audio'), { language: 'zh' })).resolves.toMatchObject({
      text: 'Groq 转写结果'
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.groq.com/openai/v1/audio/transcriptions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer groq-test-key' })
      })
    );
    const body = fetchImpl.mock.calls[0][1].body as FormData;
    expect(body.get('model')).toBe('whisper-large-v3-turbo');
    expect(body.get('language')).toBe('zh');
  });

  it('turns cloud ASR failures into user-facing errors without leaking API keys', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      text: () => Promise.resolve('bad key sk-test-secret')
    });
    const provider = new CloudAsrProvider({
      provider: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini-transcribe',
      apiKey: 'sk-test-secret',
      fetchImpl
    });

    await expect(provider.transcribe(Buffer.from('audio'))).rejects.toMatchObject({
      name: 'UserFacingAsrError',
      code: 'asr-cloud-http-error',
      diagnostic: expect.objectContaining({
        reason: 'runtime-error',
        cloudProvider: 'openai',
        cloudModel: 'gpt-4o-mini-transcribe',
        uploadedBytes: 5
      })
    });
    await expect(provider.transcribe(Buffer.from('audio'))).rejects.not.toThrow('sk-test-secret');
  });

  it('turns HTTP fetch failures into a user-facing configuration error', async () => {
    const provider = new FunAsrHttpProvider({
      endpoint: 'http://127.0.0.1:10095/transcribe',
      fetchImpl: vi.fn().mockRejectedValue(new TypeError('fetch failed'))
    });

    await expect(provider.transcribe(Buffer.from('audio'))).rejects.toMatchObject({
      name: 'UserFacingAsrError',
      message: expect.stringContaining('没有检测到正在运行的语音识别服务')
    });
  });

  it('explains that a local model must be installed before transcription', async () => {
    const provider = new LocalSherpaAsrProvider({ modelId: 'sensevoice-onnx-int8-2025' });

    await expect(provider.transcribe(Buffer.from('audio'))).rejects.toBeInstanceOf(UserFacingAsrError);
    await expect(provider.transcribe(Buffer.from('audio'))).rejects.toThrow('本地语音模型文件不完整');
    await expect(provider.transcribe(Buffer.from('audio'))).rejects.toMatchObject({
      diagnostic: expect.objectContaining({
        reason: 'missing-files',
        missingFiles: expect.arrayContaining(['model.int8.onnx', 'tokens.txt'])
      })
    });
  });

  it('builds sherpa configs for multiple local model families', () => {
    expect(
      createSherpaOfflineRecognizerConfig({
        modelRoot: '/models/sensevoice',
        sherpaModelType: 'senseVoice',
        language: 'zh'
      })
    ).toMatchObject({
      modelConfig: {
        provider: 'cpu',
        numThreads: 2,
        senseVoice: {
          model: '/models/sensevoice/model.int8.onnx',
          language: 'zh',
          useInverseTextNormalization: 1
        },
        tokens: '/models/sensevoice/tokens.txt'
      }
    });
    expect(resolveAsrNumThreads('auto', 12)).toBe(6);
    expect(localSherpaRuntimeLabel(resolveLocalSherpaRuntime({ provider: 'cpu', numThreads: 'auto', cudaExperimental: false }, { cpuCores: 12 }))).toBe('CPU · 6 线程');
    expect(
      resolveLocalSherpaRuntime(
        { provider: 'cuda', numThreads: 4, cudaExperimental: true },
        { cpuCores: 12, platform: 'win32', cudaRuntimeAvailable: false, cudaUnavailableReason: '缺少 CUDA runtime' }
      )
    ).toMatchObject({
      provider: 'cpu',
      numThreads: 4,
      backendStatus: 'cuda-experimental-unavailable',
      unavailableReason: '缺少 CUDA runtime'
    });
    expect(
      resolveLocalSherpaRuntime({ provider: 'cuda', numThreads: 4, cudaExperimental: true }, { cpuCores: 12, platform: 'win32', cudaRuntimeAvailable: true })
    ).toMatchObject({
      provider: 'cuda',
      numThreads: 4,
      backendStatus: 'cuda-experimental-active'
    });

    expect(
      createSherpaOfflineRecognizerConfig({
        modelRoot: '/models/sensevoice',
        sherpaModelType: 'senseVoice',
        language: 'zh',
        runtime: resolveLocalSherpaRuntime({ provider: 'cpu', numThreads: 8, cudaExperimental: false }, { cpuCores: 12 })
      })
    ).toMatchObject({
      modelConfig: {
        provider: 'cpu',
        numThreads: 8
      }
    });

    expect(
      createSherpaOfflineRecognizerConfig({
        modelRoot: '/models/funasr',
        sherpaModelType: 'funasrNano',
        language: 'zh'
      })
    ).toMatchObject({
      modelConfig: {
        funasrNano: {
          encoderAdaptor: '/models/funasr/encoder_adaptor.int8.onnx',
          llm: '/models/funasr/llm.int8.onnx',
          embedding: '/models/funasr/embedding.int8.onnx',
          tokenizer: '/models/funasr/Qwen3-0.6B',
          userPrompt: '语音转写：'
        }
      }
    });

    expect(
      createSherpaOfflineRecognizerConfig({
        modelRoot: '/models/firered',
        sherpaModelType: 'fireRedAsr',
        language: 'zh'
      })
    ).toMatchObject({
      modelConfig: {
        fireRedAsr: {
          encoder: '/models/firered/encoder.int8.onnx',
          decoder: '/models/firered/decoder.int8.onnx'
        },
        tokens: '/models/firered/tokens.txt'
      }
    });

    expect(
      createSherpaOfflineRecognizerConfig({
        modelRoot: '/models/qwen3',
        sherpaModelType: 'qwen3Asr',
        language: 'zh'
      })
    ).toMatchObject({
      modelConfig: {
        tokens: '',
        qwen3Asr: {
          convFrontend: '/models/qwen3/conv_frontend.onnx',
          encoder: '/models/qwen3/encoder.int8.onnx',
          decoder: '/models/qwen3/decoder.int8.onnx',
          tokenizer: '/models/qwen3/tokenizer',
          maxNewTokens: 512
        }
      }
    });
  });

  it('turns native sherpa numeric throws into a user-facing transcription error', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'v2t-asr-'));
    await mkdir(baseDir, { recursive: true });
    const modelPath = join(baseDir, 'model.int8.onnx');
    await writeFile(modelPath, 'model');
    await writeFile(join(baseDir, 'tokens.txt'), 'tokens');
    const provider = new LocalSherpaAsrProvider({
      modelId: 'sensevoice-onnx-int8-2025-09-09',
      modelPath,
      recognizerFactory: () => {
        throw 16182408;
      }
    });

    await expect(provider.transcribe(Buffer.from('audio'))).rejects.toMatchObject({
      name: 'UserFacingAsrError',
      message: expect.stringContaining('本地语音模型转写失败')
    });
  });

  it('splits long Fun-ASR-Nano audio into shorter chunks before transcription', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'v2t-funasr-long-'));
    await writeFunAsrModelFiles(baseDir);
    const audio = createPcm16Wav(new Array(16000 * 50).fill(1000), 16000);
    const durations: number[] = [];
    const provider = new LocalSherpaAsrProvider({
      modelId: 'funasr-nano-int8-2025-12-30',
      modelPath: join(baseDir, 'encoder_adaptor.int8.onnx'),
      sherpaModelType: 'funasrNano',
      recognizerFactory: () => ({
        transcribe: (audioPath) => {
          const wave = readWavAsFloat32(audioPath);
          durations.push(wave.samples.length / wave.sampleRate);
          return `片段${durations.length}`;
        }
      })
    });

    const result = await provider.transcribe(audio);

    expect(result.text).toBe('片段1片段2片段3');
    expect(durations).toHaveLength(3);
    expect(durations.every((duration) => duration <= 20.1)).toBe(true);
  });

  it('splits long SenseVoice audio into shorter chunks before transcription', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'v2t-sensevoice-long-'));
    await writeFile(join(baseDir, 'model.int8.onnx'), 'model');
    await writeFile(join(baseDir, 'tokens.txt'), 'tokens');
    const audio = createPcm16Wav(new Array(16000 * 90).fill(1000), 16000);
    const durations: number[] = [];
    const provider = new LocalSherpaAsrProvider({
      modelId: 'sensevoice-onnx-int8-2025-09-09',
      modelPath: join(baseDir, 'model.int8.onnx'),
      sherpaModelType: 'senseVoice',
      recognizerFactory: () => ({
        transcribe: (audioPath) => {
          const wave = readWavAsFloat32(audioPath);
          durations.push(wave.samples.length / wave.sampleRate);
          return `片段${durations.length}`;
        }
      })
    });

    const result = await provider.transcribe(audio);

    expect(result.text).toBe('片段1片段2片段3片段4片段5');
    expect(durations).toHaveLength(5);
    expect(durations.every((duration) => duration <= 20.1)).toBe(true);
  });

  it('prefers quiet boundaries when splitting long local sherpa wavs', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'v2t-vad-split-'));
    const audioPath = join(dir, 'recording.wav');
    const sampleRate = 16000;
    await writeFile(
      audioPath,
      createPcm16Wav(
        [
          ...new Array(sampleRate * 18).fill(1000),
          ...new Array(sampleRate * 2).fill(0),
          ...new Array(sampleRate * 22).fill(1000)
        ],
        sampleRate
      )
    );

    const paths = await splitWavForLocalSherpa(audioPath, dir, 20);
    const durations = paths.map((path) => {
      const wave = readWavAsFloat32(path);
      return wave.samples.length / wave.sampleRate;
    });

    expect(paths.length).toBeGreaterThan(1);
    expect(durations[0]).toBeLessThan(20);
    expect(durations[0]).toBeGreaterThan(17.5);
    expect(durations.every((duration) => duration <= 20.1)).toBe(true);
  });

  it('joins ASR chunk text without adding fake paragraph breaks', () => {
    expect(joinAsrChunkTexts(['模型下载', '速度很慢', '', 'OpenAI', 'compatible'])).toBe('模型下载速度很慢OpenAI compatible');
    expect(joinAsrChunkTexts(['hello', 'world'])).toBe('hello world');
  });

  it('decodes PCM16 mono WAV into regular Float32 samples', async () => {
    const audioPath = join(await mkdtemp(join(tmpdir(), 'v2t-wav-')), 'sample.wav');
    await writeFile(audioPath, createPcm16Wav([0, 16384, -16384, 32767], 16000));

    const wave = readWavAsFloat32(audioPath);

    expect(wave.sampleRate).toBe(16000);
    expect(Array.from(wave.samples)).toEqual([0, 0.5, -0.5, expect.closeTo(0.999969, 5)]);
    expect(Object.getPrototypeOf(wave.samples).constructor.name).toBe('Float32Array');
  });

  it('rejects invalid or unsupported WAV input with readable errors', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'v2t-wav-'));
    const missingData = join(dir, 'missing-data.wav');
    const unsupported = join(dir, 'unsupported.wav');
    await writeFile(missingData, createPcm16Wav([], 16000).subarray(0, 44));
    await writeFile(unsupported, createPcm16Wav([1], 16000, { format: 3 }));

    expect(() => readWavAsFloat32(missingData)).toThrow('缺少 data');
    expect(() => readWavAsFloat32(unsupported)).toThrow('仅支持 PCM16');
  });
});

function createPcm16Wav(samples: number[], sampleRate: number, options: { format?: number } = {}): Buffer {
  const bytesPerSample = 2;
  const dataSize = samples.length * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(options.format ?? 1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * bytesPerSample, 28);
  buffer.writeUInt16LE(bytesPerSample, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataSize, 40);
  samples.forEach((sample, index) => buffer.writeInt16LE(sample, 44 + index * bytesPerSample));
  return buffer;
}

async function writeFunAsrModelFiles(baseDir: string): Promise<void> {
  await mkdir(join(baseDir, 'Qwen3-0.6B'), { recursive: true });
  await writeFile(join(baseDir, 'encoder_adaptor.int8.onnx'), 'encoder');
  await writeFile(join(baseDir, 'llm.int8.onnx'), 'llm');
  await writeFile(join(baseDir, 'embedding.int8.onnx'), 'embedding');
  await writeFile(join(baseDir, 'Qwen3-0.6B', 'tokenizer.json'), '{}');
  await writeFile(join(baseDir, 'Qwen3-0.6B', 'vocab.json'), '{}');
  await writeFile(join(baseDir, 'Qwen3-0.6B', 'merges.txt'), '');
}
