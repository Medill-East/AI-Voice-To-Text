export function hotkeyLabelForPlatform(accelerator: string, platform: NodeJS.Platform): string {
  const replacements = platform === 'darwin' ? MAC_REPLACEMENTS : platform === 'win32' ? WINDOWS_REPLACEMENTS : GENERIC_REPLACEMENTS;
  return splitAccelerator(accelerator)
    .map((part) => replacements[part] ?? part)
    .join('+');
}

function splitAccelerator(accelerator: string): string[] {
  return accelerator
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean);
}

const MAC_REPLACEMENTS: Record<string, string> = {
  RightAlt: '右 Option',
  LeftAlt: '左 Option',
  Alt: '任意 Option',
  RightCommand: '右 Command',
  LeftCommand: '左 Command',
  Command: '任意 Command',
  CommandOrControl: 'Command/Ctrl',
  RightControl: '右 Control',
  LeftControl: '左 Control',
  Control: '任意 Control',
  RightShift: '右 Shift',
  LeftShift: '左 Shift',
  Shift: '任意 Shift'
};

const WINDOWS_REPLACEMENTS: Record<string, string> = {
  RightAlt: '右 Alt',
  LeftAlt: '左 Alt',
  Alt: 'Alt',
  RightCommand: '右 Win',
  LeftCommand: '左 Win',
  Command: 'Win',
  CommandOrControl: 'Ctrl',
  RightControl: '右 Ctrl',
  LeftControl: '左 Ctrl',
  Control: 'Ctrl',
  RightShift: '右 Shift',
  LeftShift: '左 Shift',
  Shift: 'Shift'
};

const GENERIC_REPLACEMENTS: Record<string, string> = {
  RightAlt: '右 Alt',
  LeftAlt: '左 Alt',
  Alt: 'Alt',
  RightCommand: '右 Meta',
  LeftCommand: '左 Meta',
  Command: 'Meta',
  CommandOrControl: 'Ctrl',
  RightControl: '右 Ctrl',
  LeftControl: '左 Ctrl',
  Control: 'Ctrl',
  RightShift: '右 Shift',
  LeftShift: '左 Shift',
  Shift: 'Shift'
};
