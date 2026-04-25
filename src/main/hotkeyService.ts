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
  nativeHelperPath?: string;
  nativeHelperSignature?: string;
  hotkeyLogPath?: string;
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
  checking?: boolean;
  helperAttempted?: boolean;
  helperStarted?: boolean;
  helperVerified?: boolean;
  helperLastStderr?: string;
  helperListenAccess?: boolean;
  helperEventTapCreated?: boolean;
  nativeActive?: boolean;
  nativeHelperPath?: string;
  nativeHelperSignature?: string;
  hotkeyLogPath?: string;
  nativeLastInfo?: string;
  nativeExitCode?: number | null;
  lastNativeEventAt?: number;
  needsAccessibilityPermission?: boolean;
  appAccessibilityTrusted?: boolean;
  accessibilityTrusted?: boolean;
  lastError?: string;
  diagnosticMessage?: string;
  recommendedAction?: 'grant-native-helper-accessibility' | 'try-fallback-shortcut' | 'none';
  message?: string;
}

export interface HotkeyTestResult {
  ok: boolean;
  accelerator: string;
  eventName?: string;
  nativeHelperPath?: string;
  nativeLastInfo?: string;
  helperStarted?: boolean;
  helperVerified?: boolean;
  helperLastStderr?: string;
  nativeExitCode?: number | null;
  error?: string;
  diagnosticMessage?: string;
  recommendedAction?: HotkeyStatus['recommendedAction'];
}

export interface NativeKeyListenerHandle {
  remove(): void;
  kill(): void;
}

export interface NativeKeyListenerFactory {
  addListener(
    callback: IGlobalKeyListener,
    onError: (error: unknown) => void,
    onInfo?: (info: string) => void,
    serverPath?: string
  ): Promise<NativeKeyListenerHandle>;
}

interface HotkeyServiceDependencies {
  nativeFactory?: NativeKeyListenerFactory;
  noNativeEventTimeoutMs?: number;
  now?: () => number;
  onDiagnostic?(event: {
    type: string;
    helperPath?: string;
    signature?: string;
    stderr?: string;
    exitCode?: number | null;
    accelerator?: string;
    message?: string;
  }): void;
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
  private helperAttempted = false;
  private helperStarted = false;
  private helperVerified = false;
  private helperListenAccess?: boolean;
  private helperEventTapCreated?: boolean;
  private nativeActive = false;
  private nativeHelperPath?: string;
  private nativeLastInfo?: string;
  private nativeExitCode?: number | null;
  private lastNativeEventAt?: number;
  private lastError?: string;
  private readonly nativeFactory: NativeKeyListenerFactory;
  private readonly noNativeEventTimeoutMs: number;
  private readonly now: () => number;
  private readonly onDiagnostic?: HotkeyServiceDependencies['onDiagnostic'];

  constructor(dependencies: HotkeyServiceDependencies = {}) {
    this.nativeFactory = dependencies.nativeFactory ?? new DefaultNativeKeyListenerFactory();
    this.noNativeEventTimeoutMs = dependencies.noNativeEventTimeoutMs ?? 2500;
    this.now = dependencies.now ?? Date.now;
    this.onDiagnostic = dependencies.onDiagnostic;
  }

