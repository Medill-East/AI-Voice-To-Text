import { execFile } from 'node:child_process';
import { platform } from 'node:os';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export async function getFocusedAppName(): Promise<string | undefined> {
  try {
    if (platform() === 'darwin') {
      const { stdout } = await execFileAsync('osascript', [
        '-e',
        'tell application "System Events" to get name of first application process whose frontmost is true'
      ]);
      return stdout.trim() || undefined;
    }

    if (platform() === 'win32') {
      const { stdout } = await execFileAsync('powershell.exe', [
        '-NoProfile',
        '-Command',
        'Add-Type @\"\nusing System;\nusing System.Runtime.InteropServices;\nusing System.Text;\npublic class Win32 {\n[DllImport(\"user32.dll\")] public static extern IntPtr GetForegroundWindow();\n[DllImport(\"user32.dll\")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);\n}\n\"@; $buffer = New-Object System.Text.StringBuilder 256; [void][Win32]::GetWindowText([Win32]::GetForegroundWindow(), $buffer, $buffer.Capacity); $buffer.ToString()'
      ]);
      return stdout.trim() || undefined;
    }
  } catch {
    return undefined;
  }

  return undefined;
}
