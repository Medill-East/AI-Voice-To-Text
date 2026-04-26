import { app, BrowserWindow, Menu, Tray, clipboard, dialog, ipcMain, nativeImage, screen, shell, systemPreferences } from 'electron';
import { dirname, join } from 'node:path';
import { hostname } from 'node:os';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { autoUpdater } from 'electron-updater';
import { FunAsrHttpProvider, LocalSherpaAsrProvider, UserFacingAsrError, WhisperCppAsrProvider } from '../core/asrProviders';
import { AppUpdateService } from '../core/appUpdateService';
import { AutoSyncService } from '../core/autoSyncService';
import { checkManualMacUpdate, macDownloadUrlFromState, type GitHubReleaseLike } from '../core/manualAppUpdate';
import { DEFAULT_MODEL_CATALOG, recommendModels } from '../core/modelCatalog';
import { DEFAULT_REMOTE_MODEL_CATALOG_URL, ModelCatalogRefreshService } from '../core/modelCatalogRefresh';
import { detectHardwareProfile } from '../core/hardware';
import { ModelManager } from '../core/modelManager';
import { GitHubSyncService } from '../core/githubSyncService';
import { OpenAICompatibleClient } from '../core/llmClient';
import { createVoiceInputPipeline } from '../core/pipeline';
import { PostProcessor } from '../core/postProcessor';
import { TextInjectionService } from '../core/textInjection';
import { UserDataStore } from '../core/userDataStore';
import type {
  AppUpdateState,
  AutoSyncState,
  InputMode,
  ModelCatalogItem,
  ModelCatalogRefreshState,
  ModelInstallStatus,
  ModelStatusRecord,
  ProcessingDiagnostic,
  SyncImportStrategy,
  Settings
} from '../core/types';
import { getFocusedAppName } from './focusedApp';
import { createCheckingHotkeyStatus } from './hotkeyDiagnostics';
import { HotkeyDiagnosticLog } from './hotkeyDiagnosticLog';
import { HotkeyService, type HotkeyStatus, type HotkeyTestResult } from './hotkeyService';
import {
  bundledWinKeyServerPath,
  cleanupStaleWinKeyServerProcesses,
  cleanupStableWinKeyServer,
  ensureStableMacKeyServer,
  resolveBundledV2TKeyboardListenerPath,
  resolveBundledMacKeyServerPath,
  stableV2TKeyboardListenerPath,
  stableWinKeyServerPath,
  type WindowsKeyServerCleanupResult
} from './nativeKeyHelper';
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
let nativeHelperSourcePath: string | undefined;
let nativeHelperStablePath: string | undefined;
let helperFileExists: boolean | undefined;
let helperRepairAttempted: boolean | undefined;
let helperRepairError: string | undefined;
let staleHelperCount: number | undefined;
let staleHelperKilled: number | undefined;
let nativeHelperSignature: string | undefined;
let hotkeyLog: HotkeyDiagnosticLog;
let autoSyncService: AutoSyncService;
let autoSyncState: AutoSyncState = { status: 'idle', updatedAt: new Date().toISOString() };
let appUpdateService: AppUpdateService;
let appUpdateState: AppUpdateState;
let modelCatalog: ModelCatalogItem[] = DEFAULT_MODEL_CATALOG;
let modelCatalogRefreshService: ModelCatalogRefreshService;
let modelCatalogRefreshState: ModelCatalogRefreshState = {
  status: 'idle',
  sourceUrl: DEFAULT_REMOTE_MODEL_CATALOG_URL,
  message: '使用内置模型榜单'
};
let lastProcessingDiagnostic: ProcessingDiagnostic | undefined;
const RELEASE_PAGE_URL = 'https://github.com/Medill-East/AI-Voice-To-Text/releases/latest';
const LATEST_RELEASE_API_URL = 'https://api.github.com/repos/Medill-East/AI-Voice-To-Text/releases/latest';

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
  lastProcessingDiagnostic = await readProcessingMarker();

  nativeHelperPath = await setupNativeKeyHelper();
  nativeHelperSignature = nativeHelperPath ? readCodeSignature(nativeHelperPath) : undefined;
  modelCatalogRefreshService = new ModelCatalogRefreshService({
    cachePath: join(app.getPath('userData'), 'model-catalog-cache.json')
  });
  const cachedCatalog = await modelCatalogRefreshService.loadCachedCatalog(DEFAULT_MODEL_CATALOG);
  modelCatalog = cachedCatalog.catalog;
  modelCatalogRefreshState = cachedCatalog.state;
  appUpdateService = createAppUpdateService();
  appUpdateState = appUpdateService.getState();
  autoUpdater.autoDownload = settings.updates.autoDownload;
  await createModelManager().recoverInterruptedInstalls();
  hotkeyService = new HotkeyService({
    onDiagnostic: (event) => {
      void hotkeyLog.write(event).catch((error) => console.warn(`Unable to write hotkey diagnostic log: ${readableError(error)}`));
    }
  });
  autoSyncService = createAutoSyncService();
  createApplicationMenu();
  createWindow();
  createTray();
  registerIpc();
  cleanupStaleHotkeyHelpers();
  await registerHotkey();
  void refreshModelCatalog('startup');
  if (settings.updates.autoCheck) {
    setTimeout(() => void checkForAppUpdates(), 3000);
  }
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
  const editMenu: Electron.MenuItemConstructorOptions = {
    label: 'Edit',
    submenu: [
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { type: 'separator' },
      { role: 'selectAll' }
    ]
  };
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
          },
          editMenu
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
          },
          editMenu
        ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function registerIpc(): void {
  ipcMain.on('v2t:show-edit-menu', (event) => {
    const targetWindow = BrowserWindow.fromWebContents(event.sender);
    const menu = Menu.buildFromTemplate([
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { type: 'separator' },
      { role: 'selectAll' }
    ]);
    if (targetWindow) {
      menu.popup({ window: targetWindow });
    } else {
      menu.popup();
    }
  });
  ipcMain.handle('v2t:get-settings', async () => ({ settings, hotkeyStatus }));
  ipcMain.handle('v2t:get-setup', async () => getSetupPayload());
  ipcMain.handle('v2t:save-settings', async (_event, nextSettings: Settings) => {
    settings = nextSettings;
    await store.saveSettings(settings);
    autoUpdater.autoDownload = settings.updates.autoDownload;
    await registerHotkey();
    scheduleAutoSync('settings-save');
    return { settings, hotkeyStatus };
  });
  ipcMain.handle('v2t:get-lexicon', async () => store.loadLexicon());
  ipcMain.handle('v2t:get-history', async (_event, limit?: number) => store.readRecentHistory(limit ?? 30));
  ipcMain.handle('v2t:get-prompts', async () => store.loadPrompts());
  ipcMain.handle('v2t:save-prompt', async (_event, mode: InputMode, content: string) => {
    try {
      await store.savePrompt(mode, content);
      scheduleAutoSync('prompt-save');
      return { ok: true, prompts: await store.loadPrompts() };
    } catch (error) {
      return { ok: false, error: readableError(error) };
    }
  });
  ipcMain.handle('v2t:reset-prompt', async (_event, mode: InputMode) => {
    try {
      await store.resetPrompt(mode);
      scheduleAutoSync('prompt-reset');
      return { ok: true, prompts: await store.loadPrompts() };
    } catch (error) {
      return { ok: false, error: readableError(error) };
    }
  });
  ipcMain.handle('v2t:save-lexicon', async (_event, lexicon) => {
    try {
      await store.saveLexicon(lexicon);
      scheduleAutoSync('lexicon-save');
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
    if (process.platform !== 'darwin') {
      return { ok: false };
    }
    await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility');
    return { ok: true };
  });
  ipcMain.handle('v2t:refresh-hotkey-permissions', async () => {
    await refreshHotkeyPermissions();
    return getSetupPayload();
  });
  ipcMain.handle('v2t:test-hotkey', async (_event, accelerator?: string) => testHotkey(accelerator ?? settings.hotkey.accelerator));
  ipcMain.handle('v2t:refresh-model-catalog', async () => refreshModelCatalog('manual'));
  ipcMain.handle('v2t:copy-model-catalog-diagnostics', async () => {
    clipboard.writeText(createModelCatalogDiagnosticText());
    return { ok: true };
  });
  ipcMain.handle('v2t:check-for-updates', async () => checkForAppUpdates());
  ipcMain.handle('v2t:download-update', async () => downloadAppUpdate());
  ipcMain.handle('v2t:install-update', async () => installAppUpdate());
  ipcMain.handle('v2t:copy-app-update-diagnostics', async () => {
    clipboard.writeText(createAppUpdateDiagnosticText());
    return { ok: true };
  });
  ipcMain.handle('v2t:open-release-page', async () => {
    await shell.openExternal(RELEASE_PAGE_URL);
    return { ok: true };
  });
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
  ipcMain.handle('v2t:repair-hotkey-helper', async () => repairHotkeyHelper());
  ipcMain.handle('v2t:cleanup-stale-hotkey-helpers', async () => cleanupStaleHotkeyHelpersAndRestart());
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
  ipcMain.handle('v2t:choose-sync-repo-path', async () => chooseSyncRepoPath());
  ipcMain.handle('v2t:connect-sync-repo', async (_event, repoUrl: string) => connectSyncRepo(repoUrl));
  ipcMain.handle('v2t:resolve-sync-import', async (_event, strategy: SyncImportStrategy) => resolveSyncImport(strategy));
  ipcMain.handle('v2t:pull-sync', async () => pullSync());
  ipcMain.handle('v2t:push-sync', async () => pushSync());
  ipcMain.handle('v2t:sync-all', async () => syncAll());
  ipcMain.handle('v2t:list-conflict-backups', async () => store.listConflicts());
  ipcMain.handle('v2t:copy-processing-diagnostics', async () => {
    clipboard.writeText(JSON.stringify(lastProcessingDiagnostic ?? (await readProcessingMarker()) ?? {}, null, 2));
    return { ok: true };
  });
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
  ipcMain.handle('v2t:reinstall-model', async (event, modelId: string) => {
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
      const status = await manager.reinstallModel(modelId, sendProgress);
      settings = await store.loadSettings();
      return { ok: true, status, setup: await getSetupPayload() };
    } catch (error) {
      return { ok: false, error: readableError(error), setup: await getSetupPayload() };
    }
  });
  ipcMain.handle('v2t:cancel-model-install', async (_event, modelId: string) => {
    const manager = createModelManager();
    try {
      const status = await manager.cancelModelInstall(modelId);
      return { ok: true, status, setup: await getSetupPayload() };
    } catch (error) {
      return { ok: false, error: readableError(error), setup: await getSetupPayload() };
    }
  });
  ipcMain.handle('v2t:import-model-archive', async (_event, modelId: string, filePath?: string) => {
    const manager = createModelManager();
    try {
      const selectedPath = filePath || (await chooseModelArchivePath());
      if (!selectedPath) {
        return { ok: false, error: '已取消导入模型。', setup: await getSetupPayload() };
      }
      const status = await manager.importModelArchive(modelId, selectedPath);
      return { ok: true, status, setup: await getSetupPayload() };
    } catch (error) {
      return { ok: false, error: readableError(error), setup: await getSetupPayload() };
    }
  });
  ipcMain.handle('v2t:import-model-directory', async (_event, modelId: string, directoryPath?: string) => {
    const manager = createModelManager();
    try {
      const selectedPath = directoryPath || (await chooseModelDirectoryPath());
      if (!selectedPath) {
        return { ok: false, error: '已取消导入模型。', setup: await getSetupPayload() };
      }
      const status = await manager.importModelDirectory(modelId, selectedPath);
      return { ok: true, status, setup: await getSetupPayload() };
    } catch (error) {
      return { ok: false, error: readableError(error), setup: await getSetupPayload() };
    }
  });
  ipcMain.handle('v2t:clear-model-install', async (_event, modelId: string) => {
    const manager = createModelManager();
    try {
      const status = await manager.clearModelInstall(modelId);
      return { ok: true, status, setup: await getSetupPayload() };
    } catch (error) {
      return { ok: false, error: readableError(error), setup: await getSetupPayload() };
    }
  });
  ipcMain.handle('v2t:test-model-download', async (_event, modelId: string) => createModelManager().probeModelDownload(modelId));
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
    const diagnostic = createProcessingDiagnostic(payload);
    try {
      await writeProcessingMarker(diagnostic);
      const pipeline = await createPipeline();
      const result = await pipeline.handleAudio(Buffer.from(payload.bytes), {
        mode: payload.mode,
        targetApp: await getFocusedAppName(),
        prompt: await store.readPrompt(payload.mode)
      });
      await clearProcessingMarker();
      scheduleAutoSync('voice-input');
      return { ok: true, result };
    } catch (error) {
      await writeProcessingMarker({ ...diagnostic, stage: 'failed', error: readableError(error) }).catch(() => undefined);
      await clearProcessingMarker().catch(() => undefined);
      return { ok: false, error: readableError(error) };
    }
  });
}

