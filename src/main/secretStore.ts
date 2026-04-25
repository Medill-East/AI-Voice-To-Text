import { app, safeStorage } from 'electron';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export class SecretStore {
  private readonly filePath: string;

  constructor(namespace = 'v2t') {
    this.filePath = join(app.getPath('userData'), 'secrets', `${namespace}.bin`);
  }

  async getOpenAICompatibleKey(): Promise<string | undefined> {
    if (!existsSync(this.filePath)) {
      return undefined;
    }

    const encrypted = await readFile(this.filePath);
    if (!safeStorage.isEncryptionAvailable()) {
      return encrypted.toString('utf8');
    }

    return safeStorage.decryptString(encrypted);
  }

  async setOpenAICompatibleKey(value: string): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const payload = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(value) : Buffer.from(value, 'utf8');
    await writeFile(this.filePath, payload);
  }
}
