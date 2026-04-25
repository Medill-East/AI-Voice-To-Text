export interface GlobalKeyEventLike {
  name: string;
  state: string;
}

export type GlobalKeyDownMapLike = Record<string, boolean | undefined>;

type Modifier =
  | 'COMMANDORCONTROL'
  | 'COMMAND'
  | 'LEFTCOMMAND'
  | 'RIGHTCOMMAND'
  | 'CONTROL'
  | 'LEFTCONTROL'
  | 'RIGHTCONTROL'
  | 'ALT'
  | 'LEFTALT'
  | 'RIGHTALT'
  | 'SHIFT'
  | 'LEFTSHIFT'
  | 'RIGHTSHIFT';

const MODIFIER_KEYS: Record<Modifier, string[]> = {
  COMMANDORCONTROL: ['LEFT CTRL', 'RIGHT CTRL', 'LEFT META', 'RIGHT META'],
  COMMAND: ['LEFT META', 'RIGHT META'],
  LEFTCOMMAND: ['LEFT META'],
  RIGHTCOMMAND: ['RIGHT META'],
  CONTROL: ['LEFT CTRL', 'RIGHT CTRL'],
  LEFTCONTROL: ['LEFT CTRL'],
  RIGHTCONTROL: ['RIGHT CTRL'],
  ALT: ['LEFT ALT', 'RIGHT ALT'],
  LEFTALT: ['LEFT ALT'],
  RIGHTALT: ['RIGHT ALT'],
  SHIFT: ['LEFT SHIFT', 'RIGHT SHIFT'],
  LEFTSHIFT: ['LEFT SHIFT'],
  RIGHTSHIFT: ['RIGHT SHIFT']
};

const MODIFIER_ALIASES: Record<string, Modifier> = {
  CTRL: 'CONTROL',
  CONTROL: 'CONTROL',
  LEFTCTRL: 'LEFTCONTROL',
  LEFTCONTROL: 'LEFTCONTROL',
  RIGHTCTRL: 'RIGHTCONTROL',
  RIGHTCONTROL: 'RIGHTCONTROL',
  COMMAND: 'COMMAND',
  CMD: 'COMMAND',
  META: 'COMMAND',
  LEFTCOMMAND: 'LEFTCOMMAND',
  LEFTCMD: 'LEFTCOMMAND',
  LEFTMETA: 'LEFTCOMMAND',
  RIGHTCOMMAND: 'RIGHTCOMMAND',
  RIGHTCMD: 'RIGHTCOMMAND',
  RIGHTMETA: 'RIGHTCOMMAND',
  COMMANDORCONTROL: 'COMMANDORCONTROL',
  OPTION: 'ALT',
  ALT: 'ALT',
  LEFTOPTION: 'LEFTALT',
  LEFTALT: 'LEFTALT',
  RIGHTOPTION: 'RIGHTALT',
  RIGHTALT: 'RIGHTALT',
  SHIFT: 'SHIFT',
  LEFTSHIFT: 'LEFTSHIFT',
  RIGHTSHIFT: 'RIGHTSHIFT'
};

export function createShortcutMatcher(accelerator: string) {
  const parts = accelerator
    .split('+')
    .map((part) => part.trim().toUpperCase())
    .filter(Boolean);
  const modifiers = parts.map((part) => MODIFIER_ALIASES[part]).filter((part): part is Modifier => Boolean(part));
  const mainKey = parts
    .filter((part) => !MODIFIER_ALIASES[part])
    .map(normalizeKey)
    .at(-1);

  if (!mainKey) {
    return (event: GlobalKeyEventLike, down: GlobalKeyDownMapLike): boolean => {
      if (!eventMatchesRequiredModifier(event.name, modifiers)) {
        return false;
      }
      if (event.state === 'UP') {
        return true;
      }
      return modifiers.every((modifier) => isModifierDown(modifier, downWithCurrentEvent(event, down)));
    };
  }

  return (event: GlobalKeyEventLike, down: GlobalKeyDownMapLike): boolean => {
    if (event.name !== mainKey) {
      return false;
    }
    return modifiers.every((modifier) => isModifierDown(modifier, down));
  };
}

export function isModifierOnlyAccelerator(accelerator: string): boolean {
  const parts = accelerator
    .split('+')
    .map((part) => part.trim().toUpperCase())
    .filter(Boolean);
  return parts.length > 0 && parts.every((part) => Boolean(MODIFIER_ALIASES[part]));
}

function isModifierDown(modifier: Modifier, down: GlobalKeyDownMapLike): boolean {
  return MODIFIER_KEYS[modifier].some((key) => Boolean(down[key]));
}

function downWithCurrentEvent(event: GlobalKeyEventLike, down: GlobalKeyDownMapLike): GlobalKeyDownMapLike {
  if (event.state !== 'DOWN') {
    return down;
  }
  return {
    ...down,
    [event.name]: true
  };
}

function eventMatchesRequiredModifier(name: string, modifiers: Modifier[]): boolean {
  const normalized = name.toUpperCase();
  return modifiers.some((modifier) => MODIFIER_KEYS[modifier].includes(normalized));
}

function normalizeKey(key: string): string {
  if (key === 'SPACE') {
    return 'SPACE';
  }
  if (key === 'CAPSLOCK' || key === 'CAPS LOCK') {
    return 'CAPS LOCK';
  }
  return key;
}
