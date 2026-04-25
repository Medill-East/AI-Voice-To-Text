import { globalShortcut } from 'electron';
import * as nodeUtil from 'node:util';
import type { IGlobalKeyDownMap, IGlobalKeyEvent, IGlobalKeyListener } from 'node-global-key-listener';
import { HotkeyGestureDetector, type HotkeyAction } from '../core/hotkeyGesture';
import { createShortcutMatcher, isModifierOnlyAccelerator } from '../core/hotkeyMatcher';

interface HotkeyServiceOptions {
  accelerator: string;
  fallbackAccelerator?: string;
  longPressMs: number;
  accessibilityTrusted?: boolean;
  onAction(action: HotkeyAction): void;
  onStatus?(status: HotkeyStatus): void;
}

export interface HotkeyStatus {
  backend: 'native-listener' | 'electron-shortcut';
  registered: boolean;
  requestedAccelerator?: string;
  activeAccelerator?: string;
  fallbackAccelerator?: string;
  fallbackRegistered?: boolean;
  nativeActive?: boolean;
  lastNativeEventAt?: number;
  needsAccessibilityPermission?: boolean;
  accessibilityTrusted?: boolean;
  lastError?: string;
  message?: string;
}

export interface NativeKeyListenerHandle {
  remove(): void;
  kill(): void;
}

export interface NativeKeyListenerFactory {
  addListener(callback: IGlobalKeyListener, onError: (error: unknown) => void): Promise<NativeKeyListenerHandle>;
}

interface HotkeyServiceDependencies {
  nativeFactory?: NativeKeyListenerFactory;
  noNativeEventTimeoutMs?: number;
  now?: () => number;
}

export class HotkeyService {
  private nativeHandle?: NativeKeyListenerHandle;
  private listenerCallback?: IGlobalKeyListener;
  private timer?: NodeJS.Timeout;
  private diagnosticTimer?: NodeJS.Timeout;
  private hasSeenNativeEvent = false;
  private isShortcutDown = false;
  private detector?: HotkeyGestureDetector;
  private currentOptions?: HotkeyServiceOptions;
  private fallbackAccelerator?: string;
  private fallbackRegistered = false;
  private nativeActive = false;
  private lastNativeEventAt?: number;
  private lastError?: string;
  private readonly nativeFactory: NativeKeyListenerFactory;
  private readonly noNativeEventTimeoutMs: number;
  private readonly now: () => number;

  constructor(dependencies: HotkeyServiceDependencies = {}) {
    this.nativeFactory = dependencies.nativeFactory ?? new DefaultNativeKeyListenerFactory();
    this.noNativeEventTimeoutMs = dependencies.noNativeEventTimeoutMs ?? 2500;
    this.now = dependencies.now ?? Date.now;
  }

