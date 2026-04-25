import { describe, expect, it, vi } from 'vitest';
import { FunAsrHttpProvider, LocalSherpaAsrProvider, UserFacingAsrError } from '../src/core/asrProviders';

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
});
