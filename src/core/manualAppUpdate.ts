import type { AppUpdateState } from './types';

export interface GitHubReleaseAsset {
  name?: string;
  browser_download_url?: string;
}

export interface GitHubReleaseLike {
  tag_name?: string;
  name?: string;
  html_url?: string;
  body?: string;
  assets?: GitHubReleaseAsset[];
}

interface ManualMacUpdateOptions {
  currentVersion: string;
  fetchRelease: () => Promise<GitHubReleaseLike>;
  now?: () => Date;
}

export async function checkManualMacUpdate(options: ManualMacUpdateOptions): Promise<AppUpdateState> {
  const now = options.now ?? (() => new Date());
  try {
    const release = await options.fetchRelease();
    const latestVersion = versionFromRelease(release) ?? options.currentVersion;
    const common = {
      currentVersion: options.currentVersion,
      latestVersion,
      releaseName: release.name,
      releaseNotes: release.body,
      releaseUrl: release.html_url,
      downloadUrl: selectDmgAsset(release.assets)?.browser_download_url,
      updatedAt: now().toISOString()
    };

    if (compareVersions(latestVersion, options.currentVersion) > 0) {
      return { ...common, status: 'available' };
    }
    return { ...common, status: 'not-available' };
  } catch (error) {
    return {
      status: 'error',
      currentVersion: options.currentVersion,
      updatedAt: now().toISOString(),
      errorCode: 'update-error',
      error: readableError(error)
    };
  }
}

export function macDownloadUrlFromState(state: AppUpdateState, fallbackUrl: string): string {
  return state.downloadUrl ?? state.releaseUrl ?? fallbackUrl;
}

function selectDmgAsset(assets: GitHubReleaseAsset[] | undefined): GitHubReleaseAsset | undefined {
  return assets?.find((asset) => typeof asset.name === 'string' && asset.name.toLowerCase().endsWith('.dmg'));
}

function versionFromRelease(release: GitHubReleaseLike): string | undefined {
  const candidates = [release.tag_name, release.name].filter((value): value is string => typeof value === 'string');
  for (const candidate of candidates) {
    const match = candidate.match(/v?(\d+\.\d+\.\d+)/);
    if (match?.[1]) {
      return match[1];
    }
  }
  return undefined;
}

function compareVersions(left: string, right: string): number {
  const leftParts = versionParts(left);
  const rightParts = versionParts(right);
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const diff = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}

function versionParts(version: string): number[] {
  return version
    .split('.')
    .map((part) => Number.parseInt(part, 10))
    .map((part) => (Number.isFinite(part) ? part : 0));
}

function readableError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