  async register(options: HotkeyServiceOptions): Promise<HotkeyStatus> {
    this.unregister();
    this.currentOptions = options;
    this.detector = new HotkeyGestureDetector({ longPressMs: options.longPressMs });
    const nativeRequired = requiresNativeListener(options.accelerator);

    if (nativeRequired && options.fallbackAccelerator) {
      this.registerFallbackShortcut(options);
    }

    if (nativeRequired && options.accessibilityTrusted === false) {
      const status = this.fallbackStatus(options, {
        needsAccessibilityPermission: true,
        message: '纯修饰键需要 macOS 辅助功能权限。已临时启用备用快捷键。'
      });
      options.onStatus?.(status);
      return status;
    }

    try {
      await this.registerNativeListener(options);
      this.nativeActive = true;
      this.lastError = undefined;
      const status = this.nativeStatus(options);
      options.onStatus?.(status);
      return status;
    } catch (error) {
      this.nativeActive = false;
      this.lastError = stringifyError(error);
      if (nativeRequired) {
        const status = this.fallbackStatus(options, {
          needsAccessibilityPermission: true,
          lastError: this.lastError,
          message: `系统监听不可用，备用快捷键生效中：${this.lastError}`
        });
        options.onStatus?.(status);
        return status;
      }
      const shortcutRegistered = globalShortcut.register(options.accelerator, () => {
        options.onAction({ type: 'start-recording', mode: 'toggle' });
      });
      const status = {
        backend: 'electron-shortcut' as const,
        registered: shortcutRegistered,
        requestedAccelerator: options.accelerator,
        activeAccelerator: options.accelerator,
        fallbackAccelerator: options.fallbackAccelerator,
        fallbackRegistered: false,
        nativeActive: false,
        accessibilityTrusted: options.accessibilityTrusted,
        lastError: this.lastError,
        message: this.lastError
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

    if (this.nativeHandle) {
      this.nativeHandle.remove();
      this.nativeHandle.kill();
    }

    this.nativeHandle = undefined;
    this.listenerCallback = undefined;
    this.currentOptions = undefined;
    this.hasSeenNativeEvent = false;
    this.isShortcutDown = false;
    this.fallbackAccelerator = undefined;
    this.fallbackRegistered = false;
    this.nativeActive = false;
    this.lastNativeEventAt = undefined;
    this.lastError = undefined;
    this.detector?.reset();
    globalShortcut.unregisterAll();
  }

  private async registerNativeListener(options: HotkeyServiceOptions): Promise<void> {
    const matcher = createShortcutMatcher(options.accelerator);
    this.hasSeenNativeEvent = false;

    this.listenerCallback = (event: IGlobalKeyEvent, down: IGlobalKeyDownMap) => {
      this.hasSeenNativeEvent = true;
      this.lastNativeEventAt = this.now();
      if (!this.nativeActive) {
        this.nativeActive = true;
        this.lastError = undefined;
        options.onStatus?.(this.nativeStatus(options));
      }
      if (!this.detector || !event.name || !matcher({ name: event.name, state: event.state }, down)) {
        return;
      }

      if (event.state === 'DOWN' && !this.isShortcutDown) {
        this.isShortcutDown = true;
        this.emitActions(this.detector.keyDown(this.now()), options.onAction);
        this.timer = setTimeout(() => {
          if (!this.detector) {
            return;
          }
          this.emitActions(this.detector.thresholdElapsed(this.now()), options.onAction);
        }, options.longPressMs);
        return true;
      }

      if (event.state === 'UP' && this.isShortcutDown) {
        this.isShortcutDown = false;
        if (this.timer) {
          clearTimeout(this.timer);
          this.timer = undefined;
        }
        this.emitActions(this.detector.keyUp(this.now()), options.onAction);
        return true;
      }

      return true;
    };

    this.nativeHandle = await this.nativeFactory.addListener(this.listenerCallback, (error) => this.handleNativeListenerUnavailable(error));
    this.diagnosticTimer = setTimeout(() => {
      if (!this.hasSeenNativeEvent) {
        this.nativeActive = false;
        const nativeRequired = requiresNativeListener(options.accelerator);
        if (nativeRequired && this.fallbackRegistered) {
          options.onStatus?.(
            this.fallbackStatus(options, {
              message: '系统监听暂未收到按键事件，备用快捷键已生效中。'
            })
          );
        } else {
          options.onStatus?.({
            ...this.nativeStatus(options),
            nativeActive: false,
            message: '如果按键没有反应，请在系统设置里给 V2T 开启“辅助功能”和“输入监控”权限。'
          });
        }
      }
    }, this.noNativeEventTimeoutMs);
  }

  private emitActions(actions: HotkeyAction[], onAction: (action: HotkeyAction) => void): void {
    for (const action of actions) {
      onAction(action);
    }
  }

  private registerFallbackShortcut(options: HotkeyServiceOptions): void {
    const fallback = options.fallbackAccelerator;
    if (!fallback) {
      return;
    }

    this.fallbackAccelerator = fallback;
    this.fallbackRegistered = globalShortcut.register(fallback, () => {
      options.onAction({ type: 'start-recording', mode: 'toggle' });
    });
  }

  private handleNativeListenerUnavailable(error: unknown): void {
    const options = this.currentOptions;
    if (!options) {
      return;
    }

    this.nativeActive = false;
    this.lastError = stringifyError(error);
    const nativeRequired = requiresNativeListener(options.accelerator);
    const status =
      nativeRequired && this.fallbackRegistered
        ? this.fallbackStatus(options, {
            lastError: this.lastError,
            message: '系统监听不可用，备用快捷键生效中。'
          })
        : {
            ...this.nativeStatus(options),
            registered: false,
            nativeActive: false,
            lastError: this.lastError,
            message: this.lastError
          };
    options.onStatus?.(status);
  }

  private nativeStatus(options: HotkeyServiceOptions): HotkeyStatus {
    return {
      backend: 'native-listener',
      registered: true,
      requestedAccelerator: options.accelerator,
      activeAccelerator: options.accelerator,
      fallbackAccelerator: this.fallbackAccelerator ?? options.fallbackAccelerator,
      fallbackRegistered: this.fallbackRegistered,
      nativeActive: this.nativeActive,
      lastNativeEventAt: this.lastNativeEventAt,
      accessibilityTrusted: options.accessibilityTrusted,
      lastError: this.lastError
    };
  }

  private fallbackStatus(
    options: HotkeyServiceOptions,
    details: { needsAccessibilityPermission?: boolean; lastError?: string; message?: string } = {}
  ): HotkeyStatus {
    const activeAccelerator = this.fallbackRegistered ? this.fallbackAccelerator : options.accelerator;
    return {
      backend: 'electron-shortcut',
      registered: this.fallbackRegistered,
      requestedAccelerator: options.accelerator,
      activeAccelerator,
      fallbackAccelerator: this.fallbackAccelerator ?? options.fallbackAccelerator,
      fallbackRegistered: this.fallbackRegistered,
      nativeActive: this.nativeActive,
      lastNativeEventAt: this.lastNativeEventAt,
      needsAccessibilityPermission: details.needsAccessibilityPermission,
      accessibilityTrusted: options.accessibilityTrusted,
      lastError: details.lastError ?? this.lastError,
      message: this.fallbackRegistered ? details.message : `${details.message ?? '当前触发键不可用'} 备用快捷键也注册失败。`
    };
  }
}

class DefaultNativeKeyListenerFactory implements NativeKeyListenerFactory {
  async addListener(callback: IGlobalKeyListener, onError: (error: unknown) => void): Promise<NativeKeyListenerHandle> {
    patchLegacyUtil();
    const { GlobalKeyboardListener } = require('node-global-key-listener') as typeof import('node-global-key-listener');
    const listener = new GlobalKeyboardListener({
      mac: {
        onError
      },
      windows: {
        onError
      }
    });
    await listener.addListener(callback);
    return {
      remove: () => listener.removeListener(callback),
      kill: () => listener.kill()
    };
  }
}

function stringifyError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
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

function requiresNativeListener(accelerator: string): boolean {
  return isSingleKeyAccelerator(accelerator) || isModifierOnlyAccelerator(accelerator);
}
