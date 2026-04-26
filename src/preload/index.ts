import { contextBridge, ipcRenderer } from 'electron';
import type {
  GitHubSyncStatus,
  AppUpdateState,
  AutoSyncState,
  HardwareProfile,
  InputMode,
  HistoryEntry,
  InstalledModelView,
  Lexicon,
  ModelCatalogItem,
  ModelCatalogRefreshState,
  ModelRecommendation,
  ModelStatusRecord,
  PromptFiles,
  Settings,
  VoiceInputPipelineResult
} from '../core/types';
import type { HotkeyStatus, HotkeyTestResult } from '../main/hotkeyService';
import type { RecordingOverlayUpdate } from '../main/recordingOverlay';

export interface RecordingCommand {
  type: 'start' | 'stop' | 'set-mode';
  trigger: 'toggle' | 'hold';
  inputMode?: InputMode;
}

export interface V2TApi {
  getSettings(): Promise<{ settings: Settings; hotkeyStatus?: HotkeyStatus }>;
  getSetup(): Promise<SetupPayload>;
  refreshModelCatalog(): Promise<SetupPayload>;
  checkForUpdates(): Promise<AppUpdateState>;
  downloadUpdate(): Promise<AppUpdateState>;
  installUpdate(): Promise<AppUpdateState>;
  saveSettings(settings: Settings): Promise<{ settings: Settings; hotkeyStatus?: HotkeyStatus }>;
  getLexicon(): Promise<Lexicon>;
  saveLexicon(lexicon: Lexicon): Promise<LexiconSaveResult>;
  getPrompts(): Promise<PromptFiles>;
  savePrompt(mode: InputMode, content: string): Promise<PromptSaveResult>;
  resetPrompt(mode: InputMode): Promise<PromptSaveResult>;
  getHistory(limit?: number): Promise<HistoryEntry[]>;
  updateHotkey(accelerator: string): Promise<HotkeyUpdateResult>;
  installModel(modelId: string): Promise<InstallModelResult>;
  reinstallModel(modelId: string): Promise<InstallModelResult>;
  cancelModelInstall(modelId: string): Promise<InstallModelResult>;
  activateModel(modelId: string): Promise<InstallModelResult>;
  deleteModel(modelId: string): Promise<InstallModelResult>;
  getSyncStatus(): Promise<GitHubSyncStatus>;
  connectSyncRepo(repoUrl: string): Promise<SyncActionResult>;
  pullSync(): Promise<SyncActionResult>;
  pushSync(): Promise<SyncActionResult>;
  syncAll(): Promise<SyncActionResult>;
  setRecordingOverlayState(update: RecordingOverlayUpdate): Promise<{ ok: true }>;
  openAccessibilitySettings(): Promise<{ ok: true }>;
  refreshHotkeyPermissions(): Promise<SetupPayload>;
  testHotkey(accelerator?: string): Promise<HotkeyTestResult>;
  copyHotkeyDiagnostics(): Promise<{ ok: true }>;
  showNativeHelper(): Promise<{ ok: boolean }>;
  repairHotkeyHelper(): Promise<{ ok: boolean; setup: SetupPayload; error?: string }>;
  cleanupStaleHotkeyHelpers(): Promise<{ ok: boolean; setup: SetupPayload; error?: string }>;
  quitApp(): Promise<{ ok: true }>;
  setOpenAIKey(value: string): Promise<{ ok: true }>;
  processAudio(payload: { bytes: Uint8Array; mode: InputMode }): Promise<VoiceInputPipelineResult>;
  onRecordingCommand(callback: (command: RecordingCommand) => void): () => void;
  onHotkeyStatus(callback: (status: HotkeyStatus) => void): () => void;
  onModelInstallProgress(callback: (status: ModelStatusRecord) => void): () => void;
  onModelCatalogRefresh(callback: (setup: SetupPayload) => void): () => void;
  onAutoSyncStatus(callback: (status: AutoSyncState) => void): () => void;
  onAppUpdateStatus(callback: (status: AppUpdateState) => void): () => void;
}

export interface SetupPayload {
  settings: Settings;
  hotkeyStatus?: HotkeyStatus;
  autoSyncState: AutoSyncState;
  appUpdateState: AppUpdateState;
  hardware: HardwareProfile;
  modelRoot: string;
  catalog: ModelCatalogItem[];
  modelCatalogRefresh: ModelCatalogRefreshState;
  modelStatuses: Record<string, ModelStatusRecord>;
  recommendations: ModelRecommendation[];
  installedModels: InstalledModelView[];
  appInfo: {
    version: string;
    buildCommit: string;
  };
}

interface ProcessAudioResponse {
  ok: boolean;
  result?: VoiceInputPipelineResult;
  error?: string;
}

interface InstallModelResult {
  ok: boolean;
  status?: ModelStatusRecord;
  setup: SetupPayload;
  error?: string;
}

interface SyncActionResult {
  ok: boolean;
  status: GitHubSyncStatus;
  setup?: SetupPayload;
  error?: string;
}

interface HotkeyUpdateResult {
  ok: boolean;
  settings: Settings;
  hotkeyStatus?: HotkeyStatus;
  error?: string;
}