async function createPipeline() {
  const apiKey = await new SecretStore().getOpenAICompatibleKey();
  const llm =
    settings.providers.llm.enabled
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
    width: 220,
    height: 52,
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
  hotkeyService.unregister();
  await prepareNativeHelperForHotkey();
  cleanupStaleHotkeyHelpers();
  hotkeyStatus = await hotkeyService.register({
    accelerator: settings.hotkey.accelerator,
    fallbackAccelerator: settings.hotkey.fallbackAccelerator,
    longPressMs: settings.hotkey.longPressMs,
    singleClickMode: settings.hotkey.singleClickMode,
    doubleClickMode: settings.hotkey.doubleClickMode,
    platform: process.platform,
    accessibilityTrusted: getAccessibilityTrusted(),
    nativeHelperPath,
    nativeHelperSourcePath,
    nativeHelperSignature,
    hotkeyLogPath: hotkeyLog.getPath(),
    helperFileExists,
    repairAttempted: helperRepairAttempted,
    repairError: helperRepairError,
    staleHelperCount,
    staleHelperKilled,
    onAction: sendHotkeyAction,
    onStatus: (status) => {
      setHotkeyStatus(status);
    }
  });
}

async function refreshHotkeyPermissions(): Promise<void> {
  hotkeyService.unregister();
  await prepareNativeHelperForHotkey();
  cleanupStaleHotkeyHelpers();
  setHotkeyStatus(
    createCheckingHotkeyStatus({
      accelerator: settings.hotkey.accelerator,
      fallbackAccelerator: settings.hotkey.fallbackAccelerator,
      platform: process.platform,
      accessibilityTrusted: getAccessibilityTrusted(),
      nativeHelperPath,
      nativeHelperSourcePath,
      nativeHelperSignature,
      hotkeyLogPath: hotkeyLog.getPath(),
      helperFileExists,
      repairAttempted: helperRepairAttempted,
      repairError: helperRepairError,
      staleHelperCount,
      staleHelperKilled
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
      platform: process.platform,
      permissionKind: hotkeyPermissionKind(process.platform, settings.hotkey.accelerator),
      helperAttempted: false,
      helperStarted: false,
      helperVerified: false,
      nativeActive: false,
      nativeHelperPath,
      helperSourcePath: nativeHelperSourcePath,
      helperFileExists,
      repairAttempted: helperRepairAttempted,
      repairError: helperRepairError,
      staleHelperCount,
      staleHelperKilled,
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
  await prepareNativeHelperForHotkey();
  setHotkeyStatus(
    createCheckingHotkeyStatus({
      accelerator,
      fallbackAccelerator: settings.hotkey.fallbackAccelerator,
      platform: process.platform,
      accessibilityTrusted: getAccessibilityTrusted(),
      nativeHelperPath,
      nativeHelperSourcePath,
      nativeHelperSignature,
      hotkeyLogPath: hotkeyLog.getPath(),
      helperFileExists,
      repairAttempted: helperRepairAttempted,
      repairError: helperRepairError,
      staleHelperCount,
      staleHelperKilled,
      diagnosticMessage: `请在 5 秒内按下 ${accelerator}。`
    })
  );
  const result = await hotkeyService.testAccelerator({
    accelerator,
    timeoutMs: 5000,
    platform: process.platform,
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
      platform: process.platform,
      permissionKind: hotkeyPermissionKind(process.platform, result.accelerator),
      helperAttempted: true,
      helperStarted: true,
      helperVerified: true,
      helperLastStderr: result.helperLastStderr,
      nativeActive: true,
      nativeHelperPath,
      helperSourcePath: nativeHelperSourcePath,
      helperFileExists,
      repairAttempted: helperRepairAttempted,
      repairError: helperRepairError,
      staleHelperCount,
      staleHelperKilled,
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
    platform: process.platform,
    permissionKind: hotkeyPermissionKind(process.platform, result.accelerator),
    helperAttempted: true,
    helperStarted: result.helperStarted,
    helperVerified: false,
    helperLastStderr: result.helperLastStderr,
    nativeActive: false,
    nativeHelperPath,
    helperSourcePath: nativeHelperSourcePath,
    helperFileExists,
    repairAttempted: helperRepairAttempted,
    repairError: helperRepairError,
    staleHelperCount,
    staleHelperKilled,
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
  for (const model of modelCatalog) {
    const status = rawStatuses[model.id]?.status;
    statusMap[model.id] = status ?? 'not-installed';
  }

  if (settings.providers.asr.modelId) {
    statusMap[settings.providers.asr.modelId] = 'current';
  }

  return {
    settings,
    hotkeyStatus,
    autoSyncState,
    appUpdateState,
    appInfo: getAppInfo(),
    hardware,
    modelRoot,
    catalog: modelCatalog,
    modelCatalogRefresh: modelCatalogRefreshState,
    modelStatuses: rawStatuses,
    recommendations: recommendModels(modelCatalog, hardware, statusMap),
    installedModels: await manager.listInstalledModelViews(settings),
    processingDiagnostic: lastProcessingDiagnostic
  };
}

function processingMarkerPath(): string {
  return join(app.getPath('userData'), 'processing', 'last-processing.json');
}

async function readProcessingMarker(): Promise<ProcessingDiagnostic | undefined> {
  const markerPath = processingMarkerPath();
  if (!existsSync(markerPath)) {
    return undefined;
  }
  try {
    return JSON.parse(await readFile(markerPath, 'utf8')) as ProcessingDiagnostic;
  } catch {
    return undefined;
  }
}

async function writeProcessingMarker(diagnostic: ProcessingDiagnostic): Promise<void> {
  lastProcessingDiagnostic = diagnostic;
  await mkdir(dirname(processingMarkerPath()), { recursive: true });
  await writeFile(processingMarkerPath(), `${JSON.stringify(diagnostic, null, 2)}\n`, 'utf8');
}

async function clearProcessingMarker(): Promise<void> {
  await rm(processingMarkerPath(), { force: true });
  lastProcessingDiagnostic = undefined;
}

function createProcessingDiagnostic(payload: { bytes: Uint8Array; mode: InputMode }): ProcessingDiagnostic {
  const audioDurationSeconds = estimatePcm16WavDurationSeconds(payload.bytes);
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    stage: 'processing',
    mode: payload.mode,
    modelId: settings.providers.asr.modelId,
    modelKind: settings.providers.asr.kind,
    sherpaModelType: settings.providers.asr.sherpaModelType,
    audioBytes: payload.bytes.byteLength,
    audioDurationSeconds,
    chunkCount: audioDurationSeconds ? Math.max(1, Math.ceil(audioDurationSeconds / 20)) : undefined
  };
}

function estimatePcm16WavDurationSeconds(bytes: Uint8Array): number | undefined {
  if (bytes.byteLength < 44) {
    return undefined;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  try {
    if (String.fromCharCode(...bytes.slice(0, 4)) !== 'RIFF' || String.fromCharCode(...bytes.slice(8, 12)) !== 'WAVE') {
      return undefined;
    }
    const channels = view.getUint16(22, true);
    const sampleRate = view.getUint32(24, true);
    const bitsPerSample = view.getUint16(34, true);
    const dataBytes = view.getUint32(40, true);
    const bytesPerSample = Math.max(1, (bitsPerSample / 8) * channels);
    return dataBytes / bytesPerSample / sampleRate;
  } catch {
    return undefined;
  }
}

function createModelManager(): ModelManager {
  return new ModelManager({
    modelRoot,
    store,
    catalog: modelCatalog
  });
}

async function chooseModelArchivePath(): Promise<string | undefined> {
  const options: Electron.OpenDialogOptions = {
    title: '选择已下载的模型压缩包',
    properties: ['openFile'],
    filters: [
      { name: 'Model archives', extensions: ['tar.bz2', 'bz2', 'tar', 'bin', 'onnx'] },
      { name: 'All files', extensions: ['*'] }
    ]
  };
  const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
  return result.canceled ? undefined : result.filePaths[0];
}

async function chooseModelDirectoryPath(): Promise<string | undefined> {
  const options: Electron.OpenDialogOptions = {
    title: '选择已解压的模型目录',
    properties: ['openDirectory']
  };
  const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
  return result.canceled ? undefined : result.filePaths[0];
}

function createAppUpdateService(): AppUpdateService {
  return new AppUpdateService({
    currentVersion: app.getVersion(),
    updater: autoUpdater,
    onStatus: (state) => {
      appUpdateState = state;
      if (state.status === 'checking' || state.status === 'available' || state.status === 'not-available') {
        void persistUpdateSettings({ lastCheckAt: state.updatedAt, lastError: undefined });
      }
      if (state.status === 'error') {
        void persistUpdateSettings({ lastError: state.error });
      }
      mainWindow?.webContents.send('v2t:app-update-status', state);
    }
  });
}

async function checkForAppUpdates(): Promise<AppUpdateState> {
  if (process.platform === 'darwin') {
    appUpdateState = await checkManualMacUpdate({
      currentVersion: app.getVersion(),
      fetchRelease: fetchLatestRelease
    });
    mainWindow?.webContents.send('v2t:app-update-status', appUpdateState);
    if (appUpdateState.status === 'error') {
      await persistUpdateSettings({ lastError: appUpdateState.error });
    } else {
      await persistUpdateSettings({ lastCheckAt: appUpdateState.updatedAt, lastError: undefined });
    }
    return appUpdateState;
  }

  autoUpdater.autoDownload = settings.updates.autoDownload;
  const state = await appUpdateService.checkForUpdates();
  if (state.status === 'error') {
    await persistUpdateSettings({ lastError: state.error });
  } else {
    await persistUpdateSettings({ lastCheckAt: state.updatedAt, lastError: undefined });
  }
  return appUpdateState;
}

async function downloadAppUpdate(): Promise<AppUpdateState> {
  if (process.platform === 'darwin') {
    await shell.openExternal(macDownloadUrlFromState(appUpdateState, RELEASE_PAGE_URL));
    return appUpdateState;
  }
  return appUpdateService.downloadUpdate();
}

function installAppUpdate(): AppUpdateState {
  if (process.platform === 'darwin') {
    void shell.openExternal(macDownloadUrlFromState(appUpdateState, RELEASE_PAGE_URL));
    return appUpdateState;
  }
  return appUpdateService.installUpdate();
}

async function fetchLatestRelease(): Promise<GitHubReleaseLike> {
  const response = await fetch(LATEST_RELEASE_API_URL, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': `V2T/${app.getVersion()}`
    }
  });
  if (!response.ok) {
    throw new Error(`GitHub Release 检查失败：HTTP ${response.status} ${LATEST_RELEASE_API_URL}`);
  }
  return (await response.json()) as GitHubReleaseLike;
}

async function persistUpdateSettings(patch: Partial<Settings['updates']>): Promise<void> {
  settings = {
    ...settings,
    updates: {
      ...settings.updates,
      ...patch
    }
  };
  await store.saveSettings(settings);
}

async function refreshModelCatalog(trigger: 'startup' | 'manual') {
  modelCatalogRefreshState = {
    ...modelCatalogRefreshState,
    status: 'refreshing',
    message: trigger === 'startup' ? '正在后台刷新中文模型榜单' : '正在刷新中文模型榜单'
  };
  void emitModelCatalogRefresh();

  const result = await modelCatalogRefreshService.refresh(DEFAULT_MODEL_CATALOG);
  if (result.state.status === 'success') {
    modelCatalog = result.catalog;
  }
  modelCatalogRefreshState = result.state;
  return emitModelCatalogRefresh();
}

async function emitModelCatalogRefresh() {
  const setup = await getSetupPayload();
  mainWindow?.webContents.send('v2t:model-catalog-refresh', setup);
  return setup;
}

function createSyncService(repoUrl = settings.sync.github.repoUrl): GitHubSyncService {
  const defaultRepoPath = defaultSyncRepoPath();
  return new GitHubSyncService({
    dataDir: store.getBaseDir(),
    repoDir: settings.sync.github.localPath ?? defaultRepoPath,
    repoUrl,
    branch: settings.sync.github.branch,
    includeHistory: settings.sync.github.includeHistory ?? false,
    defaultRepoPath
  });
}

function defaultSyncRepoPath(): string {
  return join(app.getPath('userData'), 'sync-repo');
}

function createAutoSyncService(): AutoSyncService {
  return new AutoSyncService({
    delayMs: 10_000,
    isEnabled: () => Boolean(settings.sync.github.autoSync),
    sync: async () => {
      if (!settings.sync.github.repoUrl || !settings.sync.github.localPath) {
        throw new Error('尚未连接 GitHub 同步仓库');
      }
      const status = await createSyncService().smartSync('sync: auto update v2t archive');
      const syncedAt = new Date().toISOString();
      settings = {
        ...settings,
        sync: {
          kind: 'github',
          github: {
            ...settings.sync.github,
            lastSyncAt: syncedAt,
            lastAutoSyncAt: syncedAt,
            lastAutoSyncError: undefined
          }
        }
      };
      await store.saveSettings(settings);
      return status.message ?? '已自动同步';
    },
    onStatus: async (state) => {
      autoSyncState = state;
      if (state.status === 'failed') {
        settings = {
          ...settings,
          sync: {
            ...settings.sync,
            github: {
              ...settings.sync.github,
              lastAutoSyncError: state.error
            }
          }
        };
        await store.saveSettings(settings);
      }
      mainWindow?.webContents.send('v2t:auto-sync-status', autoSyncState);
    }
  });
}

function scheduleAutoSync(reason: string): void {
  autoSyncService?.schedule(reason);
}

async function connectSyncRepo(repoUrl: string) {
  try {
    ensureSyncRepoPathSelected();
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
          lastSyncAt: status.needsImportDecision ? settings.sync.github.lastSyncAt : new Date().toISOString()
        }
      }
    };
    await store.saveSettings(settings);
    return { ok: true, status, setup: await getSetupPayload() };
  } catch (error) {
    return { ok: false, error: readableError(error), status: await createSyncService(repoUrl).status() };
  }
}

