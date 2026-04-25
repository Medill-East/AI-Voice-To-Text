import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, parse } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { GitHubSyncStatus } from './types';

const execFileAsync = promisify(execFile);

type GitRunner = (args: string[], cwd?: string) => Promise<string>;

interface GitHubSyncServiceOptions {
  dataDir: string;
  repoDir: string;
  branch?: string;
  repoUrl?: string;
  git?: GitRunner;
}

export class GitHubSyncService {
  private readonly dataDir: string;
  private readonly repoDir: string;
  private readonly branch: string;
  private repoUrl?: string;
  private readonly git: GitRunner;

  constructor(options: GitHubSyncServiceOptions) {
    this.dataDir = options.dataDir;
    this.repoDir = options.repoDir;
    this.branch = options.branch ?? 'main';
    this.repoUrl = options.repoUrl;
    this.git = options.git ?? runGit;
  }

  async connect(repoUrl: string): Promise<GitHubSyncStatus> {
    validateGitRepoUrl(repoUrl);
    this.repoUrl = repoUrl;

    if (!existsSync(join(this.repoDir, '.git'))) {
      await rm(this.repoDir, { recursive: true, force: true });
      await mkdir(dirname(this.repoDir), { recursive: true });
      await this.git(['clone', repoUrl, this.repoDir]);
      await this.ensureBranch();
    } else {
      await this.git(['remote', 'set-url', 'origin', repoUrl], this.repoDir);
    }

    if (await this.repoHasSyncFiles()) {
      await this.importSyncFiles();
    } else {
      await this.exportSyncFiles();
    }
    return this.status();
  }

  async pull(): Promise<GitHubSyncStatus> {
    await this.ensureRepo();
    await this.git(['pull', '--ff-only', 'origin', this.branch], this.repoDir);
    await this.importSyncFiles();
    return this.status('已拉取同步');
  }

  async push(message = 'sync: update v2t settings'): Promise<GitHubSyncStatus> {
    await this.ensureRepo();
    await this.exportSyncFiles();
    await this.git(['add', ...syncFileAllowlist(), '.gitignore'], this.repoDir);
    const dirty = await this.isDirty();
    if (dirty) {
      await this.git(['commit', '-m', message], this.repoDir);
    }
    await this.git(['push', '-u', 'origin', this.branch], this.repoDir);
    return this.status('已推送同步');
  }

  async status(message?: string): Promise<GitHubSyncStatus> {
    const dirty = existsSync(join(this.repoDir, '.git')) ? await this.isDirty() : false;
    return {
      configured: Boolean(this.repoUrl || existsSync(join(this.repoDir, '.git'))),
      repoUrl: this.repoUrl,
      localPath: this.repoDir,
      branch: this.branch,
      dirty,
      message
    };
  }

  async exportSyncFiles(): Promise<void> {
    await mkdir(this.repoDir, { recursive: true });
    await this.writeRepoIgnore();

    for (const relativePath of syncFileAllowlist()) {
      const source = join(this.dataDir, relativePath);
      const target = join(this.repoDir, relativePath);
      if (!existsSync(source)) {
        continue;
      }
      await mkdir(dirname(target), { recursive: true });
      if (relativePath === 'settings.json') {
        await writePortableSettings(source, target);
      } else {
        await copyFile(source, target);
      }
    }
  }

  async importSyncFiles(): Promise<void> {
    for (const relativePath of syncFileAllowlist()) {
      const source = join(this.repoDir, relativePath);
      const target = join(this.dataDir, relativePath);
      if (!existsSync(source)) {
        continue;
      }

      const incoming = await readFile(source, 'utf8');
      await backupIfChanged(target, this.dataDir, incoming);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, incoming, 'utf8');
    }
  }

  async listConflictBackups(): Promise<string[]> {
    const conflictsDir = join(this.dataDir, 'conflicts');
    if (!existsSync(conflictsDir)) {
      return [];
    }
    return readdir(conflictsDir);
  }

  private async ensureRepo(): Promise<void> {
    if (!existsSync(join(this.repoDir, '.git'))) {
      if (!this.repoUrl) {
        throw new Error('尚未连接 GitHub 同步仓库');
      }
      await this.connect(this.repoUrl);
    }
  }

  private async ensureBranch(): Promise<void> {
    try {
      await this.git(['checkout', this.branch], this.repoDir);
    } catch {
      await this.git(['checkout', '-b', this.branch], this.repoDir);
    }
  }

  private async isDirty(): Promise<boolean> {
    const output = await this.git(['status', '--porcelain'], this.repoDir);
    return output.trim().length > 0;
  }

  private async writeRepoIgnore(): Promise<void> {
    await writeFile(join(this.repoDir, '.gitignore'), ['history/', 'models/', '*.log', '.env', '.env.*', ''].join('\n'), 'utf8');
  }

  private async repoHasSyncFiles(): Promise<boolean> {
    return syncFileAllowlist().some((relativePath) => existsSync(join(this.repoDir, relativePath)));
  }
}

export function syncFileAllowlist(): string[] {
  return ['settings.json', 'lexicon.json', 'prompts/natural.md', 'prompts/structured.md'];
}

export function validateGitRepoUrl(repoUrl: string): void {
  const trimmed = repoUrl.trim();
  if (!trimmed) {
    throw new Error('请填写 GitHub 仓库 URL');
  }

  const isSsh = /^git@github\.com:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\.git$/.test(trimmed);
  const isHttps = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/.test(trimmed);
  const isLocalPath = trimmed.startsWith('/') || trimmed.startsWith('file://');

  if (!isSsh && !isHttps && !isLocalPath) {
    throw new Error('GitHub 仓库 URL 格式不正确');
  }
}

async function writePortableSettings(source: string, target: string): Promise<void> {
  const settings = JSON.parse(await readFile(source, 'utf8')) as {
    dataDir?: string;
    sync?: {
      github?: {
        localPath?: string;
        lastSyncAt?: string;
      };
    };
  };
  delete settings.dataDir;
  delete settings.sync?.github?.localPath;
  delete settings.sync?.github?.lastSyncAt;
  await writeFile(target, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
}

async function backupIfChanged(filePath: string, dataDir: string, incoming: string): Promise<void> {
  if (!existsSync(filePath)) {
    return;
  }

  const current = await readFile(filePath, 'utf8');
  if (current === incoming) {
    return;
  }

  const parsed = parse(filePath);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const conflictsDir = join(dataDir, 'conflicts');
  await mkdir(conflictsDir, { recursive: true });
  await writeFile(join(conflictsDir, `${parsed.name}.${stamp}.conflict${parsed.ext}`), current, 'utf8');
}

async function runGit(args: string[], cwd?: string): Promise<string> {
  const { stdout } = await execFileAsync('git', args, cwd ? { cwd } : undefined);
  return String(stdout);
}
