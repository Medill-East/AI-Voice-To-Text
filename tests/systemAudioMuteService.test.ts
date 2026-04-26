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

  it('uses public Windows audio COM types so PowerShell can compile the helper', async () => {
    const commands: string[] = [];
    const run = vi.fn(async (_file: string, args: string[]) => {
      commands.push(args.join('\n'));
      if (commands.length === 1) {
        return { stdout: '{"muted":false,"volume":0.7}', stderr: '' };
      }
      return { stdout: '', stderr: '' };
    });
    const service = new SystemAudioMuteService({ platform: 'win32', run });

    await expect(service.mute()).resolves.toEqual({ ok: true });

    const script = commands.join('\n');
    expect(script).toContain('public class MMDeviceEnumerator');
    expect(script).toContain('public enum EDataFlow');
    expect(script).toContain('public interface IMMDevice');
    expect(script).toContain('public interface IAudioEndpointVolume');
  });

  it('summarizes Windows audio script compile failures without returning the full PowerShell command', async () => {
    const run = vi.fn(async () => {
      throw new Error('Add-Type : SOURCE_CODE_ERROR CS0050 可访问性不一致 ' + 'x'.repeat(500));
    });
    const service = new SystemAudioMuteService({ platform: 'win32', run });

    const result = await service.mute();

    expect(result).toMatchObject({ ok: false });
    if (!result.ok) {
      expect(result.error).toContain('音频控制脚本编译失败');
      expect(result.error.length).toBeLessThan(330);
    }
  });
});
