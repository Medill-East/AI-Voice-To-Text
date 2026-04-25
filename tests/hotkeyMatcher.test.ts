import { describe, expect, it } from 'vitest';
import { createShortcutMatcher } from '../src/core/hotkeyMatcher';

describe('hotkey matcher', () => {
  it('matches a single modifier key press and release', () => {
    const matcher = createShortcutMatcher('CommandOrControl');

    expect(matcher({ name: 'LEFT META', state: 'DOWN' }, { 'LEFT META': true })).toBe(true);
    expect(matcher({ name: 'LEFT META', state: 'UP' }, {})).toBe(true);
    expect(matcher({ name: 'A', state: 'DOWN' }, { A: true })).toBe(false);
  });

  it('matches left, right, and generic Option triggers on the first keydown', () => {
    const generic = createShortcutMatcher('Alt');
    const right = createShortcutMatcher('RightAlt');
    const left = createShortcutMatcher('LeftAlt');

    expect(generic({ name: 'RIGHT ALT', state: 'DOWN' }, {})).toBe(true);
    expect(generic({ name: 'LEFT ALT', state: 'DOWN' }, {})).toBe(true);
    expect(right({ name: 'RIGHT ALT', state: 'DOWN' }, {})).toBe(true);
    expect(right({ name: 'LEFT ALT', state: 'DOWN' }, {})).toBe(false);
    expect(left({ name: 'LEFT ALT', state: 'DOWN' }, {})).toBe(true);
    expect(left({ name: 'RIGHT ALT', state: 'DOWN' }, {})).toBe(false);
    expect(right({ name: 'RIGHT ALT', state: 'UP' }, {})).toBe(true);
  });

  it('keeps Command and Control as distinct modifier triggers', () => {
    const command = createShortcutMatcher('Command');
    const control = createShortcutMatcher('Control');

    expect(command({ name: 'LEFT META', state: 'DOWN' }, { 'LEFT META': true })).toBe(true);
    expect(command({ name: 'LEFT CTRL', state: 'DOWN' }, { 'LEFT CTRL': true })).toBe(false);
    expect(control({ name: 'LEFT CTRL', state: 'DOWN' }, { 'LEFT CTRL': true })).toBe(true);
    expect(control({ name: 'LEFT META', state: 'DOWN' }, { 'LEFT META': true })).toBe(false);
  });

  it('matches pure modifier combinations only after all modifiers are down', () => {
    const matcher = createShortcutMatcher('CommandOrControl+Alt');

    expect(matcher({ name: 'LEFT META', state: 'DOWN' }, { 'LEFT META': true })).toBe(false);
    expect(matcher({ name: 'LEFT ALT', state: 'DOWN' }, { 'LEFT META': true })).toBe(true);
    expect(matcher({ name: 'LEFT ALT', state: 'UP' }, { 'LEFT META': true })).toBe(true);
  });
});
