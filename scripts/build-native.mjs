import { spawnSync } from 'node:child_process';

const script =
  process.platform === 'darwin'
    ? 'scripts/build-mac-key-server.mjs'
    : process.platform === 'win32'
      ? 'scripts/build-windows-key-listener.mjs'
      : undefined;

if (!script) {
  process.exit(0);
}

const result = spawnSync(process.execPath, [script], {
  cwd: process.cwd(),
  stdio: 'inherit'
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 0);
