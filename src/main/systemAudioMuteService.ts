import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolveBundledV2TAudioControlPath } from './nativeKeyHelper';

const execFileAsync = promisify(execFile);

export interface SystemAudioSnapshot {
  platform: NodeJS.Platform;
  muted?: boolean;
  volume?: number;
}

type CommandRunner = (file: string, args: string[]) => Promise<{ stdout: string; stderr: string }>;
type SystemAudioAction = 'read' | 'mute' | 'restore';

export interface SystemAudioDiagnostic {
  platform: NodeJS.Platform;
  action: SystemAudioAction;
  helperPath?: string;
  stdout?: string;
  stderr?: string;
  error?: string;
  at: string;
}

export class SystemAudioMuteService {
  private snapshot: SystemAudioSnapshot | undefined;
  private lastDiagnostic: SystemAudioDiagnostic | undefined;
  private readonly platform: NodeJS.Platform;
  private readonly run: CommandRunner;
  private readonly audioControlPath: string | undefined;

  constructor(options: { platform?: NodeJS.Platform; run?: CommandRunner; audioControlPath?: string } = {}) {
    this.platform = options.platform ?? process.platform;
    this.run = options.run ?? ((file, args) => execFileAsync(file, args, { timeout: 5000 }));
    this.audioControlPath = options.audioControlPath ?? (this.platform === 'win32' ? resolveBundledV2TAudioControlPath(__dirname) : undefined);
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
        await this.runWindowsAudioControl('mute', []);
        return { ok: true };
      }

      return { ok: false, error: '当前系统暂不支持自动静音。' };
    } catch (error) {
      this.snapshot = undefined;
      return { ok: false, error: this.platform === 'win32' ? readableWindowsAudioError(error) : readableError(error) };
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
        await this.runWindowsAudioControl('restore', ['--volume', String(clampVolume(snapshot.volume)), '--muted', snapshot.muted ? 'true' : 'false']);
        return { ok: true };
      }

      return { ok: true };
    } catch (error) {
      return { ok: false, error: snapshot.platform === 'win32' ? readableWindowsAudioError(error) : readableError(error) };
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
    const { stdout } = await this.runWindowsAudioControl('read', []);
    const payload = JSON.parse(stdout.trim()) as { muted?: boolean; volume?: number };
    return {
      platform: 'win32',
      muted: Boolean(payload.muted),
      volume: Number(payload.volume)
    };
  }

  getLastDiagnostic(): SystemAudioDiagnostic | undefined {
    return this.lastDiagnostic;
  }

  private async runWindowsAudioControl(action: SystemAudioAction, args: string[]): Promise<{ stdout: string; stderr: string }> {
    const helperPath = this.audioControlPath;
    if (!helperPath) {
      const error = new Error('V2TAudioControl.exe 路径未配置');
      this.recordWindowsDiagnostic(action, error);
      throw error;
    }

    try {
      const result = await this.run(helperPath, [action, ...args]);
      this.lastDiagnostic = {
        platform: 'win32',
        action,
        helperPath,
        stdout: result.stdout,
        stderr: result.stderr,
        at: new Date().toISOString()
      };
      return result;
    } catch (error) {
      this.recordWindowsDiagnostic(action, error);
      throw error;
    }
  }

  private recordWindowsDiagnostic(action: SystemAudioAction, error: unknown): void {
    const details = error as { stdout?: unknown; stderr?: unknown };
    this.lastDiagnostic = {
      platform: 'win32',
      action,
      helperPath: this.audioControlPath,
      stdout: typeof details.stdout === 'string' ? details.stdout : undefined,
      stderr: typeof details.stderr === 'string' ? details.stderr : undefined,
      error: readableError(error),
      at: new Date().toISOString()
    };
  }
}

function readableError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readableWindowsAudioError(error: unknown): string {
  const text = readableError(error);
  const compact = text.replace(/\s+/g, ' ').trim().slice(0, 220);

  if (/ENOENT|not found|找不到|V2TAudioControl\.exe 路径未配置/i.test(text)) {
    return 'Windows 音频控制组件启动失败：V2TAudioControl.exe 未找到。';
  }

  if (/audio-control-error=.*GetDefaultAudioEndpoint|default audio endpoint|0x88890004|播放设备/i.test(text)) {
    return 'Windows 音频控制组件找不到默认播放设备。';
  }

  if (/SetMute|SetMasterVolumeLevelScalar|IAudioEndpointVolume/i.test(text)) {
    return 'Windows 音频控制组件静音失败。';
  }

  if (/Unexpected token|JSON|position|parse/i.test(text)) {
    return 'Windows 音频控制组件返回了无效状态。';
  }

  return `Windows 音频控制组件失败：${compact || '未知错误'}`;
}

function clampVolume(volume: number | undefined): number {
  return Number.isFinite(volume) ? Math.max(0, Math.min(1, Number(volume))) : 1;
}
