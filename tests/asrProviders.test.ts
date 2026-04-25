import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  createSherpaOfflineRecognizerConfig,
  FunAsrHttpProvider,
  LocalSherpaAsrProvider,
  readWavAsFloat32,
  UserFacingAsrError
} from '../src/core/asrProviders';

describe('ASR providers', () => {
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
    await expect(provider.transcribe(Buffer.from('audio'))).rejects.toThrow('请先一键配置本地语音模型');
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
        senseVoice: {
          model: '/models/sensevoice/model.int8.onnx',
          language: 'zh',
          useInverseTextNormalization: 1
        },
        tokens: '/models/sensevoice/tokens.txt'
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

    expect(result.text).toBe('片段1\n片段2\n片段3');
    expect(durations).toHaveLength(3);
    expect(durations.every((duration) => duration <= 20.1)).toBe(true);
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
