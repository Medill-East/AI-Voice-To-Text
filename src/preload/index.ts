import { contextBridge, ipcRenderer } from 'electron';
import type {
  GitHubSyncStatus,
  AppUpdateState,
  AsrBenchmarkBatchState,
  AutoSyncState,
  CloudLlmModelCatalogState,
  HardwareProfile,
  InputMode,
  HistoryEntry,
  InstalledModelView,
  Lexicon,
  LlmInstallerActionResult,
  LlmInstallerTarget,
  LlmProviderDetection,
  LlmTestResult,
  ModelBenchmarkResult,
  ModelCatalogItem,
  ModelCatalogRefreshState,
  ModelDownloadProbeResult,
  ModelRecommendation,
  ModelStatusRecord,
  ProcessingDiagnostic,
  PromptFiles,
  Settings,
  SyncImportStrategy,
  UsageStatistics,
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
  copyModelCatalogDiagnostics(): Promise<{ ok: true }>;
  testModelDownload(modelId: string): Promise<ModelDownloadProbeResult>;
  benchmarkAsrModel(modelId: string): Promise<ModelBenchmarkResult>;
  benchmarkInstalledAsrModels(): Promise<ModelBenchmarkResult[]>;
  cancelAsrBenchmark(): Promise<AsrBenchmarkBatchState>;
  checkForUpdates(): Promise<AppUpdateState>;
  downloadUpdate(): Promise<AppUpdateState>;
  installUpdate(): Promise<AppUpdateState>;
  copyAppUpdateDiagnostics(): Promise<{ ok: true }>;
  openReleasePage(): Promise<{ ok: true }>;
  saveSettings(settings: Settings): Promise<{ settings: Settings; hotkeyStatus?: HotkeyStatus }>;
  muteSystemAudioForRecording(): Promise<{ ok: boolean; error?: string }>;
  restoreSystemAudioAfterRecording(): Promise<{ ok: boolean; error?: string }>;
  copySystemAudioDiagnostics(): Promise<{ ok: true }>;
  getLexicon(): Promise<Lexicon>;
  saveLexicon(lexicon: Lexicon): Promise<LexiconSaveResult>;
  getPrompts(): Promise<PromptFiles>;
  savePrompt(mode: InputMode, content: string): Promise<PromptSaveResult>;
  resetPrompt(mode: InputMode): Promise<PromptSaveResult>;
  getHistory(limit?: number): Promise<HistoryEntry[]>;
  getUsageStatistics(days?: number): Promise<UsageStatistics>;
  updateHotkey(accelerator: string): Promise<HotkeyUpdateResult>;
  installModel(modelId: string): Promise<InstallModelResult>;
  reinstallModel(modelId: string): Promise<InstallModelResult>;
  cancelModelInstall(modelId: string): Promise<InstallModelResult>;
  importModelArchive(modelId: string, filePath: string): Promise<InstallModelResult>;
  importModelDirectory(modelId: string, directoryPath: string): Promise<InstallModelResult>;
  clearModelInstall(modelId: string): Promise<InstallModelResult>;
  activateModel(modelId: string): Promise<InstallModelResult>;
  deleteModel(modelId: string): Promise<InstallModelResult>;
  getSyncStatus(): Promise<GitHubSyncStatus>;
  chooseSyncRepoPath(): Promise<SyncActionResult>;
  connectSyncRepo(repoUrl: string): Promise<SyncActionResult>;
  resolveSyncImport(strategy: SyncImportStrategy): Promise<SyncActionResult>;
  pullSync(): Promise<SyncActionResult>;
  pushSync(): Promise<SyncActionResult>;
  syncAll(): Promise<SyncActionResult>;
  listConflictBackups(): Promise<string[]>;
  copyProcessingDiagnostics(): Promise<{ ok: true }>;
  copyAsrDiagnostics(): Promise<{ ok: true }>;
  setRecordingOverlayState(update: RecordingOverlayUpdate): Promise<{ ok: true }>;
  showEditMenu(): void;
  openAccessibilitySettings(): Promise<{ ok: true }>;
  refreshHotkeyPermissions(): Promise<SetupPayload>;
  testHotkey(accelerator?: string): Promise<HotkeyTestResult>;
  copyHotkeyDiagnostics(): Promise<{ ok: true }>;
  showNativeHelper(): Promise<{ ok: boolean }>;
  repairHotkeyHelper(): Promise<{ ok: boolean; setup: SetupPayload; error?: string }>;
  cleanupStaleHotkeyHelpers(): Promise<{ ok: boolean; setup: SetupPayload; error?: string }>;
  quitApp(): Promise<{ ok: true }>;
  setOpenAIKey(value: string): Promise<{ ok: true }>;
  setFallbackOpenAIKey(value: string): Promise<{ ok: true }>;
  chooseModelRootPath(): Promise<PathActionResult>;
  chooseDataDir(): Promise<PathActionResult>;
  openPath(path: string): Promise<{ ok: boolean; error?: string }>;
  copyText(value: string): Promise<{ ok: true }>;
  getLlmInstallers(): Promise<LlmInstallerTarget[]>;
  openLlmInstaller(kind: LlmInstallerTarget['kind']): Promise<LlmInstallerActionResult>;
  openLlmInstallerDocs(kind: LlmInstallerTarget['kind']): Promise<LlmInstallerActionResult>;
  openOpenRouterApiKeys(): Promise<{ ok: true }>;
  openOpenRouterFreeModels(): Promise<{ ok: true }>;
  detectLlmProviders(): Promise<LlmProviderDetection[]>;
  enableLlmProvider(detection: LlmProviderDetection, model: string): Promise<LlmEnableResult>;
  testLlmConnection(): Promise<LlmTestResult>;
  testCloudLlmConnection(options?: { baseUrl?: string; model?: string }): Promise<LlmTestResult>;
  getCloudLlmModels(): Promise<CloudLlmModelCatalogState>;
  refreshCloudLlmModels(): Promise<CloudLlmModelCatalogState>;
  setOpenAtLogin(openAtLogin: boolean): Promise<{ ok: true; settings: Settings }>;
  openModelDownloadUrl(modelId: string): Promise<{ ok: boolean; error?: string }>;
  copyModelDownloadUrl(modelId: string): Promise<{ ok: boolean; error?: string }>;
  processAudio(payload: { bytes: Uint8Array; mode: InputMode }): Promise<VoiceInputPipelineResult>;
  onRecordingCommand(callback: (command: RecordingCommand) => void): () => void;
  onHotkeyStatus(callback: (status: HotkeyStatus) => void): () => void;
  onModelInstallProgress(callback: (status: ModelStatusRecord) => void): () => void;
  onAsrBenchmarkProgress(callback: (status: AsrBenchmarkBatchState) => void): () => void;
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
  processingDiagnostic?: ProcessingDiagnostic;
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

interface PathActionResult {
  ok: boolean;
  setup: SetupPayload;
  path?: string;
  error?: string;
}

interface LlmEnableResult {
  ok: boolean;
  settings: Settings;
  setup: SetupPayload;
  error?: string;
}

const api: V2TApi = {
  getSettings: () => ipcRenderer.invoke('v2t:get-settings'),
  getSetup: () => ipcRenderer.invoke('v2t:get-setup'),
  refreshModelCatalog: () => ipcRenderer.invoke('v2t:refresh-model-catalog'),
  copyModelCatalogDiagnostics: () => ipcRenderer.invoke('v2t:copy-model-catalog-diagnostics'),
  testModelDownload: (modelId) => ipcRenderer.invoke('v2t:test-model-download', modelId),
  benchmarkAsrModel: (modelId) => ipcRenderer.invoke('v2t:benchmark-asr-model', modelId),
  benchmarkInstalledAsrModels: () => ipcRenderer.invoke('v2t:benchmark-installed-asr-models'),
  cancelAsrBenchmark: () => ipcRenderer.invoke('v2t:cancel-asr-benchmark'),
  checkForUpdates: () => ipcRenderer.invoke('v2t:check-for-updates'),
  downloadUpdate: () => ipcRenderer.invoke('v2t:download-update'),
  installUpdate: () => ipcRenderer.invoke('v2t:install-update'),
  copyAppUpdateDiagnostics: () => ipcRenderer.invoke('v2t:copy-app-update-diagnostics'),
  openReleasePage: () => ipcRenderer.invoke('v2t:open-release-page'),
  saveSettings: (settings) => ipcRenderer.invoke('v2t:save-settings', settings),
  muteSystemAudioForRecording: () => ipcRenderer.invoke('v2t:mute-system-audio-for-recording'),
  restoreSystemAudioAfterRecording: () => ipcRenderer.invoke('v2t:restore-system-audio-after-recording'),
  copySystemAudioDiagnostics: () => ipcRenderer.invoke('v2t:copy-system-audio-diagnostics'),
  getLexicon: () => ipcRenderer.invoke('v2t:get-lexicon'),
  saveLexicon: (lexicon) => ipcRenderer.invoke('v2t:save-lexicon', lexicon),
  getPrompts: () => ipcRenderer.invoke('v2t:get-prompts'),
  savePrompt: (mode, content) => ipcRenderer.invoke('v2t:save-prompt', mode, content),
  resetPrompt: (mode) => ipcRenderer.invoke('v2t:reset-prompt', mode),
  getHistory: (limit) => ipcRenderer.invoke('v2t:get-history', limit),
  getUsageStatistics: (days) => ipcRenderer.invoke('v2t:get-usage-statistics', days),
  updateHotkey: (accelerator) => ipcRenderer.invoke('v2t:update-hotkey', accelerator),
  installModel: (modelId) => ipcRenderer.invoke('v2t:install-model', modelId),
  reinstallModel: (modelId) => ipcRenderer.invoke('v2t:reinstall-model', modelId),
  cancelModelInstall: (modelId) => ipcRenderer.invoke('v2t:cancel-model-install', modelId),
  importModelArchive: (modelId, filePath) => ipcRenderer.invoke('v2t:import-model-archive', modelId, filePath),
  importModelDirectory: (modelId, directoryPath) => ipcRenderer.invoke('v2t:import-model-directory', modelId, directoryPath),
  clearModelInstall: (modelId) => ipcRenderer.invoke('v2t:clear-model-install', modelId),
  activateModel: (modelId) => ipcRenderer.invoke('v2t:activate-model', modelId),
  deleteModel: (modelId) => ipcRenderer.invoke('v2t:delete-model', modelId),
  getSyncStatus: () => ipcRenderer.invoke('v2t:get-sync-status'),
  chooseSyncRepoPath: () => ipcRenderer.invoke('v2t:choose-sync-repo-path'),
  connectSyncRepo: (repoUrl) => ipcRenderer.invoke('v2t:connect-sync-repo', repoUrl),
  resolveSyncImport: (strategy) => ipcRenderer.invoke('v2t:resolve-sync-import', strategy),
  pullSync: () => ipcRenderer.invoke('v2t:pull-sync'),
  pushSync: () => ipcRenderer.invoke('v2t:push-sync'),
  syncAll: () => ipcRenderer.invoke('v2t:sync-all'),
  listConflictBackups: () => ipcRenderer.invoke('v2t:list-conflict-backups'),
  copyProcessingDiagnostics: () => ipcRenderer.invoke('v2t:copy-processing-diagnostics'),
  copyAsrDiagnostics: () => ipcRenderer.invoke('v2t:copy-asr-diagnostics'),
  setRecordingOverlayState: (update) => ipcRenderer.invoke('v2t:set-recording-overlay-state', update),
  showEditMenu: () => ipcRenderer.send('v2t:show-edit-menu'),
  openAccessibilitySettings: () => ipcRenderer.invoke('v2t:open-accessibility-settings'),
  refreshHotkeyPermissions: () => ipcRenderer.invoke('v2t:refresh-hotkey-permissions'),
  testHotkey: (accelerator) => ipcRenderer.invoke('v2t:test-hotkey', accelerator),
  copyHotkeyDiagnostics: () => ipcRenderer.invoke('v2t:copy-hotkey-diagnostics'),
  showNativeHelper: () => ipcRenderer.invoke('v2t:show-native-helper'),
  repairHotkeyHelper: () => ipcRenderer.invoke('v2t:repair-hotkey-helper'),
  cleanupStaleHotkeyHelpers: () => ipcRenderer.invoke('v2t:cleanup-stale-hotkey-helpers'),
  quitApp: () => ipcRenderer.invoke('v2t:quit-app'),
  setOpenAIKey: (value) => ipcRenderer.invoke('v2t:set-openai-key', value),
  setFallbackOpenAIKey: (value) => ipcRenderer.invoke('v2t:set-fallback-openai-key', value),
  chooseModelRootPath: () => ipcRenderer.invoke('v2t:choose-model-root-path'),
  chooseDataDir: () => ipcRenderer.invoke('v2t:choose-data-dir'),
  openPath: (path) => ipcRenderer.invoke('v2t:open-path', path),
  copyText: (value) => ipcRenderer.invoke('v2t:copy-text', value),
  getLlmInstallers: () => ipcRenderer.invoke('v2t:get-llm-installers'),
  openLlmInstaller: (kind) => ipcRenderer.invoke('v2t:open-llm-installer', kind),
  openLlmInstallerDocs: (kind) => ipcRenderer.invoke('v2t:open-llm-installer-docs', kind),
  openOpenRouterApiKeys: () => ipcRenderer.invoke('v2t:open-openrouter-api-keys'),
  openOpenRouterFreeModels: () => ipcRenderer.invoke('v2t:open-openrouter-free-models'),
  detectLlmProviders: () => ipcRenderer.invoke('v2t:detect-llm-providers'),
  enableLlmProvider: (detection, model) => ipcRenderer.invoke('v2t:enable-llm-provider', detection, model),
  testLlmConnection: () => ipcRenderer.invoke('v2t:test-llm-connection'),
  testCloudLlmConnection: (options) => ipcRenderer.invoke('v2t:test-cloud-llm', options),
  getCloudLlmModels: () => ipcRenderer.invoke('v2t:get-cloud-llm-models'),
  refreshCloudLlmModels: () => ipcRenderer.invoke('v2t:refresh-cloud-llm-models'),
  setOpenAtLogin: (openAtLogin) => ipcRenderer.invoke('v2t:set-open-at-login', openAtLogin),
  openModelDownloadUrl: (modelId) => ipcRenderer.invoke('v2t:open-model-download-url', modelId),
  copyModelDownloadUrl: (modelId) => ipcRenderer.invoke('v2t:copy-model-download-url', modelId),
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
  onAsrBenchmarkProgress: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, status: AsrBenchmarkBatchState) => callback(status);
    ipcRenderer.on('v2t:asr-benchmark-progress', listener);
    return () => ipcRenderer.off('v2t:asr-benchmark-progress', listener);
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
