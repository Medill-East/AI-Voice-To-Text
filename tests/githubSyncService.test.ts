import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
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

  it('can include text-only history in the sync archive when the user enables it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'v2t-sync-history-'));
    const dataDir = join(root, 'data');
    const repoDir = join(root, 'repo');
    await UserDataStore.create(dataDir, { deviceId: 'device-a' });
    await writeFile(join(dataDir, 'history', 'device-a', '2026-04.jsonl'), '{"id":"history-a","outputText":"保留历史"}\n', 'utf8');

    const service = new GitHubSyncService({
      dataDir,
      repoDir,
      includeHistory: true,
      git: fakeGit()
    });

    await service.exportSyncFiles();

    expect(syncFileAllowlist(true)).toContain('history/');
    await expect(readFile(join(repoDir, 'history', 'device-a', '2026-04.jsonl'), 'utf8')).resolves.toContain('history-a');
    const ignore = await readFile(join(repoDir, '.gitignore'), 'utf8');
    expect(ignore).not.toContain('history/');
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
    const connected = await syncB.connect(remote);
    expect(connected.needsImportDecision).toBe(true);
    await syncB.resolveImport('remote-over-local');
    await syncB.pull();

    const imported = JSON.parse(await readFile(join(deviceB, 'lexicon.json'), 'utf8'));
    expect(imported.terms[0].phrase).toBe('V2T');
  });

  it('connects to an existing sync repo without importing remote prompts until a strategy is chosen', async () => {
    const root = await mkdtemp(join(tmpdir(), 'v2t-sync-connect-safe-'));
    const dataDir = join(root, 'data');
    const repoDir = join(root, 'repo');
    await UserDataStore.create(dataDir, { deviceId: 'device-a' });
    await mkdir(join(repoDir, '.git'), { recursive: true });
    await mkdir(join(repoDir, 'prompts'), { recursive: true });
    await writeFile(join(dataDir, 'prompts', 'structured.md'), 'local structured\n', 'utf8');
    await writeFile(join(repoDir, 'prompts', 'structured.md'), 'remote structured\n', 'utf8');

    const service = new GitHubSyncService({
      dataDir,
      repoDir,
      git: fakeGit()
    });

    const status = await service.connect('git@github.com:example/v2t-sync.git');

    expect(status.needsImportDecision).toBe(true);
    expect(status.remoteFiles).toContain('prompts/structured.md');
    await expect(readFile(join(dataDir, 'prompts', 'structured.md'), 'utf8')).resolves.toBe('local structured\n');
  });

  it('can resolve a sync import by importing remote files with local backups', async () => {
    const root = await mkdtemp(join(tmpdir(), 'v2t-sync-remote-import-'));
    const dataDir = join(root, 'data');
    const repoDir = join(root, 'repo');
    await UserDataStore.create(dataDir, { deviceId: 'device-a' });
    await mkdir(join(repoDir, '.git'), { recursive: true });
    await mkdir(join(repoDir, 'prompts'), { recursive: true });
    await writeFile(join(dataDir, 'prompts', 'structured.md'), 'local structured\n', 'utf8');
    await writeFile(join(repoDir, 'prompts', 'structured.md'), 'remote structured\n', 'utf8');
    const service = new GitHubSyncService({ dataDir, repoDir, git: fakeGit() });

    await service.resolveImport('remote-over-local');

    await expect(readFile(join(dataDir, 'prompts', 'structured.md'), 'utf8')).resolves.toBe('remote structured\n');
    expect((await service.listConflictBackups()).some((file) => file.includes('structured'))).toBe(true);
  });

  it('can resolve a sync import by keeping local prompts and backing up remote prompts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'v2t-sync-smart-prompts-'));
    const dataDir = join(root, 'data');
    const repoDir = join(root, 'repo');
    await UserDataStore.create(dataDir, { deviceId: 'device-a' });
    await mkdir(join(repoDir, '.git'), { recursive: true });
    await mkdir(join(repoDir, 'prompts'), { recursive: true });
    await writeFile(join(dataDir, 'prompts', 'structured.md'), 'local structured\n', 'utf8');
    await writeFile(join(repoDir, 'prompts', 'structured.md'), 'remote structured\n', 'utf8');
    const service = new GitHubSyncService({ dataDir, repoDir, git: fakeGit() });

    await service.resolveImport('smart-merge');

    await expect(readFile(join(dataDir, 'prompts', 'structured.md'), 'utf8')).resolves.toBe('local structured\n');
    expect((await service.listConflictBackups()).some((file) => file.includes('structured') && file.includes('remote'))).toBe(true);
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

  it('smart sync merges lexicon and history while backing up remote prompt conflicts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'v2t-sync-smart-'));
    const dataDir = join(root, 'data');
    const repoDir = join(root, 'repo');
    await UserDataStore.create(dataDir, { deviceId: 'device-a' });
    await mkdir(join(repoDir, '.git'), { recursive: true });
    await writeFile(join(dataDir, 'lexicon.json'), '{"version":1,"terms":[{"phrase":"local"}],"replacements":[],"blocked":["嗯"]}\n', 'utf8');
    await writeFile(join(dataDir, 'prompts', 'natural.md'), 'local prompt\n', 'utf8');
    await mkdir(join(dataDir, 'history', 'device-a'), { recursive: true });
    await writeFile(join(dataDir, 'history', 'device-a', '2026-04.jsonl'), '{"id":"local-history","createdAt":"2026-04-25T00:00:00.000Z"}\n', 'utf8');

    const remoteFiles = new Map<string, string>([
      ['lexicon.json', '{"version":1,"terms":[{"phrase":"remote"}],"replacements":[],"blocked":["呃"]}\n'],
      ['prompts/natural.md', 'remote prompt\n'],
      ['history/device-b/2026-04.jsonl', '{"id":"remote-history","createdAt":"2026-04-25T00:00:00.000Z"}\n']
    ]);
    const service = new GitHubSyncService({
      dataDir,
      repoDir,
      includeHistory: true,
      git: fakeRemoteGit(remoteFiles)
    });

    await service.smartSync();

    const lexicon = await readFile(join(dataDir, 'lexicon.json'), 'utf8');
    expect(lexicon).toContain('local');
    expect(lexicon).toContain('remote');
    expect(lexicon).toContain('嗯');
    expect(lexicon).toContain('呃');
    await expect(readFile(join(dataDir, 'history', 'device-b', '2026-04.jsonl'), 'utf8')).resolves.toContain('remote-history');
    await expect(readFile(join(repoDir, 'history', 'device-a', '2026-04.jsonl'), 'utf8')).resolves.toContain('local-history');
    expect(await readFile(join(dataDir, 'prompts', 'natural.md'), 'utf8')).toBe('local prompt\n');
    expect((await service.listConflictBackups()).some((file) => file.includes('natural'))).toBe(true);
  });
});

function fakeGit() {
  return async () => '';
}

function fakeRemoteGit(files: Map<string, string>) {
  return async (args: string[]) => {
    const command = args.join(' ');
    if (args[0] === 'rev-parse') {
      return 'origin/main\n';
    }
    if (args[0] === 'ls-tree') {
      return [...files.keys()].filter((file) => file.startsWith('history/')).join('\n');
    }
    if (args[0] === 'show') {
      const spec = args[1] ?? '';
      const file = spec.slice(spec.indexOf(':') + 1);
      if (!files.has(file)) {
        throw new Error(`missing ${file}`);
      }
      return files.get(file) ?? '';
    }
    if (command.startsWith('status --porcelain')) {
      return ' M lexicon.json\n';
    }
    return '';
  };
}
