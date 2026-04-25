import { app, BrowserWindow, Menu, Tray, clipboard, ipcMain, nativeImage, screen, shell, systemPreferences } from 'electron';
import { join } from 'node:path';
import { hostname } from 'node:os';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { FunAsrHttpProvider, LocalSherpaAsrProvider, UserFacingAsrError, WhisperCppAsrProvider } from '../core/asrProviders';
import { DEFAULT_MODEL_CATALOG, recommendModels } from '../core/modelCatalog';
import { detectHardwareProfile } from '../core/hardware';
import { ModelManager } from '../core/modelManager';
import { GitHubSyncService } from '../core/githubSyncService';
import { OpenAICompatibleClient } from '../core/llmClient';
import { createVoiceInputPipeline } from '../core/pipeline';
import { PostProcessor } from '../core/postProcessor';
import { TextInjectionService } from '../core/textInjection';
import { UserDataStore } from '../core/userDataStore';
import type { InputMode, ModelInstallStatus, ModelStatusRecord, Settings } from '../core/types';
import { getFocusedAppName } from './focusedApp';
import { createCheckingHotkeyStatus } from './hotkeyDiagnostics';
import { HotkeyDiagnosticLog } from './hotkeyDiagnosticLog';
import { HotkeyService, type HotkeyStatus, type HotkeyTestResult } from './hotkeyService';
import { ensureStableMacKeyServer, resolveBundledMacKeyServerPath } from './nativeKeyHelper';
import { OsPasteKeySender } from './osPasteKeySender';
import { SecretStore } from './secretStore';
import { createTrayImage } from './trayIcon';
import { closeShouldHideToTray, quitMenuItemConfig, quitTrayMenuLabel } from './windowLifecycle';
import {
  normalizeRecordingOverlayState,
  recordingOverlayBounds,
  trayTitleForRecordingState,
  type NormalizedRecordingOverlayState,
  type RecordingOverlayUpdate
} from './recordingOverlay';

let mainWindow: BrowserWindow | undefined;
let recordingOverlayWindow: BrowserWindow | undefined;
let recordingOverlayReady: Promise<void> | undefined;
let tray: Tray | undefined;
let store: UserDataStore;
let settings: Settings;
let hotkeyService: HotkeyService;
let hotkeyStatus: HotkeyStatus | undefined;
let isQuitting = false;
let modelRoot: string;
let nativeHelperPath: string | undefined;
let nativeHelperSignature: string | undefined;
let hotkeyLog: HotkeyDiagnosticLog;

app.setName('V2T');

async function bootstrap(): Promise<void> {
  const defaultDataDir = join(app.getPath('userData'), 'sync');
  modelRoot = join(app.getPath('userData'), 'models');
  await mkdir(defaultDataDir, { recursive: true });
  await mkdir(modelRoot, { recursive: true });
  hotkeyLog = new HotkeyDiagnosticLog(join(app.getPath('userData'), 'logs', 'hotkey-helper.log'));
  store = await UserDataStore.create(defaultDataDir, { deviceId: deviceId() });
  settings = await store.loadSettings();
  settings.dataDir = settings.dataDir ?? defaultDataDir;
  await store.saveSettings(settings);

  nativeHelperPath = await setupNativeKeyHelper();
  nativeHelperSignature = nativeHelperPath ? readCodeSignature(nativeHelperPath) : undefined;
  hotkeyService = new HotkeyService({
    onDiagnostic: (event) => {
      void hotkeyLog.write(event).catch((error) => console.warn(`Unable to write hotkey diagnostic log: ${readableError(error)}`));
    }
  });
  createApplicationMenu();
  createWindow();
  createTray();
  registerIpc();
  await registerHotkey();
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 980,
    height: 720,
    minWidth: 820,
    minHeight: 600,
    title: 'V2T',
    show: false,
    backgroundColor: '#f6f4ef',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.on('close', (event) => {
    if (closeShouldHideToTray(isQuitting)) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });
  mainWindow.on('closed', () => {
    mainWindow = undefined;
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    void mainWindow.loadURL(devServerUrl);
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

function createTray(): void {
  tray = new Tray(createTrayImage(process.platform, nativeImage));
  tray.setToolTip('V2T');
  if (process.platform === 'darwin') {
    tray.setTitle('V2T');
  }
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '打开 V2T', click: () => showWindow() },
      {
        label: '打开同步目录',
        click: () => {
          if (settings.dataDir) {
            void shell.openPath(settings.dataDir);
          }
        }
      },
      { type: 'separator' },
      {
        label: quitTrayMenuLabel(),
        click: () => quitApp()
      }
    ])
  );
  tray.on('click', () => showWindow());
}

