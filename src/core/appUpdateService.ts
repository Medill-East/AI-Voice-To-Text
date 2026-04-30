import type { AppUpdateState } from './types';

type UpdateEvent = 'update-available' | 'update-not-available' | 'download-progress' | 'update-downloaded' | 'error';

export interface AppUpdaterLike {
  autoDownload?: boolean;
  on(event: UpdateEvent, listener: (...args: unknown[]) => void): unknown;
  checkForUpdates(): Promise<unknown>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
}

interface AppUpdateServiceOptions {
  currentVersion: string;
  updater: AppUpdaterLike;
  platform?: NodeJS.Platform;
  updateMetadataUrl?: string;
  now?: () => Date;
  onStatus?: (state: AppUpdateState) => void;
}

interface UpdateInfoLike {
  version?: string;
  releaseName?: string;
  releaseNotes?: unknown;
}

interface DownloadProgressLike {
  percent?: number;
  bytesPerSecond?: number;
  transferred?: number;
  total?: number;
}

export class AppUpdateService {
  private readonly currentVersion: string;
  private readonly updater: AppUpdaterLike;
  private readonly platform: NodeJS.Platform;
  private readonly updateMetadataUrl?: string;
  private readonly now: () => Date;
  private readonly onStatus?: (state: AppUpdateState) => void;
  private state: AppUpdateState;

  constructor(options: AppUpdateServiceOptions) {
    this.currentVersion = options.currentVersion;
    this.updater = options.updater;
    this.platform = options.platform ?? process.platform;
    this.updateMetadataUrl = options.updateMetadataUrl;
    this.now = options.now ?? (() => new Date());
    this.onStatus = options.onStatus;
    this.state = this.createState('idle');
    this.attachUpdaterEvents();
  }

  getState(): AppUpdateState {
    return this.state;
  }

  async checkForUpdates(): Promise<AppUpdateState> {
    this.setState(this.createState('checking', this.windowsUpdatePatch('metadata')));
    try {
      await this.updater.checkForUpdates();
    } catch (error) {
      this.setState(this.createState('error', normalizeUpdateError(error)));
    }
    return this.state;
  }

  async downloadUpdate(): Promise<AppUpdateState> {
    this.setState(this.createState('downloading', this.windowsUpdatePatch('differential')));
    try {
      await this.updater.downloadUpdate();
    } catch (error) {
      this.setState(this.createState('error', { ...keepReleaseInfo(this.state), ...normalizeUpdateError(error) }));
    }
    return this.state;
  }

  installUpdate(): AppUpdateState {
    this.setState(this.createState('installing', keepReleaseInfo(this.state)));
    this.updater.quitAndInstall(false, true);
    return this.state;
  }

  private attachUpdaterEvents(): void {
    this.updater.on('update-available', (info) => {
      const update = normalizeUpdateInfo(info);
      this.setState(
        this.createState('available', {
          latestVersion: update.version,
          releaseName: update.releaseName,
          releaseNotes: update.releaseNotes,
          ...this.windowsUpdatePatch('differential')
        })
      );
    });
    this.updater.on('update-not-available', (info) => {
      const update = normalizeUpdateInfo(info);
      this.setState(this.createState('not-available', { latestVersion: update.version ?? this.currentVersion, ...this.windowsUpdatePatch('downloaded') }));
    });
    this.updater.on('download-progress', (progress) => {
      const value = normalizeDownloadProgress(progress);
      const fullPackagePatch = this.windowsFullPackagePatch(value);
      this.setState(
        this.createState('downloading', {
          ...keepReleaseInfo(this.state),
          ...this.windowsUpdatePatch(fullPackagePatch.fullPackage ? 'full-package' : 'differential'),
          ...fullPackagePatch.patch,
          percent: value.percent,
          bytesPerSecond: value.bytesPerSecond,
          transferred: value.transferred,
          total: value.total
        })
      );
    });
    this.updater.on('update-downloaded', (info) => {
      const update = normalizeUpdateInfo(info);
      this.setState(
        this.createState('downloaded', {
          ...keepReleaseInfo(this.state),
          latestVersion: update.version ?? this.state.latestVersion,
          ...this.windowsUpdatePatch('downloaded')
        })
      );
    });
    this.updater.on('error', (error) => {
      this.setState(this.createState('error', { ...keepReleaseInfo(this.state), ...normalizeUpdateError(error) }));
    });
  }

