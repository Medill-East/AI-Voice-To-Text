import { execFile } from 'node:child_process';
import { platform } from 'node:os';
import { promisify } from 'node:util';
import type { PasteKeySender } from '../core/textInjection';

const execFileAsync = promisify(execFile);

export class OsPasteKeySender implements PasteKeySender {
  async paste(): Promise<void> {
    const currentPlatform = platform();

    if (currentPlatform === 'darwin') {
      await execFileAsync('osascript', ['-e', 'tell application "System Events" to keystroke "v" using command down']);
      return;
    }

    if (currentPlatform === 'win32') {
      await execFileAsync('powershell.exe', [
        '-NoProfile',
        '-Command',
        "$shell = New-Object -ComObject WScript.Shell; $shell.SendKeys('^v')"
      ]);
      return;
    }

    throw new Error(`Paste injection is not supported on ${currentPlatform}`);
  }
}
