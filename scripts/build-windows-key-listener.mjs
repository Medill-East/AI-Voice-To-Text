import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

if (process.platform !== 'win32') {
  process.exit(0);
}

const root = process.cwd();
const outputDir = join(root, 'dist', 'native');

await mkdir(outputDir, { recursive: true });

await buildWindowsNative({
  manifestPath: join(root, 'native', 'windows-key-listener', 'Cargo.toml'),
  cargoOutput: join(root, 'native', 'windows-key-listener', 'target', 'release', 'v2t_keyboard_listener.exe'),
  appOutput: join(outputDir, 'V2TKeyboardListener.exe')
});

await buildWindowsNative({
  manifestPath: join(root, 'native', 'windows-audio-control', 'Cargo.toml'),
  cargoOutput: join(root, 'native', 'windows-audio-control', 'target', 'release', 'v2t_audio_control.exe'),
  appOutput: join(outputDir, 'V2TAudioControl.exe')
});

async function buildWindowsNative({ manifestPath, cargoOutput, appOutput }) {
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

  await copyFile(cargoOutput, appOutput);

  const hash = createHash('sha256').update(await readFile(appOutput)).digest('hex');
  console.log(`${appOutput.split(/[\\/]/).pop()} sha256=${hash}`);
}
