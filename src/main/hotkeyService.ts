import { globalShortcut } from 'electron';
import * as nodeUtil from 'node:util';
import type { GlobalKeyboardListener, IGlobalKeyDownMap, IGlobalKeyEvent, IGlobalKeyListener } from 'node-global-key-listener';
import { HotkeyGestureDetector, type HotkeyAction } from '../core/hotkeyGesture';

interface HotkeyServiceOptions {
  accelerator: string;
  longPressMs: number;
  onAction(action: HotkeyAction): void;
  onStatus?(status: HotkeyStatus): void;
}

export interface HotkeyStatus {
  backend: 'native-listener' | 'electron-shortcut';
  registered: boolean;
  message?: string;
}

export class HotkeyService {
  private listener?: GlobalKeyboardListener;
  private listenerCallback?: IGlobalKeyListener;
  private timer?: NodeJS.Timeout;
  private isShortcutDown = false;
  private detector?: HotkeyGestureDetector;

  async register(options: HotkeyServiceOptions): Promise<HotkeyStatus> {
    this.unregister();
    this.detector = new HotkeyGestureDetector({ longPressMs: options.longPressMs });

    try {
      await this.registerNativeListener(options);
      const status = { backend: 'native-listener' as const, registered: true };
      options.onStatus?.(status);
      return status;
    } catch (error) {
      const shortcutRegistered = globalShortcut.register(options.accelerator, () => {
        options.onAction({ type: 'start-recording', mode: 'toggle' });
      });
      const status = {
        backend: 'electron-shortcut' as const,
        registered: shortcutRegistered,
        message: error instanceof Error ? error.message : String(error)
      };
      options.onStatus?.(status);
      return status;
    }
  }

  unregister(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }

    if (this.listener && this.listenerCallback) {
      this.listener.removeListener(this.listenerCallback);
      this.listener.kill();
    }

    this.listener = undefined;
    this.listenerCallback = undefined;
    this.isShortcutDown = false;
    this.detector?.reset();
    globalShortcut.unregisterAll();
  }

  private async registerNativeListener(options: HotkeyServiceOptions): Promise<void> {
    patchLegacyUtil();
    const { GlobalKeyboardListener } = require('node-global-key-listener') as typeof import('node-global-key-listener');
    const matcher = createShortcutMatcher(options.accelerator);
    this.listener = new GlobalKeyboardListener({
      mac: {
        onError: (error) => options.onStatus?.({ backend: 'native-listener', registered: false, message: String(error) })
      },
      windows: {
        onError: (error) => options.onStatus?.({ backend: 'native-listener', registered: false, message: String(error) })
      }
    });

    this.listenerCallback = (event: IGlobalKeyEvent, down: IGlobalKeyDownMap) => {
      if (!this.detector || !matcher(event, down)) {
        return;
      }

      if (event.state === 'DOWN' && !this.isShortcutDown) {
        this.isShortcutDown = true;
        this.emitActions(this.detector.keyDown(Date.now()), options.onAction);
        this.timer = setTimeout(() => {
          if (!this.detector) {
            return;
          }
          this.emitActions(this.detector.thresholdElapsed(Date.now()), options.onAction);
        }, options.longPressMs);
        return true;
      }

      if (event.state === 'UP' && this.isShortcutDown) {
        this.isShortcutDown = false;
        if (this.timer) {
          clearTimeout(this.timer);
          this.timer = undefined;
        }
        this.emitActions(this.detector.keyUp(Date.now()), options.onAction);
        return true;
      }

      return true;
    };

    await this.listener.addListener(this.listenerCallback);
  }

  private emitActions(actions: HotkeyAction[], onAction: (action: HotkeyAction) => void): void {
    for (const action of actions) {
      onAction(action);
    }
  }
}

function patchLegacyUtil(): void {
  const legacyUtil = nodeUtil as typeof nodeUtil & {
    isObject?: (value: unknown) => boolean;
    isFunction?: (value: unknown) => boolean;
  };

  legacyUtil.isObject ??= (value: unknown): boolean => value !== null && typeof value === 'object';
  legacyUtil.isFunction ??= (value: unknown): boolean => typeof value === 'function';
}

function createShortcutMatcher(accelerator: string) {
  const parts = accelerator.split('+').map((part) => part.trim().toUpperCase());
  const key = normalizeKey(parts[parts.length - 1]);
  const needsCtrl = parts.includes('CTRL') || parts.includes('CONTROL') || parts.includes('COMMANDORCONTROL');
  const needsMeta = parts.includes('COMMAND') || parts.includes('CMD') || parts.includes('COMMANDORCONTROL');
  const needsShift = parts.includes('SHIFT');
  const needsAlt = parts.includes('ALT') || parts.includes('OPTION');

  return (event: IGlobalKeyEvent, down: IGlobalKeyDownMap): boolean => {
    if (event.name !== key) {
      return false;
    }

    return (
      (!needsShift || Boolean(down['LEFT SHIFT'] || down['RIGHT SHIFT'])) &&
      (!needsAlt || Boolean(down['LEFT ALT'] || down['RIGHT ALT'])) &&
      (!needsCtrl || Boolean(down['LEFT CTRL'] || down['RIGHT CTRL'] || down['LEFT META'] || down['RIGHT META'])) &&
      (!needsMeta || Boolean(down['LEFT META'] || down['RIGHT META'] || down['LEFT CTRL'] || down['RIGHT CTRL']))
    );
  };
}

function normalizeKey(key: string): IGlobalKeyEvent['name'] {
  if (key === 'SPACE') {
    return 'SPACE';
  }
  if (/^F\d{1,2}$/.test(key)) {
    return key as IGlobalKeyEvent['name'];
  }
  return key.length === 1 ? (key as IGlobalKeyEvent['name']) : (key as IGlobalKeyEvent['name']);
}
