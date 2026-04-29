import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { resolveMacSigningIdentity } from './macos-signing-identity.mjs';

if (process.platform !== 'darwin') {
  process.exit(0);
}

const source = join(process.cwd(), 'native', 'MacKeyServer', 'main.swift');
const outputDir = join(process.cwd(), 'dist', 'native');
const output = join(outputDir, 'MacKeyServer');

await mkdir(outputDir, { recursive: true });

const result = spawnSync('swiftc', [source, '-O', '-o', output], {
  cwd: process.cwd(),
  stdio: 'inherit'
});

if (result.error) {
  throw result.error;
}

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

const identity = resolveMacSigningIdentity();
if (identity) {
  const sign = spawnSync('codesign', ['--force', '--sign', identity, output], {
    cwd: process.cwd(),
    stdio: 'inherit'
  });
  if (sign.error) {
    throw sign.error;
  }
  if (sign.status !== 0) {
    process.exit(sign.status ?? 1);
  }
}
