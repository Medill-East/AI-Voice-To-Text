import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface HotkeyDiagnosticEvent {
  type: string;
  helperPath?: string;
  signature?: string;
  stderr?: string;
  exitCode?: number | null;
  accelerator?: string;
  message?: string;
  at?: string;
}

export class HotkeyDiagnosticLog {
  constructor(private readonly logPath: string) {}

  getPath(): string {
    return this.logPath;
  }

  async write(event: HotkeyDiagnosticEvent): Promise<void> {
    await mkdir(dirname(this.logPath), { recursive: true });
    const record = {
      at: new Date().toISOString(),
      ...event
    };
    await appendFile(this.logPath, `${JSON.stringify(record)}\n`, 'utf8');
  }
}