function createApplicationMenu(): void {
  const quitItem = quitMenuItemConfig();
  const template: Electron.MenuItemConstructorOptions[] =
    process.platform === 'darwin'
      ? [
          {
            label: app.getName(),
            submenu: [
              {
                label: quitItem.label,
                accelerator: quitItem.accelerator,
                click: () => quitApp()
              }
            ]
          }
        ]
      : [
          {
            label: 'V2T',
            submenu: [
              {
                label: quitTrayMenuLabel(),
                click: () => quitApp()
              }
            ]
          }
        ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function registerIpc(): void {
  ipcMain.handle('v2t:get-settings', async () => ({ settings, hotkeyStatus }));
  ipcMain.handle('v2t:get-setup', async () => getSetupPayload());
  ipcMain.handle('v2t:save-settings', async (_event, nextSettings: Settings) => {
    settings = nextSettings;
    await store.saveSettings(settings);
    await registerHotkey();
    return { settings, hotkeyStatus };
  });
  ipcMain.handle('v2t:get-lexicon', async () => store.loadLexicon());
  ipcMain.handle('v2t:save-lexicon', async (_event, lexicon) => {
    try {
      await store.saveLexicon(lexicon);
      return { ok: true, lexicon: await store.loadLexicon() };
    } catch (error) {
      return { ok: false, error: readableError(error) };
    }
  });
  ipcMain.handle('v2t:set-openai-key', async (_event, value: string) => {
    await new SecretStore().setOpenAICompatibleKey(value);
    return { ok: true };
  });
  ipcMain.handle('v2t:update-hotkey', async (_event, accelerator: string) => updateHotkey(accelerator));
  ipcMain.handle('v2t:open-accessibility-settings', async () => {
    await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility');
    return { ok: true };
  });
  ipcMain.handle('v2t:refresh-hotkey-permissions', async () => {
    refreshHotkeyPermissions();
    return getSetupPayload();
  });
  ipcMain.handle('v2t:test-hotkey', async (_event, accelerator?: string) => testHotkey(accelerator ?? settings.hotkey.accelerator));
  ipcMain.handle('v2t:copy-hotkey-diagnostics', async () => {
    clipboard.writeText(createHotkeyDiagnosticText());
    return { ok: true };
  });
  ipcMain.handle('v2t:show-native-helper', async () => {
    if (nativeHelperPath) {
      shell.showItemInFolder(nativeHelperPath);
      return { ok: true };
    }
    return { ok: false };
  });
  ipcMain.handle('v2t:quit-app', async () => {
    quitApp();
    return { ok: true };
  });
  ipcMain.on('v2t:overlay-stop-recording', () => {
    sendRecordingCommand({ type: 'stop', trigger: 'toggle' });
  });
  ipcMain.handle('v2t:set-recording-overlay-state', async (_event, update: RecordingOverlayUpdate) => {
    await applyRecordingOverlayState(normalizeRecordingOverlayState(update));
    return { ok: true };
  });
  ipcMain.handle('v2t:get-sync-status', async () => createSyncService().status());
  ipcMain.handle('v2t:connect-sync-repo', async (_event, repoUrl: string) => connectSyncRepo(repoUrl));
  ipcMain.handle('v2t:pull-sync', async () => pullSync());
  ipcMain.handle('v2t:push-sync', async () => pushSync());
  ipcMain.handle('v2t:install-model', async (event, modelId: string) => {
    const manager = createModelManager();
    const sendProgress = (status: ModelStatusRecord) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send('v2t:model-install-progress', status);
      }
      if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents.id !== event.sender.id) {
        mainWindow.webContents.send('v2t:model-install-progress', status);
      }
    };
    try {
      const status = await manager.installAndActivate(modelId, sendProgress);
      settings = await store.loadSettings();
      return { ok: true, status, setup: await getSetupPayload() };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        setup: await getSetupPayload()
      };
    }
  });
  ipcMain.handle('v2t:activate-model', async (_event, modelId: string) => {
    const manager = createModelManager();
    try {
      const status = await manager.activateInstalledModel(modelId);
      settings = await store.loadSettings();
      return { ok: true, status, setup: await getSetupPayload() };
    } catch (error) {
      return { ok: false, error: readableError(error), setup: await getSetupPayload() };
    }
  });
  ipcMain.handle('v2t:delete-model', async (_event, modelId: string) => {
    const manager = createModelManager();
    try {
      const status = await manager.deleteModel(modelId);
      return { ok: true, status, setup: await getSetupPayload() };
    } catch (error) {
      return { ok: false, error: readableError(error), setup: await getSetupPayload() };
    }
  });
  ipcMain.handle('v2t:process-audio', async (_event, payload: { bytes: Uint8Array; mode: InputMode }) => {
    try {
      const pipeline = await createPipeline();
      const result = await pipeline.handleAudio(Buffer.from(payload.bytes), {
        mode: payload.mode,
        targetApp: await getFocusedAppName()
      });
      return { ok: true, result };
    } catch (error) {
      return { ok: false, error: readableError(error) };
    }
  });
}

