import { describe, expect, it, vi } from 'vitest';
import { SystemAudioMuteService } from '../src/main/systemAudioMuteService';

describe('SystemAudioMuteService', () => {
  it('mutes and restores macOS output using the captured previous state', async () => {
    const run = vi.fn(async (file: string, args: string[]) => {
      if (file === 'osascript' && args.join(' ').includes('get volume settings')) {
        return { stdout: 'false,42\n', stderr: '' };
      }
      return { stdout: '', stderr: '' };
    });
    const service = new SystemAudioMuteService({ platform: 'darwin', run });

    await expect(service.mute()).resolves.toEqual({ ok: true });
    await expect(service.restore()).resolves.toEqual({ ok: true });

    expect(run).toHaveBeenCalledWith('osascript', ['-e', 'set volume output muted true']);
    expect(run).toHaveBeenCalledWith('osascript', ['-e', 'set volume output volume 42']);
    expect(run).toHaveBeenCalledWith('osascript', ['-e', 'set volume output muted false']);
  });

  it('returns a readable non-blocking error on unsupported platforms', async () => {
    const service = new SystemAudioMuteService({ platform: 'linux' });
    await expect(service.mute()).resolves.toMatchObject({ ok: false });
  });

  it('mutes and restores Windows output through the native audio control sidecar', async () => {
    const run = vi.fn(async (_file: string, args: string[]) => {
      if (args[0] === 'read') {
        return { stdout: '{"muted":false,"volume":0.7}', stderr: '' };
      }
      return { stdout: '', stderr: '' };
    });
    const service = new SystemAudioMuteService({ platform: 'win32', run, audioControlPath: 'C:\\V2T\\V2TAudioControl.exe' });

    await expect(service.mute()).resolves.toEqual({ ok: true });
    await expect(service.restore()).resolves.toEqual({ ok: true });

    expect(run).toHaveBeenNthCalledWith(1, 'C:\\V2T\\V2TAudioControl.exe', ['read']);
    expect(run).toHaveBeenNthCalledWith(2, 'C:\\V2T\\V2TAudioControl.exe', ['mute']);
    expect(run).toHaveBeenNthCalledWith(3, 'C:\\V2T\\V2TAudioControl.exe', ['restore', '--volume', '0.7', '--muted', 'false']);
    expect(run).not.toHaveBeenCalledWith('powershell.exe', expect.anything());
  });

  it('summarizes Windows audio sidecar failures without returning the full command', async () => {
    const run = vi.fn(async () => {
      throw new Error('spawn C:\\V2T\\V2TAudioControl.exe ENOENT ' + 'x'.repeat(500));
    });
    const service = new SystemAudioMuteService({ platform: 'win32', run, audioControlPath: 'C:\\V2T\\V2TAudioControl.exe' });

    const result = await service.mute();

    expect(result).toMatchObject({ ok: false });
    if (!result.ok) {
      expect(result.error).toContain('V2TAudioControl.exe 未找到');
      expect(result.error.length).toBeLessThan(330);
    }
  });

  it('reports invalid Windows audio sidecar JSON as a short readable error', async () => {
    const run = vi.fn(async () => ({ stdout: 'not-json', stderr: '' }));
    const service = new SystemAudioMuteService({ platform: 'win32', run, audioControlPath: 'C:\\V2T\\V2TAudioControl.exe' });

    const result = await service.mute();

    expect(result).toMatchObject({ ok: false });
    if (!result.ok) {
      expect(result.error).toContain('返回了无效状态');
      expect(result.error).not.toContain('powershell.exe');
    }
  });
});