interface LexiconSaveResult {
  ok: boolean;
  lexicon?: Lexicon;
  error?: string;
}

interface PromptSaveResult {
  ok: boolean;
  prompts?: PromptFiles;
  error?: string;
}

const api: V2TApi = {
  getSettings: () => ipcRenderer.invoke('v2t:get-settings'),
  getSetup: () => ipcRenderer.invoke('v2t:get-setup'),
  refreshModelCatalog: () => ipcRenderer.invoke('v2t:refresh-model-catalog'),
  checkForUpdates: () => ipcRenderer.invoke('v2t:check-for-updates'),
  downloadUpdate: () => ipcRenderer.invoke('v2t:download-update'),
  installUpdate: () => ipcRenderer.invoke('v2t:install-update'),
  saveSettings: (settings) => ipcRenderer.invoke('v2t:save-settings', settings),
  getLexicon: () => ipcRenderer.invoke('v2t:get-lexicon'),
  saveLexicon: (lexicon) => ipcRenderer.invoke('v2t:save-lexicon', lexicon),
  getPrompts: () => ipcRenderer.invoke('v2t:get-prompts'),
  savePrompt: (mode, content) => ipcRenderer.invoke('v2t:save-prompt', mode, content),
  resetPrompt: (mode) => ipcRenderer.invoke('v2t:reset-prompt', mode),
  getHistory: (limit) => ipcRenderer.invoke('v2t:get-history', limit),
  updateHotkey: (accelerator) => ipcRenderer.invoke('v2t:update-hotkey', accelerator),
  installModel: (modelId) => ipcRenderer.invoke('v2t:install-model', modelId),
  reinstallModel: (modelId) => ipcRenderer.invoke('v2t:reinstall-model', modelId),
  cancelModelInstall: (modelId) => ipcRenderer.invoke('v2t:cancel-model-install', modelId),
  activateModel: (modelId) => ipcRenderer.invoke('v2t:activate-model', modelId),
  deleteModel: (modelId) => ipcRenderer.invoke('v2t:delete-model', modelId),
  getSyncStatus: () => ipcRenderer.invoke('v2t:get-sync-status'),
  connectSyncRepo: (repoUrl) => ipcRenderer.invoke('v2t:connect-sync-repo', repoUrl),
  pullSync: () => ipcRenderer.invoke('v2t:pull-sync'),
  pushSync: () => ipcRenderer.invoke('v2t:push-sync'),
  syncAll: () => ipcRenderer.invoke('v2t:sync-all'),
  setRecordingOverlayState: (update) => ipcRenderer.invoke('v2t:set-recording-overlay-state', update),
  openAccessibilitySettings: () => ipcRenderer.invoke('v2t:open-accessibility-settings'),
  refreshHotkeyPermissions: () => ipcRenderer.invoke('v2t:refresh-hotkey-permissions'),
  testHotkey: (accelerator) => ipcRenderer.invoke('v2t:test-hotkey', accelerator),
  copyHotkeyDiagnostics: () => ipcRenderer.invoke('v2t:copy-hotkey-diagnostics'),
  showNativeHelper: () => ipcRenderer.invoke('v2t:show-native-helper'),
  repairHotkeyHelper: () => ipcRenderer.invoke('v2t:repair-hotkey-helper'),
  cleanupStaleHotkeyHelpers: () => ipcRenderer.invoke('v2t:cleanup-stale-hotkey-helpers'),
  quitApp: () => ipcRenderer.invoke('v2t:quit-app'),
  setOpenAIKey: (value) => ipcRenderer.invoke('v2t:set-openai-key', value),
  processAudio: async (payload) => {
    const response = (await ipcRenderer.invoke('v2t:process-audio', payload)) as ProcessAudioResponse;
    if (!response.ok || !response.result) {
      throw new Error(response.error ?? '转写失败');
    }
    return response.result;
  },
  onRecordingCommand: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, command: RecordingCommand) => callback(command);
    ipcRenderer.on('v2t:recording-command', listener);
    return () => ipcRenderer.off('v2t:recording-command', listener);
  },
  onHotkeyStatus: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, status: HotkeyStatus) => callback(status);
    ipcRenderer.on('v2t:hotkey-status', listener);
    return () => ipcRenderer.off('v2t:hotkey-status', listener);
  },
  onModelInstallProgress: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, status: ModelStatusRecord) => callback(status);
    ipcRenderer.on('v2t:model-install-progress', listener);
    return () => ipcRenderer.off('v2t:model-install-progress', listener);
  },
  onModelCatalogRefresh: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, setup: SetupPayload) => callback(setup);
    ipcRenderer.on('v2t:model-catalog-refresh', listener);
    return () => ipcRenderer.off('v2t:model-catalog-refresh', listener);
  },
  onAutoSyncStatus: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, status: AutoSyncState) => callback(status);
    ipcRenderer.on('v2t:auto-sync-status', listener);
    return () => ipcRenderer.off('v2t:auto-sync-status', listener);
  },
  onAppUpdateStatus: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, status: AppUpdateState) => callback(status);
    ipcRenderer.on('v2t:app-update-status', listener);
    return () => ipcRenderer.off('v2t:app-update-status', listener);
  }
};

contextBridge.exposeInMainWorld('v2t', api);