async function createPipeline() {
  const apiKey = await new SecretStore().getOpenAICompatibleKey();
  const llm =
    settings.providers.llm.enabled || apiKey
      ? new OpenAICompatibleClient({
          baseUrl: settings.providers.llm.baseUrl,
          model: settings.providers.llm.model,
          apiKey
        })
      : undefined;

  return createVoiceInputPipeline({
    store,
    asr: createAsrProvider(),
    injector: new TextInjectionService({
      clipboard,
      keySender: new OsPasteKeySender()
    }),
    postProcessor: new PostProcessor({ llm })
  });
}

function createAsrProvider() {
  if (settings.providers.asr.kind === 'funasr-http') {
    return new FunAsrHttpProvider({
      endpoint: settings.providers.asr.endpoint ?? 'http://127.0.0.1:10095/transcribe',
      language: settings.providers.asr.language
    });
  }

  if (settings.providers.asr.kind === 'whisper-cpp') {
    return new WhisperCppAsrProvider();
  }

  return new LocalSherpaAsrProvider({
    modelId: settings.providers.asr.modelId,
    modelPath: settings.providers.asr.modelPath,
    sherpaModelType: settings.providers.asr.sherpaModelType,
    language: settings.providers.asr.language
  });
}

async function applyRecordingOverlayState(state: NormalizedRecordingOverlayState): Promise<void> {
  if (process.platform === 'darwin') {
    tray?.setTitle(trayTitleForRecordingState(state));
  }

  if (!state.visible) {
    recordingOverlayWindow?.hide();
    return;
  }

  const overlay = await ensureRecordingOverlayWindow();
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  overlay.setBounds(recordingOverlayBounds(display.workArea));
  overlay.showInactive();
  await overlay.webContents.executeJavaScript(`window.setV2TOverlayState(${JSON.stringify(state)})`);
}

