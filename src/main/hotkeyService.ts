import { globalShortcut } from 'electron';
import * as nodeUtil from 'node:util';
import type { GlobalKeyboardListener, IGlobalKeyDownMap, IGlobalKeyEvent, IGlobalKeyListener } from 'node-global-key-listener';
import { HotkeyGestureDetector, type HotkeyAction } from '../core/hotkeyGesture';
import { createShortcutMatcher, isModifierOnlyAccelerator } from '../core/hotkeyMatcher';

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
  private diagnosticTimer?: NodeJS.Timeout;
  private hasSeenNativeEvent = false;
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
      if (isSingleKeyAccelerator(options.accelerator) || isModifierOnlyAccelerator(options.accelerator)) {
        const status = {
          backend: 'electron-shortcut' as const,
          registered: false,
          message: `单键触发需要系统级键盘监听权限：${error instanceof Error ? error.message : String(error)}`
        };
        options.onStatus?.(status);
        return status;
      }
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
    if (this.diagnosticTimer) {
      clearTimeout(this.diagnosticTimer);
      this.diagnosticTimer = undefined;
    }

    if (this.listener && this.listenerCallback) {
      this.listener.removeListener(this.listenerCallback);
      this.listener.kill();
    }

    this.listener = undefined;
    this.listenerCallback = undefined;
    this.hasSeenNativeEvent = false;
    this.isShortcutDown = false;
    this.detector?.reset();
    globalShortcut.unregisterAll();
  }

  private async registerNativeListener(options: HotkeyServiceOptions): Promise<void> {
    patchLegacyUtil();
    const { GlobalKeyboardListener } = require('node-global-key-listener') as typeof import('node-global-key-listener');
    const matcher = createShortcutMatcher(options.accelerator);
    this.hasSeenNativeEvent = false;
    this.listener = new GlobalKeyboardListener({
      mac: {
        onError: (error) => options.onStatus?.({ backend: 'native-listener', registered: false, message: String(error) })
      },
      windows: {
        onError: (error) => options.onStatus?.({ backend: 'native-listener', registered: false, message: String(error) })
      }
    });

    this.listenerCallback = (event: IGlobalKeyEvent, down: IGlobalKeyDownMap) => {
      this.hasSeenNativeEvent = true;
      if (!this.detector || !event.name || !matcher({ name: event.name, state: event.state }, down)) {
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
    this.diagnosticTimer = setTimeout(() => {
      if (!this.hasSeenNativeEvent) {
        options.onStatus?.({
          backend: 'native-listener',
          registered: true,
          message: '如果按键没有反应，请在系统设置里给 V2T 开启“辅助功能”和“输入监控”权限。'
        });
      }
    }, 2500);
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

function isSingleKeyAccelerator(accelerator: string): boolean {
  return !accelerator.includes('+');
}
