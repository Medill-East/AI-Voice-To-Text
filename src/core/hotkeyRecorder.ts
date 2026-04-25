const MODIFIER_ORDER = ['CommandOrControl', 'Alt', 'Shift'] as const;

const KEY_ALIASES: Record<string, string> = {
  ' ': 'Space',
  SPACEBAR: 'Space',
  SPACE: 'Space',
  ESC: 'Escape',
  ESCAPE: 'Escape',
  RETURN: 'Enter',
  ENTER: 'Enter',
  CMD: 'CommandOrControl',
  COMMAND: 'CommandOrControl',
  META: 'CommandOrControl',
  CONTROL: 'CommandOrControl',
  CTRL: 'CommandOrControl',
  COMMANDORCONTROL: 'CommandOrControl',
  OPTION: 'Alt',
  ALT: 'Alt',
  SHIFT: 'Shift'
};

export function shortcutFromRecordedKeys(keys: string[], platform: NodeJS.Platform): string {
  return normalizeAccelerator(keys.join('+'), platform);
}

export function normalizeAccelerator(input: string, platform: NodeJS.Platform): string {
  const parts = input
    .split('+')
    .map((part) => normalizePart(part))
    .filter(Boolean);
  const modifiers = new Set<string>();
  let mainKey: string | undefined;

  for (const part of parts) {
    if (part === 'CommandOrControl' || part === 'Alt' || part === 'Shift') {
      modifiers.add(part);
      continue;
    }
    mainKey = normalizeMainKey(part);
  }

  if (!mainKey) {
    throw new Error('快捷键需要包含一个主按键');
  }

  if (modifiers.size === 0) {
    throw new Error('快捷键至少包含一个修饰键');
  }

  return [...MODIFIER_ORDER.filter((modifier) => modifiers.has(modifier)), mainKey].join('+');
}

function normalizePart(input: string): string {
  const cleaned = input.trim();
  const upper = cleaned.toUpperCase();
  return KEY_ALIASES[upper] ?? cleaned;
}

function normalizeMainKey(input: string): string {
  if (input.length === 1) {
    return input.toUpperCase();
  }

  return input.slice(0, 1).toUpperCase() + input.slice(1);
}
