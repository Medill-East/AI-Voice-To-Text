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
        [
          'Add-Type -Namespace V2T -Name Keyboard -MemberDefinition \'[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, int dwFlags, UIntPtr dwExtraInfo);\'',
          '[V2T.Keyboard]::keybd_event(0xA2, 0, 0, [UIntPtr]::Zero)',
          '[V2T.Keyboard]::keybd_event(0x56, 0, 0, [UIntPtr]::Zero)',
          '[V2T.Keyboard]::keybd_event(0x56, 0, 2, [UIntPtr]::Zero)',
          '[V2T.Keyboard]::keybd_event(0xA2, 0, 2, [UIntPtr]::Zero)'
        ].join('; ')
      ]);
      return;
    }

    throw new Error(`Paste injection is not supported on ${currentPlatform}`);
  }
}
