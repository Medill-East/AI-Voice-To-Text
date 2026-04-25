import { chmod, stat } from 'node:fs/promises';
import { join } from 'node:path';

if (process.platform === 'darwin') {
  const binaryPath = join(process.cwd(), 'node_modules', 'node-global-key-listener', 'bin', 'MacKeyServer');

  try {
    const current = await stat(binaryPath);
    await chmod(binaryPath, current.mode | 0o111);
  } catch {
    // The dependency may not be installed on every package-manager operation.
  }
}
