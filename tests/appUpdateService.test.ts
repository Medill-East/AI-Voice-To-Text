import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { AppUpdateService } from '../src/core/appUpdateService';
import type { AppUpdateState } from '../src/core/types';

class FakeUpdater extends EventEmitter {
  autoDownload = true;
  checkForUpdates = vi.fn(async () => undefined);
  downloadUpdate = vi.fn(async () => undefined);
  quitAndInstall = vi.fn();
}

describe('AppUpdateService', () => {
  it('reports update availability, download progress, and downloaded state', async () => {
    const updater = new FakeUpdater();
    const states: AppUpdateState[] = [];
    const service = new AppUpdateService({
      currentVersion: '0.1.12',
      updater,
      now: () => new Date('2026-04-26T08:00:00.000Z'),
      onStatus: (state) => states.push(state)
    });

    await service.checkForUpdates();
    updater.emit('update-available', { version: '0.1.13', releaseName: 'V2T 0.1.13', releaseNotes: 'Fixes' });
    updater.emit('download-progress', { percent: 25, bytesPerSecond: 1024, transferred: 2048, total: 8192 });
    updater.emit('update-downloaded', { version: '0.1.13' });

    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(states.map((state) => state.status)).toEqual(['checking', 'available', 'downloading', 'downloaded']);
    expect(states[1]).toMatchObject({ latestVersion: '0.1.13', releaseName: 'V2T 0.1.13' });
    expect(states[2]).toMatchObject({ percent: 25, bytesPerSecond: 1024, transferred: 2048, total: 8192 });
  });

  it('labels Windows full-installer fallback when NSIS update download is large', async () => {
    const updater = new FakeUpdater();
    const states: AppUpdateState[] = [];
    const service = new AppUpdateService({
      currentVersion: '0.1.40',
      updater,
      platform: 'win32',
      updateMetadataUrl: 'https://github.com/Medill-East/AI-Voice-To-Text/releases/latest/download/latest.yml',
      now: () => new Date('2026-04-30T08:00:00.000Z'),
      onStatus: (state) => states.push(state)
    });

    await service.checkForUpdates();
    updater.emit('update-available', { version: '0.1.41' });
    updater.emit('download-progress', { percent: 3, transferred: 1_200_000, total: 99 * 1024 * 1024 });

    expect(states.map((state) => state.windowsUpdateStage)).toEqual(['metadata', 'differential', 'full-package']);
    expect(states.at(-1)).toMatchObject({
      status: 'downloading',
      blockmapExpected: true,
      installerSizeBytes: 99 * 1024 * 1024,
      differentialFallbackLikely: true,
      updateMetadataUrl: 'https://github.com/Medill-East/AI-Voice-To-Text/releases/latest/download/latest.yml'
    });
    expect(states.at(-1)?.differentialFallbackReason).toContain('完整包');
  });

  it('keeps a readable error when update checks fail', async () => {
    const updater = new FakeUpdater();
    updater.checkForUpdates.mockRejectedValue(new Error('network 404'));
    const states: AppUpdateState[] = [];
    const service = new AppUpdateService({
      currentVersion: '0.1.12',
      updater,
      now: () => new Date('2026-04-26T08:00:00.000Z'),
      onStatus: (state) => states.push(state)
    });

    await service.checkForUpdates();

    expect(states.at(-1)).toMatchObject({ status: 'error', error: 'network 404' });
  });

  it('turns macOS ShipIt signature validation failures into a user-facing recovery message', () => {
    const updater = new FakeUpdater();
    const states: AppUpdateState[] = [];
    new AppUpdateService({
      currentVersion: '0.1.14',
      updater,
      now: () => new Date('2026-04-26T08:00:00.000Z'),
      onStatus: (state) => states.push(state)
    });

    updater.emit(
      'error',
      new Error(
        'Code signature at URL file:///Users/haodong/Library/Caches/com.haodong.v2t.ShipIt/update.tgaP0t3/V2T.app/ did not pass validation: code failed to satisfy specified code requirement(s)'
      )
    );

    expect(states.at(-1)).toMatchObject({
      status: 'error',
      errorCode: 'mac-signature-mismatch'
    });
    expect(states.at(-1)?.error).toContain('更新包签名不匹配');
    expect(states.at(-1)?.error).toContain('新版签名包');
  });

  it('can start download and request install', async () => {
    const updater = new FakeUpdater();
    const service = new AppUpdateService({
      currentVersion: '0.1.12',
      updater,
      now: () => new Date('2026-04-26T08:00:00.000Z')
    });

    await service.downloadUpdate();
    service.installUpdate();

    expect(updater.downloadUpdate).toHaveBeenCalledTimes(1);
    expect(updater.quitAndInstall).toHaveBeenCalledWith(false, true);
    expect(service.getState().status).toBe('installing');
  });
});
