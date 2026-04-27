import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

if (process.platform !== 'win32') {
  process.exit(0);
}

const releaseDir = join(process.cwd(), 'release');
const files = await listFiles(releaseDir);
const legacy = files.filter((file) => file.endsWith('WinKeyServer.exe'));
if (legacy.length > 0) {
  throw new Error(`Windows release still contains WinKeyServer.exe:\n${legacy.join('\n')}`);
}

const listener = files.find((file) => file.endsWith('V2TKeyboardListener.exe'));
if (!listener) {
  throw new Error('Windows release is missing V2TKeyboardListener.exe');
}

const audioControl = files.find((file) => file.endsWith('V2TAudioControl.exe'));
if (!audioControl) {
  throw new Error('Windows release is missing V2TAudioControl.exe');
}

for (const file of [listener, audioControl]) {
  const hash = createHash('sha256').update(await readFile(file)).digest('hex');
  console.log(`Verified ${file.split(/[\\/]/).pop()} sha256=${hash}`);
}

async function listFiles(root) {
  const result = [];
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const absolute = join(root, entry.name);
    if (entry.isDirectory()) {
      result.push(...(await listFiles(absolute)));
    } else {
      result.push(absolute);
    }
  }
  return result;
}
