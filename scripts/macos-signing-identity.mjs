import { spawnSync } from 'node:child_process';

export function resolveMacSigningIdentity(env = process.env, run = spawnSync) {
  if (env.V2T_CODESIGN_IDENTITY) {
    return env.V2T_CODESIGN_IDENTITY;
  }
  if (env.CSC_NAME) {
    return env.CSC_NAME;
  }

  const identities = run('security', ['find-identity', '-v', '-p', 'codesigning'], {
    encoding: 'utf8'
  });
  if (identities.status !== 0 || !identities.stdout) {
    return undefined;
  }

  return parseSigningIdentities(identities.stdout)[0]?.hash;
}

export function parseSigningIdentities(output) {
  const identities = [];
  const pattern = /^\s*\d+\)\s+([A-Fa-f0-9]{40})\s+"([^"]+)"/gm;
  let match;
  while ((match = pattern.exec(output)) !== null) {
    identities.push({ hash: match[1], name: match[2] });
  }
  return identities;
}
