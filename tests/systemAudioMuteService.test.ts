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
});
