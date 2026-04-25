import { describe, expect, it, vi } from 'vitest';
import {
  createSherpaOfflineRecognizerConfig,
  FunAsrHttpProvider,
  LocalSherpaAsrProvider,
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
});
