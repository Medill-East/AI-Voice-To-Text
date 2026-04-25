const MODIFIER_ORDER = [
  'CommandOrControl',
  'Command',
  'LeftCommand',
  'RightCommand',
  'Control',
  'LeftControl',
  'RightControl',
  'Alt',
  'LeftAlt',
  'RightAlt',
  'Shift',
  'LeftShift',
  'RightShift'
] as const;

type ModifierKey = (typeof MODIFIER_ORDER)[number];

const KEY_ALIASES: Record<string, string> = {
  ' ': 'Space',
  SPACEBAR: 'Space',
  SPACE: 'Space',
  ESC: 'Escape',
  ESCAPE: 'Escape',
  RETURN: 'Enter',
  ENTER: 'Enter',
  CAPSLOCK: 'CapsLock',
  CAPS_LOCK: 'CapsLock',
  CMD: 'Command',
  COMMAND: 'Command',
  META: 'Command',
  COMMANDLEFT: 'LeftCommand',
  LEFTCOMMAND: 'LeftCommand',
  CMDLEFT: 'LeftCommand',
  LEFTCMD: 'LeftCommand',
  METALEFT: 'LeftCommand',
  LEFTMETA: 'LeftCommand',
  COMMANDRIGHT: 'RightCommand',
  RIGHTCOMMAND: 'RightCommand',
  CMDRIGHT: 'RightCommand',
  RIGHTCMD: 'RightCommand',
  METARIGHT: 'RightCommand',
  RIGHTMETA: 'RightCommand',
  CONTROL: 'Control',
  CTRL: 'Control',
  CONTROLLEFT: 'LeftControl',
  LEFTCONTROL: 'LeftControl',
  CTRLLEFT: 'LeftControl',
  LEFTCTRL: 'LeftControl',
  CONTROLRIGHT: 'RightControl',
  RIGHTCONTROL: 'RightControl',
  CTRLRIGHT: 'RightControl',
  RIGHTCTRL: 'RightControl',
  COMMANDORCONTROL: 'CommandOrControl',
  OPTION: 'Alt',
  ALT: 'Alt',
  OPTIONLEFT: 'LeftAlt',
  LEFTOPTION: 'LeftAlt',
  ALTLEFT: 'LeftAlt',
  LEFTALT: 'LeftAlt',
  OPTIONRIGHT: 'RightAlt',
  RIGHTOPTION: 'RightAlt',
  ALTRIGHT: 'RightAlt',
  RIGHTALT: 'RightAlt',
  SHIFT: 'Shift',
  SHIFTLEFT: 'LeftShift',
  LEFTSHIFT: 'LeftShift',
  SHIFTRIGHT: 'RightShift',
  RIGHTSHIFT: 'RightShift'
};

const SAFE_SINGLE_KEYS = new Set([
  'Space',
  'CapsLock',
  'Escape',
  'Insert',
  'Delete',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'MediaPlayPause',
  'MediaNextTrack',
  'MediaPreviousTrack',
  'MediaStop',
  'VolumeUp',
  'VolumeDown',
  'VolumeMute',
  'AudioVolumeUp',
  'AudioVolumeDown',
  'AudioVolumeMute'
]);

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
    if (isModifier(part)) {
      modifiers.add(part);
      continue;
    }
    mainKey = normalizeMainKey(part);
  }

  if (!mainKey) {
    if (modifiers.size > 0) {
      return MODIFIER_ORDER.filter((modifier) => modifiers.has(modifier)).join('+');
    }
    throw new Error('快捷键需要包含一个主按键');
  }

  if (modifiers.size === 0 && !isSafeSingleKey(mainKey)) {
    throw new Error('这个单键容易影响打字，请选择功能键或组合键。');
  }

  return [...MODIFIER_ORDER.filter((modifier) => modifiers.has(modifier)), mainKey].join('+');
}

function isModifier(part: string): part is ModifierKey {
  return (MODIFIER_ORDER as readonly string[]).includes(part);
}

export function isSafeSingleKey(key: string): boolean {
  const normalized = normalizeMainKey(normalizePart(key));
  return /^F(?:[1-9]|1\d|2[0-4])$/.test(normalized) || SAFE_SINGLE_KEYS.has(normalized);
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
