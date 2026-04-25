import { app, BrowserWindow, Menu, Tray, clipboard, ipcMain, nativeImage, screen, shell } from 'electron';
import { join } from 'node:path';
import { hostname } from 'node:os';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
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
import type { InputMode, ModelInstallStatus, Settings } from '../core/types';
import { getFocusedAppName } from './focusedApp';
import { HotkeyService, type HotkeyStatus } from './hotkeyService';
import { OsPasteKeySender } from './osPasteKeySender';
import { SecretStore } from './secretStore';
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

app.setName('V2T');

async function bootstrap(): Promise<void> {
  const defaultDataDir = join(app.getPath('userData'), 'sync');
  modelRoot = join(app.getPath('userData'), 'models');
  await mkdir(defaultDataDir, { recursive: true });
  await mkdir(modelRoot, { recursive: true });
  store = await UserDataStore.create(defaultDataDir, { deviceId: deviceId() });
  settings = await store.loadSettings();
  settings.dataDir = settings.dataDir ?? defaultDataDir;
  await store.saveSettings(settings);

  hotkeyService = new HotkeyService();
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
    if (!isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    void mainWindow.loadURL(devServerUrl);
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

function createTray(): void {
  tray = new Tray(createTrayImage());
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
        label: '退出',
        click: () => {
          isQuitting = true;
          app.quit();
        }
      }
    ])
  );
  tray.on('click', () => showWindow());
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
  ipcMain.handle('v2t:set-openai-key', async (_event, value: string) => {
    await new SecretStore().setOpenAICompatibleKey(value);
    return { ok: true };
  });
  ipcMain.handle('v2t:update-hotkey', async (_event, accelerator: string) => updateHotkey(accelerator));
  ipcMain.handle('v2t:set-recording-overlay-state', async (_event, update: RecordingOverlayUpdate) => {
    await applyRecordingOverlayState(normalizeRecordingOverlayState(update));
    return { ok: true };
  });
  ipcMain.handle('v2t:get-sync-status', async () => createSyncService().status());
  ipcMain.handle('v2t:connect-sync-repo', async (_event, repoUrl: string) => connectSyncRepo(repoUrl));
  ipcMain.handle('v2t:pull-sync', async () => pullSync());
  ipcMain.handle('v2t:push-sync', async () => pushSync());
  ipcMain.handle('v2t:install-model', async (_event, modelId: string) => {
    const manager = createModelManager();
    try {
      const status = await manager.installAndActivate(modelId);
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
    width: 300,
    height: 72,
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
    show: false,
    hasShadow: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  recordingOverlayWindow.setIgnoreMouseEvents(true);
  recordingOverlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  recordingOverlayWindow.setAlwaysOnTop(true, 'floating');

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
    longPressMs: settings.hotkey.longPressMs,
    onAction: (action) => {
      if (action.type === 'start-recording') {
        mainWindow?.webContents.send('v2t:recording-command', { type: 'start', trigger: action.mode });
      } else {
        mainWindow?.webContents.send('v2t:recording-command', { type: 'stop', trigger: action.mode });
      }
    },
    onStatus: (status) => {
      hotkeyStatus = status;
      mainWindow?.webContents.send('v2t:hotkey-status', status);
    }
  });
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
    hardware,
    modelRoot,
    catalog: DEFAULT_MODEL_CATALOG,
    modelStatuses: rawStatuses,
    recommendations: recommendModels(DEFAULT_MODEL_CATALOG, hardware, statusMap)
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
    longPressMs: settings.hotkey.longPressMs,
    onAction: (action) => {
      if (action.type === 'start-recording') {
        mainWindow?.webContents.send('v2t:recording-command', { type: 'start', trigger: action.mode });
      } else {
        mainWindow?.webContents.send('v2t:recording-command', { type: 'stop', trigger: action.mode });
      }
    },
    onStatus: (nextStatus) => {
      hotkeyStatus = nextStatus;
      mainWindow?.webContents.send('v2t:hotkey-status', nextStatus);
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

function createTrayImage() {
  const svg = encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18"><rect width="18" height="18" rx="4" fill="black"/><path d="M5 5h8v2H10v7H8V7H5z" fill="white"/></svg>'
  );
  const image = nativeImage.createFromDataURL(`data:image/svg+xml;charset=utf-8,${svg}`);
  image.setTemplateImage(true);
  return image;
}

function recordingOverlayHtmlUrl(): string {
  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    * { box-sizing: border-box; }
    html, body { width: 100%; height: 100%; margin: 0; background: transparent; overflow: hidden; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .overlay { width: 300px; height: 72px; display: flex; align-items: center; gap: 13px; padding: 12px 16px; border: 1px solid rgba(31, 39, 36, 0.12); border-radius: 18px; background: rgba(31, 39, 36, 0.92); color: #fffaf0; box-shadow: 0 16px 38px rgba(0, 0, 0, 0.24); }
    .pulse { width: 38px; height: 38px; border-radius: 999px; background: #d84d3f; box-shadow: 0 0 0 0 rgba(216, 77, 63, 0.35); animation: pulse 1.2s ease-in-out infinite; }
    .processing .pulse { background: #2e6f95; animation: none; }
    .text { min-width: 0; display: grid; gap: 3px; }
    .title { font-weight: 720; font-size: 15px; letter-spacing: 0; }
    .meta { color: rgba(255, 250, 240, 0.72); font-size: 12px; }
    @keyframes pulse { 0% { box-shadow: 0 0 0 0 rgba(216, 77, 63, 0.32); transform: scale(0.96); } 70% { box-shadow: 0 0 0 12px rgba(216, 77, 63, 0); transform: scale(1); } 100% { box-shadow: 0 0 0 0 rgba(216, 77, 63, 0); transform: scale(0.96); } }
  </style>
</head>
<body>
  <div id="overlay" class="overlay">
    <div class="pulse"></div>
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
    window.setV2TOverlayState = function(state) {
      const overlay = document.getElementById('overlay');
      const title = document.getElementById('title');
      const meta = document.getElementById('meta');
      overlay.className = 'overlay ' + state.state;
      title.textContent = state.state === 'processing' ? '正在整理' : '正在录音';
      meta.textContent = (state.mode === 'structured' ? '结构输入' : '自然输入') + ' · ' + formatElapsed(state.elapsedMs || 0);
    };
  </script>
</body>
</html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function deviceId(): string {
  return hostname().replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 48) || 'device';
}

app.whenReady().then(() => {
  void bootstrap().then(showWindow);
});

app.on('activate', () => {
  if (!mainWindow) {
    createWindow();
  }
  showWindow();
});

app.on('will-quit', () => {
  hotkeyService?.unregister();
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
}
