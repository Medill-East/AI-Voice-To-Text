import { existsSync } from 'node:fs';
import { readdir, rm, stat } from 'node:fs/promises';
import { basename, join, relative } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const packageJson = require('../package.json');

const root = process.cwd();
const releaseDir = join(root, 'release');
const currentMacDmg = `V2T-${packageJson.version}-mac-arm64.dmg`;
const keepTopLevel = new Set([currentMacDmg, 'mac-arm64']);
const dryRun = process.argv.includes('--dry-run');

if (!existsSync(releaseDir)) {
  console.log('release/ does not exist; nothing to clean.');
  process.exit(0);
}

const entries = await readdir(releaseDir);
const removed = [];

for (const entry of entries) {
  if (keepTopLevel.has(entry)) {
    continue;
  }

  const fullPath = join(releaseDir, entry);
  const info = await stat(fullPath);
  removed.push(`${relative(root, fullPath)}${info.isDirectory() ? '/' : ''}`);
  if (!dryRun) {
    await rm(fullPath, { recursive: true, force: true });
  }
}

const macDir = join(releaseDir, 'mac-arm64');
if (existsSync(macDir)) {
  for (const entry of await readdir(macDir)) {
    if (entry === 'V2T.app') {
      continue;
    }
    const fullPath = join(macDir, entry);
    removed.push(relative(root, fullPath));
    if (!dryRun) {
      await rm(fullPath, { recursive: true, force: true });
    }
  }
}

const action = dryRun ? 'Would remove' : 'Removed';
if (removed.length === 0) {
  console.log(`Local release folder is already clean. Kept ${currentMacDmg} and release/mac-arm64/V2T.app.`);
} else {
  console.log(`${action} ${removed.length} local release artifact(s):`);
  for (const item of removed) {
    console.log(`- ${item}`);
  }
  console.log(`Kept ${currentMacDmg} and release/mac-arm64/V2T.app.`);
}
