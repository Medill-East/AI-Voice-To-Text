import { LocalSherpaAsrProvider, UserFacingAsrError } from '../core/asrProviders';
import type { AsrTranscriptionRunnerRequest } from './asrTranscriptionRunner';

process.on('message', (message) => {
  void transcribe(message as AsrTranscriptionRunnerRequest);
});

async function transcribe(request: AsrTranscriptionRunnerRequest): Promise<void> {
  try {
    send({ type: 'heartbeat', at: new Date().toISOString() });
    const provider = new LocalSherpaAsrProvider({
      modelId: request.modelId,
      modelPath: request.modelPath,
      sherpaModelType: request.sherpaModelType,
      language: request.language,
      runtime: request.runtime,
      onChunkProgress: (current, total) => {
        send({ type: 'chunk-progress', current, total });
        send({ type: 'heartbeat', at: new Date().toISOString() });
      }
    });
    const result = await provider.transcribe(Buffer.from(request.audio));
    send({ type: 'result', ok: true, text: result.text });
  } catch (error) {
    send({
      type: 'result',
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      diagnostic: error instanceof UserFacingAsrError ? error.diagnostic : undefined
    });
  } finally {
    setTimeout(() => process.exit(0), 10).unref();
  }
}

function send(message: unknown): void {
  process.send?.(message);
}
