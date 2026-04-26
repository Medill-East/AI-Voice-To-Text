import { describe, expect, it, vi } from 'vitest';
import { checkManualMacUpdate, macDownloadUrlFromState } from '../src/core/manualAppUpdate';

describe('manual macOS app update checks', () => {
  it('reads the latest GitHub release and selects the DMG asset', async () => {
    const fetchRelease = vi.fn(async () => ({
      tag_name: 'v0.1.17-abcd123',
      name: 'V2T v0.1.17',
      html_url: 'https://github.com/Medill-East/AI-Voice-To-Text/releases/tag/v0.1.17-abcd123',
      body: 'Fixes',
      assets: [
        { name: 'V2T-0.1.17-mac-arm64.zip', browser_download_url: 'https://example.com/V2T.zip' },
        { name: 'V2T-0.1.17-mac-arm64.dmg', browser_download_url: 'https://example.com/V2T.dmg' }
      ]
    }));

    const state = await checkManualMacUpdate({
      currentVersion: '0.1.16',
      fetchRelease,
      now: () => new Date('2026-04-26T10:00:00.000Z')
    });

    expect(fetchRelease).toHaveBeenCalledTimes(1);
    expect(state).toMatchObject({
      status: 'available',
      latestVersion: '0.1.17',
      releaseName: 'V2T v0.1.17',
      releaseUrl: 'https://github.com/Medill-East/AI-Voice-To-Text/releases/tag/v0.1.17-abcd123',
      downloadUrl: 'https://example.com/V2T.dmg'
    });
    expect(macDownloadUrlFromState(state, 'https://fallback.example.com')).toBe('https://example.com/V2T.dmg');
  });

  it('falls back to the release page when a newer release has no DMG asset', async () => {
    const fetchRelease = vi.fn(async () => ({
      tag_name: 'v0.1.17-abcd123',
      html_url: 'https://github.com/Medill-East/AI-Voice-To-Text/releases/tag/v0.1.17-abcd123',
      assets: [{ name: 'V2T-0.1.17-mac-arm64.zip', browser_download_url: 'https://example.com/V2T.zip' }]
    }));

    const state = await checkManualMacUpdate({
      currentVersion: '0.1.16',
      fetchRelease,
      now: () => new Date('2026-04-26T10:00:00.000Z')
    });

    expect(state.status).toBe('available');
    expect(state.downloadUrl).toBeUndefined();
    expect(macDownloadUrlFromState(state, 'https://fallback.example.com')).toBe(
      'https://github.com/Medill-East/AI-Voice-To-Text/releases/tag/v0.1.17-abcd123'
    );
  });

  it('reports not available when the latest release version is current', async () => {
    const state = await checkManualMacUpdate({
      currentVersion: '0.1.16',
      fetchRelease: async () => ({
        tag_name: 'v0.1.16-c9d7346',
        html_url: 'https://github.com/Medill-East/AI-Voice-To-Text/releases/tag/v0.1.16-c9d7346',
        assets: []
      }),
      now: () => new Date('2026-04-26T10:00:00.000Z')
    });

    expect(state).toMatchObject({
      status: 'not-available',
      latestVersion: '0.1.16'
    });
  });
});
