import { execSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

function gitCommit() {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return process.env.V2T_BUILD_COMMIT ?? 'local';
  }
}

const outputDir = join(process.cwd(), 'dist');
await mkdir(outputDir, { recursive: true });
await writeFile(
  join(outputDir, 'build-info.json'),
  `${JSON.stringify(
    {
      version: packageJson.version,
      buildCommit: process.env.V2T_BUILD_COMMIT ?? gitCommit(),
      builtAt: new Date().toISOString()
    },
    null,
    2
  )}\n`,
  'utf8'
);