  async register(options: HotkeyServiceOptions): Promise<HotkeyStatus> {
    this.unregister();
    this.currentOptions = options;
    this.nativeHelperPath = options.nativeHelperPath;
    this.detector = new HotkeyGestureDetector({ longPressMs: options.longPressMs });
    const nativeRequired = requiresNativeListener(options.accelerator);

    if (nativeRequired && options.fallbackAccelerator) {
      this.registerFallbackShortcut(options);
    }

    try {
      await this.registerNativeListener(options);
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
        this.handleShortcutActivation(options);
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
    this.helperAttempted = false;
    this.helperStarted = false;
    this.helperVerified = false;
    this.helperListenAccess = undefined;
    this.helperEventTapCreated = undefined;
    this.nativeActive = false;
    this.nativeHelperPath = undefined;
    this.nativeLastInfo = undefined;
    this.nativeExitCode = undefined;
    this.lastNativeEventAt = undefined;
    this.lastError = undefined;
    this.detector?.reset();
    globalShortcut.unregisterAll();
  }

  private async registerNativeListener(options: HotkeyServiceOptions): Promise<void> {
    const matcher = createShortcutMatcher(options.accelerator);
    this.hasSeenNativeEvent = false;
    this.helperAttempted = true;
    this.helperStarted = false;
    this.helperVerified = false;
    this.helperListenAccess = undefined;
    this.helperEventTapCreated = undefined;
    this.nativeActive = false;
    this.logDiagnostic('helper-start', options);

    this.listenerCallback = (event: IGlobalKeyEvent, down: IGlobalKeyDownMap) => {
      this.hasSeenNativeEvent = true;
      this.lastNativeEventAt = this.now();
      if (!this.nativeActive) {
        this.nativeActive = true;
        this.helperVerified = true;
        this.lastError = undefined;
        this.logDiagnostic('native-event', options);
        options.onStatus?.(this.nativeStatus(options));
      }
      if (!this.detector || !event.name || !matcher({ name: event.name, state: event.state }, down)) {
        return;
      }

      if (event.state === 'DOWN' && !this.isShortcutDown) {
        this.isShortcutDown = true;
        if (this.timer) {
          clearTimeout(this.timer);
          this.timer = undefined;
        }
        this.emitActions(this.detector.keyDown(this.now()), options.onAction);
        return true;
      }

      if (event.state === 'UP' && this.isShortcutDown) {
        this.isShortcutDown = false;
        this.emitActions(this.detector.keyUp(this.now()), options.onAction);
        this.scheduleSingleClickTimer(options);
        return true;
      }

      return true;
    };

    this.nativeHandle = await this.nativeFactory.addListener(
      this.listenerCallback,
      (error) => this.handleNativeListenerUnavailable(error),
      (info) => this.handleNativeInfo(info),
      options.nativeHelperPath
    );
    this.helperStarted = true;
    this.logDiagnostic('helper-spawned', options);
    this.diagnosticTimer = setTimeout(() => {
      if (!this.hasSeenNativeEvent) {
        this.nativeActive = false;
        options.onStatus?.(this.nativeStatus(options));
      }
    }, this.noNativeEventTimeoutMs);
  }

  private emitActions(actions: HotkeyAction[], onAction: (action: HotkeyAction) => void): void {
    for (const action of actions) {
      onAction(action);
    }
  }

  private handleNativeInfo(info: string): void {
    this.nativeLastInfo = info.trim();
    const parsed = parseNativeInfo(this.nativeLastInfo);
    if (parsed.helperListenAccess !== undefined) {
      this.helperListenAccess = parsed.helperListenAccess;
    }
    if (parsed.helperEventTapCreated !== undefined) {
      this.helperEventTapCreated = parsed.helperEventTapCreated;
    }
    const options = this.currentOptions;
    if (!options) {
      return;
    }
    this.logDiagnostic('helper-info', options, { stderr: this.nativeLastInfo });
    options.onStatus?.(this.nativeStatus(options));
  }

  private registerFallbackShortcut(options: HotkeyServiceOptions): void {
    const fallback = options.fallbackAccelerator;
    if (!fallback) {
      return;
    }

    this.fallbackAccelerator = fallback;
    this.fallbackRegistered = globalShortcut.register(fallback, () => {
      this.handleShortcutActivation(options);
    });
  }

  private handleShortcutActivation(options: HotkeyServiceOptions): void {
    if (!this.detector) {
      return;
    }
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    const actions = this.detector.shortcutActivated(this.now());
    this.emitActions(actions, options.onAction);
    if (actions.length === 0) {
      this.scheduleSingleClickTimer(options);
    }
  }

  private scheduleSingleClickTimer(options: HotkeyServiceOptions): void {
    if (!this.detector) {
      return;
    }
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      if (!this.detector) {
        return;
      }
      this.emitActions(this.detector.thresholdElapsed(this.now()), options.onAction);
      this.timer = undefined;
    }, options.longPressMs);
  }

  private handleNativeListenerUnavailable(error: unknown): void {
    const options = this.currentOptions;
    if (!options) {
      return;
    }

    this.nativeActive = false;
    this.helperVerified = false;
    this.nativeExitCode = exitCodeFromError(error);
    this.lastError = stringifyError(error);
    if (isEventTapFailure(this.nativeLastInfo)) {
      this.helperEventTapCreated = false;
    }
    const nativeRequired = requiresNativeListener(options.accelerator);
    const diagnosticMessage = helperFailureDiagnostic(options.nativeHelperPath, this.nativeLastInfo);
    this.logDiagnostic('helper-error', options, { stderr: this.nativeLastInfo, exitCode: this.nativeExitCode, message: this.lastError });
    const status: HotkeyStatus =
      nativeRequired && this.fallbackRegistered
        ? this.fallbackStatus(options, {
            lastError: this.lastError,
            nativeExitCode: this.nativeExitCode,
            diagnosticMessage,
            recommendedAction: 'grant-native-helper-accessibility',
            message: '系统监听不可用，备用快捷键生效中。'
          })
        : {
            ...this.nativeStatus(options),
            registered: false,
            nativeActive: false,
            nativeExitCode: this.nativeExitCode,
            lastError: this.lastError,
            diagnosticMessage: this.lastError,
            recommendedAction: 'grant-native-helper-accessibility',
            message: this.lastError
          };
    options.onStatus?.(status);
  }

  private nativeStatus(options: HotkeyServiceOptions): HotkeyStatus {
    const activeAccelerator = this.nativeActive
      ? options.accelerator
      : this.helperStarted
        ? options.accelerator
      : this.fallbackRegistered
        ? this.fallbackAccelerator
        : options.accelerator;
    const waitingForNativeEvent = this.helperStarted && !this.helperVerified;
    return {
      backend: 'native-listener',
      registered: true,
      requestedAccelerator: options.accelerator,
      activeAccelerator,
      fallbackAccelerator: this.fallbackAccelerator ?? options.fallbackAccelerator,
      fallbackRegistered: this.fallbackRegistered,
      helperAttempted: this.helperAttempted,
      helperStarted: this.helperStarted,
      helperVerified: this.helperVerified,
      helperLastStderr: this.nativeLastInfo,
      helperListenAccess: this.helperListenAccess,
      helperEventTapCreated: this.helperEventTapCreated,
      nativeActive: this.nativeActive,
      nativeHelperPath: this.nativeHelperPath ?? options.nativeHelperPath,
      nativeHelperSignature: options.nativeHelperSignature,
      hotkeyLogPath: options.hotkeyLogPath,
      nativeLastInfo: this.nativeLastInfo,
      nativeExitCode: this.nativeExitCode,
      lastNativeEventAt: this.lastNativeEventAt,
      needsAccessibilityPermission: undefined,
      appAccessibilityTrusted: options.accessibilityTrusted,
      accessibilityTrusted: options.accessibilityTrusted,
      lastError: this.lastError,
      diagnosticMessage: waitingForNativeEvent ? helperPendingDiagnostic() : undefined,
      recommendedAction: waitingForNativeEvent ? 'none' : undefined,
      message: waitingForNativeEvent ? '监听组件已启动，按一次快捷键完成验证；备用快捷键待命。' : undefined
    };
  }

  private fallbackStatus(
    options: HotkeyServiceOptions,
    details: {
      needsAccessibilityPermission?: boolean;
      lastError?: string;
      nativeExitCode?: number | null;
      diagnosticMessage?: string;
      recommendedAction?: HotkeyStatus['recommendedAction'];
      message?: string;
    } = {}
  ): HotkeyStatus {
    const activeAccelerator = this.fallbackRegistered ? this.fallbackAccelerator : options.accelerator;
    return {
      backend: 'electron-shortcut',
      registered: this.fallbackRegistered,
      requestedAccelerator: options.accelerator,
      activeAccelerator,
      fallbackAccelerator: this.fallbackAccelerator ?? options.fallbackAccelerator,
      fallbackRegistered: this.fallbackRegistered,
      helperAttempted: this.helperAttempted,
      helperStarted: this.helperStarted,
      helperVerified: this.helperVerified,
      helperLastStderr: this.nativeLastInfo,
      helperListenAccess: this.helperListenAccess,
      helperEventTapCreated: this.helperEventTapCreated,
      nativeActive: this.nativeActive,
      nativeHelperPath: this.nativeHelperPath ?? options.nativeHelperPath,
      nativeHelperSignature: options.nativeHelperSignature,
      hotkeyLogPath: options.hotkeyLogPath,
      nativeLastInfo: this.nativeLastInfo,
      nativeExitCode: details.nativeExitCode ?? this.nativeExitCode,
      lastNativeEventAt: this.lastNativeEventAt,
      needsAccessibilityPermission: details.needsAccessibilityPermission,
      appAccessibilityTrusted: options.accessibilityTrusted,
      accessibilityTrusted: options.accessibilityTrusted,
      lastError: details.lastError ?? this.lastError,
      diagnosticMessage: details.diagnosticMessage,
      recommendedAction: details.recommendedAction,
      message: this.fallbackRegistered ? details.message : `${details.message ?? '当前触发键不可用'} 备用快捷键也注册失败。`
    };
  }

  async testAccelerator(options: {
    accelerator: string;
    timeoutMs: number;
    accessibilityTrusted?: boolean;
    nativeHelperPath?: string;
  }): Promise<HotkeyTestResult> {
    this.unregister();
    const matcher = createShortcutMatcher(options.accelerator);
    let handle: NativeKeyListenerHandle | undefined;
    let timer: NodeJS.Timeout | undefined;
    let nativeLastInfo: string | undefined;
    let helperStarted = false;

    return new Promise((resolve) => {
      const finish = (result: HotkeyTestResult) => {
        if (timer) {
          clearTimeout(timer);
          timer = undefined;
        }
        if (handle) {
          handle.remove();
          handle.kill();
          handle = undefined;
        }
        resolve(result);
      };

      timer = setTimeout(() => {
        finish({
          ok: false,
          accelerator: options.accelerator,
          nativeHelperPath: options.nativeHelperPath,
          nativeLastInfo,
          helperStarted,
          helperVerified: false,
          helperLastStderr: nativeLastInfo,
          diagnosticMessage: helperPermissionDiagnostic(options.nativeHelperPath),
          recommendedAction: 'grant-native-helper-accessibility'
        });
      }, options.timeoutMs);

      void this.nativeFactory
        .addListener(
          (event, down) => {
            if (event.name && matcher({ name: event.name, state: event.state }, down)) {
              finish({
                ok: true,
                accelerator: options.accelerator,
                eventName: event.name,
                nativeHelperPath: options.nativeHelperPath,
                nativeLastInfo,
                helperStarted: true,
                helperVerified: true,
                helperLastStderr: nativeLastInfo,
                recommendedAction: 'none'
              });
              return true;
            }
            return false;
          },
          (error) => {
            finish({
              ok: false,
              accelerator: options.accelerator,
              nativeHelperPath: options.nativeHelperPath,
              nativeLastInfo,
              helperStarted,
              helperVerified: false,
              helperLastStderr: nativeLastInfo,
              nativeExitCode: exitCodeFromError(error),
              error: stringifyError(error),
              diagnosticMessage: `系统监听组件不可用。${helperPermissionDiagnostic(options.nativeHelperPath)}`,
              recommendedAction: 'grant-native-helper-accessibility'
            });
          },
          (info) => {
            nativeLastInfo = info.trim();
          },
          options.nativeHelperPath
        )
        .then((nextHandle) => {
          helperStarted = true;
          handle = nextHandle;
        })
        .catch((error) => {
          finish({
            ok: false,
            accelerator: options.accelerator,
            nativeHelperPath: options.nativeHelperPath,
            helperStarted: false,
            helperVerified: false,
            error: stringifyError(error),
            diagnosticMessage: `系统监听组件启动失败。${helperPermissionDiagnostic(options.nativeHelperPath)}`,
            recommendedAction: 'grant-native-helper-accessibility'
          });
        });
    });
  }

  private logDiagnostic(
    type: string,
    options: HotkeyServiceOptions,
    details: { stderr?: string; exitCode?: number | null; message?: string } = {}
  ): void {
    this.onDiagnostic?.({
      type,
      helperPath: options.nativeHelperPath,
      signature: options.nativeHelperSignature,
      accelerator: options.accelerator,
      ...details
    });
  }
}

