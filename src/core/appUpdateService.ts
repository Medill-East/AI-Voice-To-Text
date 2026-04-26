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
  private readonly now: () => Date;
  private readonly onStatus?: (state: AppUpdateState) => void;
  private state: AppUpdateState;

  constructor(options: AppUpdateServiceOptions) {
    this.currentVersion = options.currentVersion;
    this.updater = options.updater;
    this.now = options.now ?? (() => new Date());
    this.onStatus = options.onStatus;
    this.state = this.createState('idle');
    this.attachUpdaterEvents();
  }

  getState(): AppUpdateState {
    return this.state;
  }

  async checkForUpdates(): Promise<AppUpdateState> {
    this.setState(this.createState('checking'));
    try {
      await this.updater.checkForUpdates();
    } catch (error) {
      this.setState(this.createState('error', { error: readableError(error) }));
    }
    return this.state;
  }

  async downloadUpdate(): Promise<AppUpdateState> {
    this.setState(this.createState('downloading'));
    try {
      await this.updater.downloadUpdate();
    } catch (error) {
      this.setState(this.createState('error', { error: readableError(error) }));
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
          releaseNotes: update.releaseNotes
        })
      );
    });
    this.updater.on('update-not-available', (info) => {
      const update = normalizeUpdateInfo(info);
      this.setState(this.createState('not-available', { latestVersion: update.version ?? this.currentVersion }));
    });
    this.updater.on('download-progress', (progress) => {
      const value = normalizeDownloadProgress(progress);
      this.setState(
        this.createState('downloading', {
          ...keepReleaseInfo(this.state),
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
          latestVersion: update.version ?? this.state.latestVersion
        })
      );
    });
    this.updater.on('error', (error) => {
      this.setState(this.createState('error', { ...keepReleaseInfo(this.state), error: readableError(error) }));
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
    releaseNotes: state.releaseNotes
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