async function ensureRecordingOverlayWindow(): Promise<BrowserWindow> {
  if (recordingOverlayWindow && !recordingOverlayWindow.isDestroyed()) {
    await recordingOverlayReady;
    return recordingOverlayWindow;
  }

  recordingOverlayWindow = new BrowserWindow({
    width: 280,
    height: 60,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    closable: false,
    focusable: false,
    acceptFirstMouse: true,
    show: false,
    hasShadow: false,
    webPreferences: {
      preload: join(__dirname, '../preload/overlay.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  recordingOverlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  recordingOverlayWindow.setAlwaysOnTop(true, 'floating');
  recordingOverlayWindow.on('closed', () => {
    recordingOverlayWindow = undefined;
    recordingOverlayReady = undefined;
  });

  recordingOverlayReady = new Promise((resolve) => {
    recordingOverlayWindow?.webContents.once('did-finish-load', () => resolve());
  });
  await recordingOverlayWindow.loadURL(recordingOverlayHtmlUrl());
  await recordingOverlayReady;
  return recordingOverlayWindow;
}

async function registerHotkey(): Promise<void> {
  hotkeyStatus = await hotkeyService.register({
    accelerator: settings.hotkey.accelerator,
    fallbackAccelerator: settings.hotkey.fallbackAccelerator,
    longPressMs: settings.hotkey.longPressMs,
    accessibilityTrusted: getAccessibilityTrusted(),
    nativeHelperPath,
    nativeHelperSignature,
    hotkeyLogPath: hotkeyLog.getPath(),
    onAction: sendHotkeyAction,
    onStatus: (status) => {
      setHotkeyStatus(status);
    }
  });
}

function refreshHotkeyPermissions(): void {
  setHotkeyStatus(
    createCheckingHotkeyStatus({
      accelerator: settings.hotkey.accelerator,
      fallbackAccelerator: settings.hotkey.fallbackAccelerator,
      accessibilityTrusted: getAccessibilityTrusted(),
      nativeHelperPath,
      nativeHelperSignature,
      hotkeyLogPath: hotkeyLog.getPath()
    })
  );
  void registerHotkey().catch((error) => {
    setHotkeyStatus({
      backend: 'electron-shortcut',
      registered: false,
      requestedAccelerator: settings.hotkey.accelerator,
      activeAccelerator: settings.hotkey.fallbackAccelerator ?? settings.hotkey.accelerator,
      fallbackAccelerator: settings.hotkey.fallbackAccelerator,
      fallbackRegistered: false,
      helperAttempted: false,
      helperStarted: false,
      helperVerified: false,
      nativeActive: false,
      nativeHelperPath,
      nativeHelperSignature,
      hotkeyLogPath: hotkeyLog.getPath(),
      appAccessibilityTrusted: getAccessibilityTrusted(),
      accessibilityTrusted: getAccessibilityTrusted(),
      lastError: readableError(error),
      diagnosticMessage: '系统键盘监听重新检测失败。',
      recommendedAction: 'grant-native-helper-accessibility',
      message: readableError(error)
    });
  });
}

async function testHotkey(accelerator: string): Promise<HotkeyTestResult> {
  setHotkeyStatus(
    createCheckingHotkeyStatus({
      accelerator,
      fallbackAccelerator: settings.hotkey.fallbackAccelerator,
      accessibilityTrusted: getAccessibilityTrusted(),
      nativeHelperPath,
      nativeHelperSignature,
      hotkeyLogPath: hotkeyLog.getPath(),
      diagnosticMessage: `请在 5 秒内按下 ${accelerator}。`
    })
  );
  const result = await hotkeyService.testAccelerator({
    accelerator,
    timeoutMs: 5000,
    accessibilityTrusted: getAccessibilityTrusted(),
    nativeHelperPath
  });
  setHotkeyStatus(hotkeyStatusFromTestResult(result));
  await registerHotkey();
  return result;
}

function hotkeyStatusFromTestResult(result: HotkeyTestResult): HotkeyStatus {
  const appAccessibilityTrusted = getAccessibilityTrusted();
  if (result.ok) {
    return {
      backend: 'native-listener',
      registered: true,
      requestedAccelerator: result.accelerator,
      activeAccelerator: result.accelerator,
      fallbackAccelerator: settings.hotkey.fallbackAccelerator,
      fallbackRegistered: true,
      helperAttempted: true,
      helperStarted: true,
      helperVerified: true,
      helperLastStderr: result.helperLastStderr,
      nativeActive: true,
      nativeHelperPath,
      nativeHelperSignature,
      hotkeyLogPath: hotkeyLog.getPath(),
      nativeLastInfo: result.nativeLastInfo,
      lastNativeEventAt: Date.now(),
      appAccessibilityTrusted,
      accessibilityTrusted: appAccessibilityTrusted,
      diagnosticMessage: `已收到 ${result.eventName ?? '系统按键事件'}。`,
      recommendedAction: 'none',
      message: `已收到 ${result.eventName ?? '系统按键事件'}。`
    };
  }

  return {
    backend: 'electron-shortcut',
    registered: Boolean(settings.hotkey.fallbackAccelerator),
    requestedAccelerator: result.accelerator,
    activeAccelerator: settings.hotkey.fallbackAccelerator ?? result.accelerator,
    fallbackAccelerator: settings.hotkey.fallbackAccelerator,
    fallbackRegistered: Boolean(settings.hotkey.fallbackAccelerator),
    helperAttempted: true,
    helperStarted: result.helperStarted,
    helperVerified: false,
    helperLastStderr: result.helperLastStderr,
    nativeActive: false,
    nativeHelperPath,
    nativeHelperSignature,
    hotkeyLogPath: hotkeyLog.getPath(),
    nativeLastInfo: result.nativeLastInfo,
    nativeExitCode: result.nativeExitCode,
    needsAccessibilityPermission: true,
    appAccessibilityTrusted,
    accessibilityTrusted: appAccessibilityTrusted,
    lastError: result.error,
    diagnosticMessage: result.diagnosticMessage,
    recommendedAction: result.recommendedAction,
    message: result.diagnosticMessage ?? result.error
  };
}

function setHotkeyStatus(status: HotkeyStatus): void {
  hotkeyStatus = status;
  mainWindow?.webContents.send('v2t:hotkey-status', status);
}

async function getSetupPayload() {
  const hardware = detectHardwareProfile();
  const manager = createModelManager();
  const rawStatuses = await manager.getStatuses();
  const statusMap: Record<string, ModelInstallStatus> = {};
  for (const model of DEFAULT_MODEL_CATALOG) {
    const status = rawStatuses[model.id]?.status;
    statusMap[model.id] = status ?? 'not-installed';
  }

  if (settings.providers.asr.modelId) {
    statusMap[settings.providers.asr.modelId] = 'current';
  }

  return {
    settings,
    hotkeyStatus,
    appInfo: getAppInfo(),
    hardware,
    modelRoot,
    catalog: DEFAULT_MODEL_CATALOG,
    modelStatuses: rawStatuses,
    recommendations: recommendModels(DEFAULT_MODEL_CATALOG, hardware, statusMap),
    installedModels: await manager.listInstalledModelViews(settings)
  };
}

function createModelManager(): ModelManager {
  return new ModelManager({
    modelRoot,
    store,
    catalog: DEFAULT_MODEL_CATALOG
  });
}

function createSyncService(repoUrl = settings.sync.github.repoUrl): GitHubSyncService {
  return new GitHubSyncService({
    dataDir: store.getBaseDir(),
    repoDir: settings.sync.github.localPath ?? join(app.getPath('userData'), 'sync-repo'),
    repoUrl,
    branch: settings.sync.github.branch
  });
}

async function connectSyncRepo(repoUrl: string) {
  try {
    const status = await createSyncService(repoUrl).connect(repoUrl);
    settings = {
      ...settings,
      sync: {
        kind: 'github',
        github: {
          ...settings.sync.github,
          repoUrl,
          localPath: status.localPath,
          branch: status.branch,
          lastSyncAt: new Date().toISOString()
        }
      }
    };
    await store.saveSettings(settings);
    return { ok: true, status, setup: await getSetupPayload() };
  } catch (error) {
    return { ok: false, error: readableError(error), status: await createSyncService(repoUrl).status() };
  }
}

async function pullSync() {
  try {
    const status = await createSyncService().pull();
    settings = {
      ...(await store.loadSettings()),
      sync: {
        kind: 'github',
        github: {
          ...settings.sync.github,
          lastSyncAt: new Date().toISOString()
        }
      }
    };
    await store.saveSettings(settings);
    return { ok: true, status, setup: await getSetupPayload() };
  } catch (error) {
    return { ok: false, error: readableError(error), status: await createSyncService().status() };
  }
}

async function pushSync() {
  try {
    const status = await createSyncService().push('sync: update v2t settings');
    settings = {
      ...settings,
      sync: {
        kind: 'github',
        github: {
          ...settings.sync.github,
          lastSyncAt: new Date().toISOString()
        }
      }
    };
    await store.saveSettings(settings);
    return { ok: true, status, setup: await getSetupPayload() };
  } catch (error) {
    return { ok: false, error: readableError(error), status: await createSyncService().status() };
  }
}

async function updateHotkey(accelerator: string) {
  const previous = settings;
  settings = {
    ...settings,
    hotkey: {
      ...settings.hotkey,
      accelerator
    }
  };
  await store.saveSettings(settings);
  const status = await hotkeyService.register({
    accelerator: settings.hotkey.accelerator,
    fallbackAccelerator: settings.hotkey.fallbackAccelerator,
    longPressMs: settings.hotkey.longPressMs,
    accessibilityTrusted: getAccessibilityTrusted(),
    nativeHelperPath,
    nativeHelperSignature,
    hotkeyLogPath: hotkeyLog.getPath(),
    onAction: sendHotkeyAction,
    onStatus: (nextStatus) => {
      setHotkeyStatus(nextStatus);
    }
  });
  hotkeyStatus = status;

  if (!status.registered) {
    settings = previous;
    await store.saveSettings(settings);
    await registerHotkey();
    return { ok: false, settings, hotkeyStatus, error: status.message ?? '快捷键注册失败，请换一个组合键。' };
  }

  return { ok: true, settings, hotkeyStatus };
}

function getAccessibilityTrusted(): boolean {
  return process.platform !== 'darwin' || systemPreferences.isTrustedAccessibilityClient(false);
}

async function setupNativeKeyHelper(): Promise<string | undefined> {
  if (process.platform !== 'darwin') {
    return undefined;
  }

  const bundledPath = await resolveBundledMacKeyServerPath(__dirname);
  try {
    return await ensureStableMacKeyServer(bundledPath, app.getPath('userData'));
  } catch (error) {
    console.warn(`Unable to install stable MacKeyServer helper: ${readableError(error)}`);
    return bundledPath;
  }
}

function readCodeSignature(filePath: string): string | undefined {
  const result = spawnSync('codesign', ['-dv', '--verbose=4', filePath], { encoding: 'utf8' });
  const text = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim();
  const cdHash = text.match(/^CDHash=.+$/m)?.[0];
  const signature = text.match(/^Signature=.+$/m)?.[0];
  return [cdHash, signature].filter(Boolean).join(' · ') || text || undefined;
}

function createHotkeyDiagnosticText(): string {
  const status = hotkeyStatus;
  return [
    'V2T hotkey diagnostics',
    `version: ${app.getVersion()}`,
    `requested: ${status?.requestedAccelerator ?? settings.hotkey.accelerator}`,
    `active: ${status?.activeAccelerator ?? 'unknown'}`,
    `fallback: ${status?.fallbackAccelerator ?? settings.hotkey.fallbackAccelerator ?? 'none'}`,
    `helperPath: ${nativeHelperPath ?? 'none'}`,
    `helperSignature: ${nativeHelperSignature ?? 'unknown'}`,
    `helperStarted: ${String(status?.helperStarted ?? false)}`,
    `helperVerified: ${String(status?.helperVerified ?? false)}`,
    `helperListenAccess: ${String(status?.helperListenAccess ?? 'unknown')}`,
    `helperEventTapCreated: ${String(status?.helperEventTapCreated ?? 'unknown')}`,
    `lastNativeEventAt: ${status?.lastNativeEventAt ? new Date(status.lastNativeEventAt).toISOString() : 'none'}`,
    `exitCode: ${String(status?.nativeExitCode ?? 'none')}`,
    `stderr: ${status?.helperLastStderr ?? status?.nativeLastInfo ?? 'none'}`,
    `logPath: ${hotkeyLog.getPath()}`,
    'tccCommand: log stream --debug --predicate \'subsystem == "com.apple.TCC" AND eventMessage CONTAINS "V2T"\'',
    'nextAction: 完全退出 V2T；在 Accessibility 中移除 V2T 和 MacKeyServer 后重新添加；再打开新版 V2T。'
  ].join('\n');
}

function getAppInfo(): { version: string; buildCommit: string } {
  const fallback = { version: app.getVersion(), buildCommit: process.env.V2T_BUILD_COMMIT ?? 'dev' };
  const buildInfoPath = join(app.getAppPath(), 'dist', 'build-info.json');
  if (!existsSync(buildInfoPath)) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(readFileSync(buildInfoPath, 'utf8')) as Partial<typeof fallback>;
    return {
      version: parsed.version ?? fallback.version,
      buildCommit: parsed.buildCommit ?? fallback.buildCommit
    };
  } catch {
    return fallback;
  }
}

function readableError(error: unknown): string {
  if (error instanceof UserFacingAsrError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function showWindow(): void {
  if (!mainWindow) {
    return;
  }

  mainWindow.show();
  mainWindow.focus();
}

function sendHotkeyAction(action: { type: 'start-recording' | 'stop-recording'; mode: 'toggle' | 'hold' }): void {
  if (action.type === 'start-recording') {
    sendRecordingCommand({ type: 'start', trigger: action.mode });
  } else {
    sendRecordingCommand({ type: 'stop', trigger: action.mode });
  }
}

function sendRecordingCommand(command: { type: 'start' | 'stop'; trigger: 'toggle' | 'hold' }): void {
  mainWindow?.webContents.send('v2t:recording-command', command);
}

function quitApp(): void {
  isQuitting = true;
  cleanupAppResources();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.destroy();
  }
  app.quit();
}

function cleanupAppResources(): void {
  hotkeyService?.unregister();
  if (recordingOverlayWindow && !recordingOverlayWindow.isDestroyed()) {
    recordingOverlayWindow.destroy();
  }
  recordingOverlayWindow = undefined;
  recordingOverlayReady = undefined;
  tray?.destroy();
  tray = undefined;
}

function recordingOverlayHtmlUrl(): string {
  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    * { box-sizing: border-box; }
    html, body { width: 100%; height: 100%; margin: 0; background: transparent; overflow: hidden; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .overlay { width: 280px; height: 60px; display: flex; align-items: center; gap: 11px; padding: 10px 14px; border: 1px solid rgba(255, 250, 240, 0.1); border-radius: 15px; background: rgba(31, 39, 36, 0.92); color: #fffaf0; box-shadow: 0 14px 30px rgba(0, 0, 0, 0.22); cursor: pointer; user-select: none; }
    .overlay:active { transform: translateY(1px); }
    .status-dot { width: 8px; height: 8px; border-radius: 999px; background: #d84d3f; box-shadow: 0 0 0 5px rgba(216, 77, 63, 0.16); flex: 0 0 auto; }
    .processing .status-dot { background: #2e6f95; box-shadow: 0 0 0 5px rgba(46, 111, 149, 0.14); }
    .waves { width: 42px; height: 26px; display: flex; align-items: center; justify-content: center; gap: 3px; flex: 0 0 auto; }
    .bar { width: 3px; min-height: 4px; border-radius: 999px; background: rgba(255, 250, 240, 0.78); transition: height 90ms ease, opacity 120ms ease; }
    .no-input .bar { opacity: 0.32; }
    .processing .bar { height: 11px !important; opacity: 0.45; }
    .text { min-width: 0; display: grid; gap: 2px; flex: 1; }
    .title { font-weight: 720; font-size: 13px; letter-spacing: 0; line-height: 1.2; }
    .meta { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: rgba(255, 250, 240, 0.68); font-size: 11px; line-height: 1.3; }
  </style>
</head>
<body>
  <div id="overlay" class="overlay" role="button" aria-label="停止录音" title="停止录音">
    <div class="status-dot"></div>
    <div class="waves" aria-hidden="true">
      <span class="bar"></span>
      <span class="bar"></span>
      <span class="bar"></span>
      <span class="bar"></span>
      <span class="bar"></span>
    </div>
    <div class="text">
      <div id="title" class="title">录音中</div>
      <div id="meta" class="meta">自然输入 · 00:00</div>
    </div>
  </div>
  <script>
    function formatElapsed(ms) {
      const total = Math.max(0, Math.floor(ms / 1000));
      const minutes = String(Math.floor(total / 60)).padStart(2, '0');
      const seconds = String(total % 60).padStart(2, '0');
      return minutes + ':' + seconds;
    }
    const overlay = document.getElementById('overlay');
    overlay.addEventListener('click', function() {
      window.v2tOverlay && window.v2tOverlay.stopRecording && window.v2tOverlay.stopRecording();
    });
    window.setV2TOverlayState = function(state) {
      const title = document.getElementById('title');
      const meta = document.getElementById('meta');
      const bars = Array.from(document.querySelectorAll('.bar'));
      const level = Math.max(0, Math.min(1, state.level || 0));
      const inputActive = Boolean(state.inputActive);
      overlay.className = 'overlay ' + state.state + (inputActive ? ' input-active' : ' no-input');
      title.textContent = state.state === 'processing' ? '正在整理' : '正在录音';
      const mode = state.mode === 'structured' ? '结构输入' : '自然输入';
      if (state.state === 'recording' && !inputActive && (state.silenceMs || 0) > 1800) {
        meta.textContent = '未检测到明显声音 · ' + formatElapsed(state.elapsedMs || 0);
      } else {
        meta.textContent = mode + ' · ' + formatElapsed(state.elapsedMs || 0);
      }
      const weights = [0.45, 0.86, 0.58, 1, 0.68];
      bars.forEach(function(bar, index) {
        const height = 5 + Math.round(level * 18 * weights[index]);
        bar.style.height = height + 'px';
      });
    };
  </script>
</body>
</html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function deviceId(): string {
  return hostname().replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 48) || 'device';
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.whenReady().then(() => {
    void bootstrap().then(showWindow);
  });

  app.on('second-instance', () => {
    showWindow();
  });
}

app.on('activate', () => {
  if (!mainWindow) {
    createWindow();
  }
  showWindow();
});

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('will-quit', () => {
  cleanupAppResources();
});