async function chooseSyncRepoPath() {
  try {
    const options: Electron.OpenDialogOptions = {
      title: '选择本地同步仓库位置',
      properties: ['openDirectory', 'createDirectory']
    };
    const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths[0]) {
      return { ok: false, error: '已取消选择本地同步仓库位置', status: await createSyncService().status(), setup: await getSetupPayload() };
    }
    settings = {
      ...settings,
      sync: {
        kind: 'github',
        github: {
          ...settings.sync.github,
          localPath: result.filePaths[0]
        }
      }
    };
    await store.saveSettings(settings);
    return { ok: true, status: await createSyncService().status('已选择本地同步仓库位置'), setup: await getSetupPayload() };
  } catch (error) {
    return { ok: false, error: readableError(error), status: await createSyncService().status(), setup: await getSetupPayload() };
  }
}

async function resolveSyncImport(strategy: SyncImportStrategy) {
  try {
    ensureSyncRepoPathSelected();
    const status = await createSyncService().resolveImport(strategy);
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
    return { ok: false, error: readableError(error), status: await createSyncService().status(), setup: await getSetupPayload() };
  }
}

async function pullSync() {
  try {
    ensureSyncRepoPathSelected();
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
    ensureSyncRepoPathSelected();
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

async function syncAll() {
  try {
    ensureSyncRepoPathSelected();
    const status = await createSyncService().smartSync('sync: update v2t archive');
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

function ensureSyncRepoPathSelected(): void {
  if (!settings.sync.github.localPath) {
    throw new Error('请先选择本地同步仓库位置，避免 V2T 自动在系统目录创建同步仓库。');
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
  hotkeyService.unregister();
  await prepareNativeHelperForHotkey();
  cleanupStaleHotkeyHelpers();
  const status = await hotkeyService.register({
    accelerator: settings.hotkey.accelerator,
    fallbackAccelerator: settings.hotkey.fallbackAccelerator,
    longPressMs: settings.hotkey.longPressMs,
    singleClickMode: settings.hotkey.singleClickMode,
    doubleClickMode: settings.hotkey.doubleClickMode,
    platform: process.platform,
    accessibilityTrusted: getAccessibilityTrusted(),
    nativeHelperPath,
    nativeHelperSourcePath,
    nativeHelperSignature,
    hotkeyLogPath: hotkeyLog.getPath(),
    helperFileExists,
    repairAttempted: helperRepairAttempted,
    repairError: helperRepairError,
    staleHelperCount,
    staleHelperKilled,
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

async function repairHotkeyHelper() {
  try {
    await prepareNativeHelperForHotkey();
    await registerHotkey();
    return { ok: !helperRepairError, setup: await getSetupPayload(), error: helperRepairError };
  } catch (error) {
    helperRepairError = readableError(error);
    return { ok: false, setup: await getSetupPayload(), error: helperRepairError };
  }
}

async function cleanupStaleHotkeyHelpersAndRestart() {
  try {
    hotkeyService.unregister();
    const cleanup = cleanupStaleHotkeyHelpers();
    await registerHotkey();
    return { ok: cleanup.errors.length === 0, setup: await getSetupPayload(), cleanup, error: cleanup.errors.at(0) };
  } catch (error) {
    return { ok: false, setup: await getSetupPayload(), error: readableError(error) };
  }
}

function getAccessibilityTrusted(): boolean {
  return process.platform !== 'darwin' || systemPreferences.isTrustedAccessibilityClient(false);
}

function hotkeyPermissionKind(platform: NodeJS.Platform, accelerator: string): HotkeyStatus['permissionKind'] {
  if (platform === 'darwin') {
    return 'macos-accessibility';
  }
  if (platform === 'win32' && requiresNativeHotkey(accelerator)) {
    return 'windows-native-hook';
  }
  return 'none';
}

function requiresNativeHotkey(accelerator: string): boolean {
  return !accelerator.includes('+') || accelerator.split('+').every((part) => ['CommandOrControl', 'Command', 'Control', 'LeftControl', 'RightControl', 'Alt', 'LeftAlt', 'RightAlt', 'Shift', 'LeftShift', 'RightShift'].includes(part));
}

async function setupNativeKeyHelper(): Promise<string | undefined> {
  if (process.platform === 'win32') {
    return prepareNativeHelperForHotkey();
  }

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

async function prepareNativeHelperForHotkey(): Promise<string | undefined> {
  if (process.platform !== 'win32') {
    return nativeHelperPath;
  }

  nativeHelperSourcePath = resolveBundledV2TKeyboardListenerPath(__dirname);
  nativeHelperPath = nativeHelperSourcePath;
  nativeHelperStablePath = stableV2TKeyboardListenerPath(app.getPath('userData'));
  helperFileExists = existsSync(nativeHelperSourcePath);
  nativeHelperSignature = undefined;

  const cleanup = await cleanupStableWinKeyServer(app.getPath('userData'));
  helperRepairAttempted = cleanup.attempted;
  helperRepairError = cleanup.error;

  if (helperFileExists) {
    nativeHelperSignature = undefined;
    void hotkeyLog?.write({
      type: 'helper-ready',
      helperPath: nativeHelperPath,
      message: cleanup.error
        ? `V2TKeyboardListener.exe found; legacy WinKeyServer cleanup failed: ${cleanup.error}`
        : 'V2TKeyboardListener.exe found; legacy WinKeyServer stable copy removed if present'
    }).catch((error) => console.warn(`Unable to write hotkey diagnostic log: ${readableError(error)}`));
    return nativeHelperPath;
  }

  helperRepairError = cleanup.error ?? `V2TKeyboardListener.exe 未找到：${nativeHelperSourcePath}`;
  void hotkeyLog?.write({
    type: 'helper-missing',
    helperPath: nativeHelperPath,
    message: helperRepairError
  }).catch((writeError) => console.warn(`Unable to write hotkey diagnostic log: ${readableError(writeError)}`));
  return nativeHelperPath;
}

function cleanupStaleHotkeyHelpers(): WindowsKeyServerCleanupResult {
  if (process.platform !== 'win32') {
    return { staleHelperCount: 0, staleHelperKilled: 0, errors: [] };
  }

  const roots = windowsKeyServerRoots();
  const result = cleanupStaleWinKeyServerProcesses({ roots });
  staleHelperCount = result.staleHelperCount;
  staleHelperKilled = result.staleHelperKilled;
  void hotkeyLog?.write({
    type: 'helper-cleanup',
    helperPath: nativeHelperPath,
    message: `found=${result.staleHelperCount}; killed=${result.staleHelperKilled}; errors=${result.errors.join('; ')}`
  }).catch((error) => console.warn(`Unable to write hotkey diagnostic log: ${readableError(error)}`));
  return result;
}

function windowsKeyServerRoots(): string[] {
  return Array.from(
    new Set(
      [nativeHelperPath, nativeHelperSourcePath, nativeHelperStablePath, stableWinKeyServerPath(app.getPath('userData')), maybeBundledWinKeyServerPath()]
        .filter((value): value is string => Boolean(value))
        .map((value) => dirname(value))
    )
  );
}

function maybeBundledWinKeyServerPath(): string | undefined {
  try {
    return bundledWinKeyServerPath();
  } catch {
    return undefined;
  }
}

function readCodeSignature(filePath: string): string | undefined {
  if (process.platform !== 'darwin') {
    return undefined;
  }
  const result = spawnSync('codesign', ['-dv', '--verbose=4', filePath], { encoding: 'utf8' });
  const text = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim();
  const cdHash = text.match(/^CDHash=.+$/m)?.[0];
  const signature = text.match(/^Signature=.+$/m)?.[0];
  return [cdHash, signature].filter(Boolean).join(' · ') || text || undefined;
}

function createHotkeyDiagnosticText(): string {
  const status = hotkeyStatus;
  const lines = [
    'V2T hotkey diagnostics',
    `version: ${app.getVersion()}`,
    `platform: ${process.platform}`,
    `permissionKind: ${status?.permissionKind ?? hotkeyPermissionKind(process.platform, status?.requestedAccelerator ?? settings.hotkey.accelerator)}`,
    `requested: ${status?.requestedAccelerator ?? settings.hotkey.accelerator}`,
    `active: ${status?.activeAccelerator ?? 'unknown'}`,
    `fallback: ${status?.fallbackAccelerator ?? settings.hotkey.fallbackAccelerator ?? 'none'}`,
    `helperPath: ${nativeHelperPath ?? 'none'}`,
    `helperSourcePath: ${nativeHelperSourcePath ?? 'none'}`,
    `helperFileExists: ${String(status?.helperFileExists ?? helperFileExists ?? 'unknown')}`,
    `repairAttempted: ${String(status?.repairAttempted ?? helperRepairAttempted ?? 'unknown')}`,
    `repairError: ${status?.repairError ?? helperRepairError ?? 'none'}`,
    `staleHelperCount: ${String(status?.staleHelperCount ?? staleHelperCount ?? 0)}`,
    `staleHelperKilled: ${String(status?.staleHelperKilled ?? staleHelperKilled ?? 0)}`,
    `helperSignature: ${nativeHelperSignature ?? 'unknown'}`,
    `helperStarted: ${String(status?.helperStarted ?? false)}`,
    `helperVerified: ${String(status?.helperVerified ?? false)}`,
    `helperListenAccess: ${String(status?.helperListenAccess ?? 'unknown')}`,
    `helperEventTapCreated: ${String(status?.helperEventTapCreated ?? 'unknown')}`,
    `lastNativeEventAt: ${status?.lastNativeEventAt ? new Date(status.lastNativeEventAt).toISOString() : 'none'}`,
    `exitCode: ${String(status?.nativeExitCode ?? 'none')}`,
    `stderr: ${status?.helperLastStderr ?? status?.nativeLastInfo ?? 'none'}`,
    `logPath: ${hotkeyLog.getPath()}`
  ];
  if (process.platform === 'darwin') {
    lines.push(
      'tccCommand: log stream --debug --predicate \'subsystem == "com.apple.TCC" AND eventMessage CONTAINS "V2T"\'',
      'nextAction: 完全退出 V2T；在 Accessibility 中移除 V2T 和 MacKeyServer 后重新添加；再打开新版 V2T。'
    );
  } else if (process.platform === 'win32') {
    lines.push(
      'windowsBackend: V2T Raw Input listener',
      'defenderNote: 如果 Defender 已隔离 WinKeyServer.exe，不要恢复；新版不再分发或启动该旧 helper。',
      'nextAction: 重新检测 Windows Raw Input 键盘监听；如 V2TKeyboardListener.exe 缺失，请重新安装新版 V2T 或检查 release 包。'
    );
  }
  return lines.join('\n');
}

function createModelCatalogDiagnosticText(): string {
  const state = modelCatalogRefreshState;
  const lines = [
    'V2T model catalog diagnostics',
    `version: ${app.getVersion()}`,
    `platform: ${process.platform}`,
    `status: ${state.status}`,
    `message: ${state.message ?? 'none'}`,
    `sourceUrl: ${state.sourceUrl ?? DEFAULT_REMOTE_MODEL_CATALOG_URL}`,
    `catalogVersion: ${state.catalogVersion ?? 'builtin'}`,
    `updatedAt: ${state.updatedAt ?? 'none'}`,
    `lastRefreshAt: ${state.lastRefreshAt ?? 'none'}`,
    `cacheUsed: ${String(state.cacheUsed ?? false)}`,
    `cacheUpdatedAt: ${state.cacheUpdatedAt ?? 'none'}`,
    `error: ${state.error ?? 'none'}`
  ];
  for (const attempt of state.attempts ?? []) {
    lines.push(
      `attempt.${attempt.method}.url: ${attempt.url}`,
      `attempt.${attempt.method}.ok: ${String(attempt.ok)}`,
      `attempt.${attempt.method}.status: ${String(attempt.status ?? 'none')}`,
      `attempt.${attempt.method}.elapsedMs: ${String(attempt.elapsedMs ?? 'none')}`,
      `attempt.${attempt.method}.error: ${attempt.error ?? 'none'}`
    );
  }
  return lines.join('\n');
}

function createAppUpdateDiagnosticText(): string {
  const state = appUpdateState;
  const info = getAppInfo();
  return [
    'V2T app update diagnostics',
    `version: ${app.getVersion()}`,
    `buildCommit: ${info.buildCommit}`,
    `platform: ${process.platform}`,
    `status: ${state.status}`,
    `currentVersion: ${state.currentVersion}`,
    `latestVersion: ${state.latestVersion ?? 'none'}`,
    `releaseName: ${state.releaseName ?? 'none'}`,
    `releaseUrl: ${state.releaseUrl ?? 'none'}`,
    `downloadUrl: ${state.downloadUrl ?? 'none'}`,
    `percent: ${String(state.percent ?? 'none')}`,
    `errorCode: ${state.errorCode ?? 'none'}`,
    `error: ${state.error ?? 'none'}`,
    `updatedAt: ${state.updatedAt}`,
    `releasePage: ${RELEASE_PAGE_URL}`,
    'signatureNote: macOS 暂时使用手动下载更新，不再依赖 unsigned latest-mac.yml 自动安装。'
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

function sendHotkeyAction(action: { type: 'start-recording' | 'stop-recording' | 'set-recording-mode'; mode?: 'toggle' | 'hold'; inputMode?: InputMode }): void {
  if (action.type === 'start-recording') {
    sendRecordingCommand({ type: 'start', trigger: action.mode ?? 'toggle', inputMode: action.inputMode });
  } else if (action.type === 'set-recording-mode') {
    sendRecordingCommand({ type: 'set-mode', trigger: 'toggle', inputMode: action.inputMode });
  } else {
    sendRecordingCommand({ type: 'stop', trigger: action.mode ?? 'toggle' });
  }
}

function sendRecordingCommand(command: { type: 'start' | 'stop' | 'set-mode'; trigger: 'toggle' | 'hold'; inputMode?: InputMode }): void {
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
  autoSyncService?.dispose();
  hotkeyService?.unregister();
  cleanupStaleHotkeyHelpers();
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
    .overlay { width: 220px; height: 52px; display: flex; align-items: center; gap: 8px; padding: 8px 11px; border: 1px solid rgba(255, 250, 240, 0.1); border-radius: 13px; background: rgba(31, 39, 36, 0.92); color: #fffaf0; box-shadow: 0 12px 24px rgba(0, 0, 0, 0.22); cursor: pointer; user-select: none; }
    .overlay:active { transform: translateY(1px); }
    .status-dot { width: 6px; height: 6px; border-radius: 999px; background: #d84d3f; box-shadow: 0 0 0 4px rgba(216, 77, 63, 0.15); flex: 0 0 auto; }
    .processing .status-dot { background: #2e6f95; box-shadow: 0 0 0 4px rgba(46, 111, 149, 0.14); }
    .waves { width: 32px; height: 22px; display: flex; align-items: center; justify-content: center; gap: 2px; flex: 0 0 auto; }
    .bar { width: 2px; min-height: 4px; border-radius: 999px; background: rgba(255, 250, 240, 0.78); transition: height 90ms ease, opacity 120ms ease; }
    .no-input .bar { opacity: 0.32; }
    .processing .bar { height: 11px !important; opacity: 0.45; }
    .text { min-width: 0; display: grid; gap: 2px; flex: 1; }
    .title { font-weight: 720; font-size: 12px; letter-spacing: 0; line-height: 1.2; }
    .meta { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: rgba(255, 250, 240, 0.68); font-size: 10.5px; line-height: 1.25; }
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
        const height = 4 + Math.round(level * 16 * weights[index]);
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