  private createState(status: AppUpdateState['status'], patch: Partial<AppUpdateState> = {}): AppUpdateState {
    return {
      status,
      currentVersion: this.currentVersion,
      updatedAt: this.now().toISOString(),
      ...patch
    };
  }

  private setState(state: AppUpdateState): void {
    this.state = state;
    this.onStatus?.(state);
  }

  private windowsUpdatePatch(stage: NonNullable<AppUpdateState['windowsUpdateStage']>): Partial<AppUpdateState> {
    if (this.platform !== 'win32') {
      return {};
    }
    return {
      windowsUpdateStage: stage,
      updateMetadataUrl: this.updateMetadataUrl,
      blockmapExpected: true
    };
  }

  private windowsFullPackagePatch(progress: DownloadProgressLike): { fullPackage: boolean; patch: Partial<AppUpdateState> } {
    if (this.platform !== 'win32') {
      return { fullPackage: false, patch: {} };
    }
    const total = progress.total;
    const fullPackage = typeof total === 'number' && total >= 50 * 1024 * 1024;
    return {
      fullPackage,
      patch: fullPackage
        ? {
            installerSizeBytes: total,
            differentialFallbackLikely: true,
            differentialFallbackReason: '本次下载量接近完整安装包，可能是 blockmap 不匹配、包体结构变化或差分块过多，electron-updater 已回退到完整包。'
          }
        : {
            installerSizeBytes: total,
            differentialFallbackLikely: false
          }
    };
  }
}

function normalizeUpdateInfo(value: unknown): { version?: string; releaseName?: string; releaseNotes?: string } {
  const info = (value ?? {}) as UpdateInfoLike;
  return {
    version: typeof info.version === 'string' ? info.version : undefined,
    releaseName: typeof info.releaseName === 'string' ? info.releaseName : undefined,
    releaseNotes: releaseNotesToText(info.releaseNotes)
  };
}

function normalizeDownloadProgress(value: unknown): DownloadProgressLike {
  const progress = (value ?? {}) as DownloadProgressLike;
  return {
    percent: numberOrUndefined(progress.percent),
    bytesPerSecond: numberOrUndefined(progress.bytesPerSecond),
    transferred: numberOrUndefined(progress.transferred),
    total: numberOrUndefined(progress.total)
  };
}

function releaseNotesToText(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === 'string' ? item : JSON.stringify(item)))
      .filter(Boolean)
      .join('\n');
  }
  return undefined;
}

function keepReleaseInfo(state: AppUpdateState): Partial<AppUpdateState> {
  return {
    latestVersion: state.latestVersion,
    releaseName: state.releaseName,
    releaseNotes: state.releaseNotes,
    releaseUrl: state.releaseUrl,
    downloadUrl: state.downloadUrl,
    windowsUpdateStage: state.windowsUpdateStage,
    updateMetadataUrl: state.updateMetadataUrl,
    blockmapExpected: state.blockmapExpected,
    installerSizeBytes: state.installerSizeBytes,
    differentialFallbackLikely: state.differentialFallbackLikely,
    differentialFallbackReason: state.differentialFallbackReason
  };
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readableError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function normalizeUpdateError(error: unknown): Pick<AppUpdateState, 'error' | 'errorCode'> {
  const message = readableError(error);
  if (isMacSignatureMismatchError(message)) {
    return {
      errorCode: 'mac-signature-mismatch',
      error: [
        '更新包签名不匹配。当前版本无法直接安装这个更新包，请安装新版签名包后再使用自动更新。',
        `原始错误：${message}`
      ].join('\n')
    };
  }
  return { errorCode: 'update-error', error: message };
}

function isMacSignatureMismatchError(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes('code failed to satisfy specified code requirement') ||
    (normalized.includes('code signature') && normalized.includes('did not pass validation'))
  );
}