class DefaultNativeKeyListenerFactory implements NativeKeyListenerFactory {
  async addListener(
    callback: IGlobalKeyListener,
    onError: (error: unknown) => void,
    onInfo?: (info: string) => void,
    serverPath?: string
  ): Promise<NativeKeyListenerHandle> {
    patchLegacyUtil();
    const { GlobalKeyboardListener } = require('node-global-key-listener') as typeof import('node-global-key-listener');
    const listener = new GlobalKeyboardListener({
      mac: {
        onError,
        onInfo,
        serverPath
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

function exitCodeFromError(error: unknown): number | null | undefined {
  if (typeof error === 'number' || error === null) {
    return error;
  }
  return undefined;
}

function helperPermissionDiagnostic(nativeHelperPath?: string): string {
  const target = nativeHelperPath ? `监听组件 ${nativeHelperPath}` : 'V2T Keyboard Listener/MacKeyServer';
  return `未收到系统按键事件，请给 ${target} 开启 macOS 辅助功能权限。`;
}

function helperPendingDiagnostic(): string {
  return '监听组件已启动，按一次快捷键完成验证；如果仍无反应，请完全退出 V2T 后重新打开。';
}

function helperFailureDiagnostic(nativeHelperPath?: string, stderr?: string): string {
  const base = isEventTapFailure(stderr)
    ? `系统监听组件 event tap 权限失败：${stderr?.trim()}`
    : stderr?.trim()
      ? `系统监听组件不可用：${stderr.trim()}`
      : `系统监听组件不可用。${helperPermissionDiagnostic(nativeHelperPath)}`;
  return `${base} 如果已添加权限但仍无效，请完全退出 V2T 后重新打开；如果仍失败，移除 MacKeyServer 和 V2T 后重新添加。`;
}

function parseNativeInfo(info: string): Pick<HotkeyStatus, 'helperListenAccess' | 'helperEventTapCreated'> {
  if (info.includes('listen-access=granted') || info.includes('listen-access-request=granted')) {
    return { helperListenAccess: true };
  }
  if (info.includes('listen-access=missing') || info.includes('listen-access-request=denied')) {
    return { helperListenAccess: false };
  }
  if (info.includes('event-tap-created')) {
    return { helperEventTapCreated: true };
  }
  if (isEventTapFailure(info)) {
    return { helperEventTapCreated: false };
  }
  return {};
}

function isEventTapFailure(stderr?: string): boolean {
  return Boolean(stderr?.includes('Unable to create CGEvent tap') || stderr?.includes('event-tap-create-failed'));
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
