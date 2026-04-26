import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface SystemAudioSnapshot {
  platform: NodeJS.Platform;
  muted?: boolean;
  volume?: number;
}

type CommandRunner = (file: string, args: string[]) => Promise<{ stdout: string; stderr: string }>;

export class SystemAudioMuteService {
  private snapshot: SystemAudioSnapshot | undefined;
  private readonly platform: NodeJS.Platform;
  private readonly run: CommandRunner;

  constructor(options: { platform?: NodeJS.Platform; run?: CommandRunner } = {}) {
    this.platform = options.platform ?? process.platform;
    this.run = options.run ?? ((file, args) => execFileAsync(file, args, { timeout: 5000 }));
  }

  async mute(): Promise<{ ok: true } | { ok: false; error: string }> {
    if (this.snapshot) {
      return { ok: true };
    }

    try {
      if (this.platform === 'darwin') {
        this.snapshot = await this.readMacSnapshot();
        await this.run('osascript', ['-e', 'set volume output muted true']);
        return { ok: true };
      }

      if (this.platform === 'win32') {
        this.snapshot = await this.readWindowsSnapshot();
        await this.run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', windowsAudioScript('mute')]);
        return { ok: true };
      }

      return { ok: false, error: '当前系统暂不支持自动静音。' };
    } catch (error) {
      this.snapshot = undefined;
      return { ok: false, error: readableError(error) };
    }
  }

  async restore(): Promise<{ ok: true } | { ok: false; error: string }> {
    const snapshot = this.snapshot;
    this.snapshot = undefined;
    if (!snapshot) {
      return { ok: true };
    }

    try {
      if (snapshot.platform === 'darwin') {
        if (typeof snapshot.volume === 'number') {
          await this.run('osascript', ['-e', `set volume output volume ${Math.round(snapshot.volume)}`]);
        }
        await this.run('osascript', ['-e', `set volume output muted ${snapshot.muted ? 'true' : 'false'}`]);
        return { ok: true };
      }

      if (snapshot.platform === 'win32') {
        await this.run('powershell.exe', [
          '-NoProfile',
          '-ExecutionPolicy',
          'Bypass',
          '-Command',
          windowsAudioScript('restore', snapshot.volume, snapshot.muted)
        ]);
        return { ok: true };
      }

      return { ok: true };
    } catch (error) {
      return { ok: false, error: readableError(error) };
    }
  }

  private async readMacSnapshot(): Promise<SystemAudioSnapshot> {
    const { stdout } = await this.run('osascript', [
      '-e',
      'set settingsValue to get volume settings',
      '-e',
      'return (output muted of settingsValue as text) & "," & (output volume of settingsValue as text)'
    ]);
    const [mutedText, volumeText] = stdout.trim().split(',');
    return {
      platform: 'darwin',
      muted: mutedText === 'true',
      volume: Number(volumeText)
    };
  }

  private async readWindowsSnapshot(): Promise<SystemAudioSnapshot> {
    const { stdout } = await this.run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', windowsAudioScript('read')]);
    const payload = JSON.parse(stdout.trim()) as { muted?: boolean; volume?: number };
    return {
      platform: 'win32',
      muted: Boolean(payload.muted),
      volume: Number(payload.volume)
    };
  }
}

function windowsAudioScript(action: 'read' | 'mute' | 'restore', volume = 1, muted = false): string {
  const restoreVolume = Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 1;
  return `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
[Guid("BCDE0395-E52F-467C-8E3D-C4579291692E"), ComImport] class MMDeviceEnumerator {}
enum EDataFlow { eRender, eCapture, eAll }
enum ERole { eConsole, eMultimedia, eCommunications }
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator { int NotImpl1(); int GetDefaultAudioEndpoint(EDataFlow dataFlow, ERole role, out IMMDevice endpoint); }
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice { int Activate(ref Guid iid, int dwClsCtx, IntPtr pActivationParams, out IAudioEndpointVolume endpointVolume); }
[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
 int RegisterControlChangeNotify(IntPtr pNotify); int UnregisterControlChangeNotify(IntPtr pNotify);
 int GetChannelCount(out int channelCount); int SetMasterVolumeLevel(float level, Guid eventContext);
 int SetMasterVolumeLevelScalar(float level, Guid eventContext); int GetMasterVolumeLevel(out float level);
 int GetMasterVolumeLevelScalar(out float level); int SetChannelVolumeLevel(uint channelNumber, float level, Guid eventContext);
 int SetChannelVolumeLevelScalar(uint channelNumber, float level, Guid eventContext); int GetChannelVolumeLevel(uint channelNumber, out float level);
 int GetChannelVolumeLevelScalar(uint channelNumber, out float level); int SetMute([MarshalAs(UnmanagedType.Bool)] bool isMuted, Guid eventContext);
 int GetMute(out bool isMuted); int GetVolumeStepInfo(out uint step, out uint stepCount); int VolumeStepUp(Guid eventContext);
 int VolumeStepDown(Guid eventContext); int QueryHardwareSupport(out uint hardwareSupportMask); int GetVolumeRange(out float volumeMin, out float volumeMax, out float volumeStep);
}
public class AudioEndpoint {
 public static IAudioEndpointVolume Volume() {
  IMMDeviceEnumerator enumerator = (IMMDeviceEnumerator)(new MMDeviceEnumerator());
  IMMDevice device; Marshal.ThrowExceptionForHR(enumerator.GetDefaultAudioEndpoint(EDataFlow.eRender, ERole.eMultimedia, out device));
  Guid iid = typeof(IAudioEndpointVolume).GUID; IAudioEndpointVolume volume;
  Marshal.ThrowExceptionForHR(device.Activate(ref iid, 23, IntPtr.Zero, out volume)); return volume;
 }
}
"@
$endpoint = [AudioEndpoint]::Volume()
${action === 'read' ? '$muted = $false; $level = 0.0; [void]$endpoint.GetMute([ref]$muted); [void]$endpoint.GetMasterVolumeLevelScalar([ref]$level); @{ muted = $muted; volume = $level } | ConvertTo-Json -Compress' : ''}
${action === 'mute' ? '[void]$endpoint.SetMute($true, [Guid]::Empty)' : ''}
${action === 'restore' ? `[void]$endpoint.SetMasterVolumeLevelScalar(${restoreVolume}, [Guid]::Empty); [void]$endpoint.SetMute($${muted ? 'true' : 'false'}, [Guid]::Empty)` : ''}
`;
}

function readableError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
