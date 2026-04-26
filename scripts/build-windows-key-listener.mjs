import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

if (process.platform !== 'win32') {
  process.exit(0);
}

const root = process.cwd();
const manifestPath = join(root, 'native', 'windows-key-listener', 'Cargo.toml');
const outputDir = join(root, 'dist', 'native');
const cargoOutput = join(root, 'native', 'windows-key-listener', 'target', 'release', 'v2t_keyboard_listener.exe');
const appOutput = join(outputDir, 'V2TKeyboardListener.exe');

const build = spawnSync('cargo', ['build', '--manifest-path', manifestPath, '--release'], {
  cwd: root,
  stdio: 'inherit'
});

if (build.error) {
  throw build.error;
}

if (build.status !== 0) {
  process.exit(build.status ?? 1);
}

await mkdir(outputDir, { recursive: true });
await copyFile(cargoOutput, appOutput);

const hash = createHash('sha256').update(await readFile(appOutput)).digest('hex');
console.log(`V2TKeyboardListener.exe sha256=${hash}`);
