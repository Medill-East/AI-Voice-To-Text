import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('voice input IPC contract', () => {
  it('keeps successful process-audio results inside the response envelope expected by preload', async () => {
    const main = await readFile(new URL('../src/main/index.ts', import.meta.url), 'utf8');
    const handler = main.slice(main.indexOf("ipcMain.handle('v2t:process-audio'"), main.indexOf("ipcMain.handle('v2t:get-recovery-jobs'"));

    expect(handler).toContain('return processAudioPayload(payload);');
    expect(handler).not.toContain("throw new Error(response.error ?? '语音处理失败')");
  });

  it('reloads persisted history after successful transcription and renders ASR and organizer model labels', async () => {
    const app = await readFile(new URL('../src/renderer/App.tsx', import.meta.url), 'utf8');

    expect(app).toContain('const refreshHistory = useCallback');
    expect(app).toContain('await refreshHistory();');
    expect(app).toContain('ASR 模型');
    expect(app).toContain('整理模型');
  });
});
