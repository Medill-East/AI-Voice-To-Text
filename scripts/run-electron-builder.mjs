import { spawnSync } from 'node:child_process';
import { resolveMacSigningIdentity } from './macos-signing-identity.mjs';

const builderArgs = process.argv.slice(2);
if (!builderArgs.some((arg) => arg.startsWith('--publish'))) {
  builderArgs.unshift('--publish=never');
}

if (process.platform === 'darwin' && !builderArgs.some((arg) => arg.startsWith('-c.mac.identity='))) {
  const identity = resolveMacSigningIdentity();
  if (identity) {
    builderArgs.push(`-c.mac.identity=${identity}`);
  }
}

const result = spawnSync('electron-builder', builderArgs, {
  cwd: process.cwd(),
  env: process.env,
  stdio: 'inherit'
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 0);
