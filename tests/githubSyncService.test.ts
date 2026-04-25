import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { GitHubSyncService, syncFileAllowlist } from '../src/core/githubSyncService';
import { UserDataStore } from '../src/core/userDataStore';

const execFileAsync = promisify(execFile);

describe('GitHubSyncService', () => {
  it('syncs only settings, lexicon, and prompts into the git repo', async () => {
    const root = await mkdtemp(join(tmpdir(), 'v2t-sync-'));
    const dataDir = join(root, 'data');
    const repoDir = join(root, 'repo');
    const store = await UserDataStore.create(dataDir, { deviceId: 'device-a' });
    const settings = await store.loadSettings();
    await store.saveSettings({
      ...settings,
      dataDir: '/local-only',
      sync: {
        kind: 'github',
        github: {
          repoUrl: 'git@github.com:example/v2t-sync.git',
          localPath: '/local/repo',
          branch: 'main',
          lastSyncAt: '2026-04-25T00:00:00.000Z'
        }
      }
    });
    await writeFile(join(dataDir, 'history', 'device-a', '2026-04.jsonl'), '{"secret":"history"}\n', 'utf8');

    const service = new GitHubSyncService({
      dataDir,
      repoDir,
      git: fakeGit()
    });

    await service.exportSyncFiles();

    expect(syncFileAllowlist()).toEqual([
      'settings.json',
      'lexicon.json',
      'prompts/natural.md',
      'prompts/structured.md'
    ]);
    const exportedSettings = JSON.parse(await readFile(join(repoDir, 'settings.json'), 'utf8'));
    expect(exportedSettings.defaultMode).toBe('natural');
    expect(exportedSettings.dataDir).toBeUndefined();
    expect(exportedSettings.sync.github.repoUrl).toBe('git@github.com:example/v2t-sync.git');
    expect(exportedSettings.sync.github.localPath).toBeUndefined();
    expect(exportedSettings.sync.github.lastSyncAt).toBeUndefined();
    await expect(readFile(join(repoDir, 'lexicon.json'), 'utf8')).resolves.toContain('"terms"');
    await expect(readFile(join(repoDir, 'prompts', 'natural.md'), 'utf8')).resolves.toContain('保守');
    await expect(readFile(join(repoDir, 'history', 'device-a', '2026-04.jsonl'), 'utf8')).rejects.toThrow();

    const ignore = await readFile(join(repoDir, '.gitignore'), 'utf8');
    expect(ignore).toContain('history/');
    expect(ignore).toContain('models/');
    expect(ignore).toContain('.env');
  });

  it('pushes sync files to a bare repo and another device can pull them', async () => {
    const root = await mkdtemp(join(tmpdir(), 'v2t-sync-git-'));
    const remote = join(root, 'remote.git');
    await execFileAsync('git', ['init', '--bare', remote]);

    const deviceA = join(root, 'device-a');
    const deviceB = join(root, 'device-b');
    const repoA = join(root, 'repo-a');
    const repoB = join(root, 'repo-b');
    const storeA = await UserDataStore.create(deviceA, { deviceId: 'device-a' });
    await UserDataStore.create(deviceB, { deviceId: 'device-b' });
    const lexicon = await storeA.loadLexicon();
    await storeA.saveLexicon({
      ...lexicon,
      terms: [{ phrase: 'V2T', aliases: ['v to t'] }],
      replacements: [],
      blocked: []
    });

    const syncA = new GitHubSyncService({ dataDir: deviceA, repoDir: repoA });
    await syncA.connect(remote);
    await syncA.push('sync: update v2t settings');

    const syncB = new GitHubSyncService({ dataDir: deviceB, repoDir: repoB });
    await syncB.connect(remote);
    await syncB.pull();

    const imported = JSON.parse(await readFile(join(deviceB, 'lexicon.json'), 'utf8'));
    expect(imported.terms[0].phrase).toBe('V2T');
  });

  it('creates a conflict backup before importing pulled files over local changes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'v2t-sync-conflict-'));
    const dataDir = join(root, 'data');
    const repoDir = join(root, 'repo');
    await UserDataStore.create(dataDir, { deviceId: 'device-a' });
    await UserDataStore.create(repoDir, { deviceId: 'repo' });
    await writeFile(join(dataDir, 'lexicon.json'), '{"version":1,"terms":[{"phrase":"local"}],"replacements":[],"blocked":[]}\n', 'utf8');
    await writeFile(join(repoDir, 'lexicon.json'), '{"version":1,"terms":[{"phrase":"remote"}],"replacements":[],"blocked":[]}\n', 'utf8');

    const service = new GitHubSyncService({
      dataDir,
      repoDir,
      git: fakeGit()
    });

    await service.importSyncFiles();

    const imported = await readFile(join(dataDir, 'lexicon.json'), 'utf8');
    expect(imported).toContain('remote');

    const conflicts = await service.listConflictBackups();
    expect(conflicts.some((file) => file.includes('lexicon'))).toBe(true);
  });
});

function fakeGit() {
  return async () => '';
}
