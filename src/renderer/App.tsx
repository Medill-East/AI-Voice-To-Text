import { useCallback, useEffect, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import { referenceModels } from '../core/modelCatalog';
import { hotkeyLabelForPlatform } from '../core/hotkeyLabels';
import { normalizeAccelerator, shortcutFromRecordedKeys } from '../core/hotkeyRecorder';
import type {
  AppUpdateState,
  AutoSyncState,
  GitHubSyncStatus,
  HistoryEntry,
  InputMode,
  InstalledModelView,
  Lexicon,
  LlmInstallerTarget,
  LlmProviderDetection,
  ModelCatalogItem,
  ModelCatalogRefreshState,
  ModelDownloadProbeResult,
  ModelEvaluationMetric,
  ModelRecommendation,
  ModelStatusRecord,
  PromptFiles,
  Settings,
  SyncImportStrategy,
  VoiceInputPipelineResult
} from '../core/types';
import type { HotkeyStatus } from '../main/hotkeyService';
import type { RecordingCommand, SetupPayload } from '../preload';

type RecordingState = 'idle' | 'starting' | 'recording' | 'processing' | 'error';
type AppPage = 'voice' | 'asrModels' | 'llmModels' | 'hotkey' | 'lexicon' | 'prompts' | 'sync' | 'advanced' | 'app';
type LlmSettingsPage = 'local' | 'cloud';

const APP_PAGES: Array<{ id: AppPage; label: string }> = [
  { id: 'voice', label: '语音输入' },
  { id: 'asrModels', label: '语音识别模型' },
  { id: 'llmModels', label: '文本整理模型' },
  { id: 'hotkey', label: '快捷键' },
  { id: 'lexicon', label: '词库' },
  { id: 'prompts', label: '提示词' },
  { id: 'sync', label: 'GitHub 同步' },
  { id: 'advanced', label: '高级设置' },
  { id: 'app', label: '应用' }
];
const CLOUD_LLM_RECOMMENDATIONS = [
  {
    name: 'OpenRouter Free Router',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'openrouter/free',
    tag: '免费',
    note: '自动选择当前可用免费模型；成本最低，但模型可能变化，输出风格不够稳定。'
  },
  {
    name: 'Qwen3.6 Plus / OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'qwen/qwen3.6-plus',
    tag: '中文优先',
    note: '适合中文和中英混合整理；是否免费、限流和具体路由以 OpenRouter 当前模型页为准。'
  },
  {
    name: 'Gemma 4 31B Free',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'google/gemma-4-31b-it:free',
    tag: '免费多语言',
    note: 'OpenRouter 免费项，支持多语言和长上下文；结构化整理可试，但中文稳定性需实际验证。'
  },
  {
    name: 'Nemotron 3 Nano Free',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'nvidia/nemotron-3-nano-30b-a3b:free',
    tag: '免费高速',
    note: 'OpenRouter 免费项，适合低成本尝试；如果出现 reasoning-only，可继续使用快速模式或换 Qwen。'
  },
  {
    name: 'Qwen Plus / DashScope',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus',
    tag: '中文稳定',
    note: '中文整理稳定性通常更好；需要阿里云百炼/DashScope API Key。'
  }
];
const MAX_RECORDING_MS = 5 * 60 * 1000;

interface LocalHistoryItem extends VoiceInputPipelineResult {
  createdAt: string;
  mode: InputMode;
}

interface PcmRecorder {
  context: AudioContext;
  stream: MediaStream;
  source: MediaStreamAudioSourceNode;
  processor: ScriptProcessorNode;
  chunks: Float32Array[];
  inputSampleRate: number;
}

export function App() {
  const [setup, setSetup] = useState<SetupPayload | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [mode, setMode] = useState<InputMode>('natural');
  const [activePage, setActivePage] = useState<AppPage>('voice');
  const [llmSettingsPage, setLlmSettingsPage] = useState<LlmSettingsPage>('local');
  const [state, setState] = useState<RecordingState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<LocalHistoryItem[]>([]);
  const [activeRecordingMode, setActiveRecordingMode] = useState<InputMode | null>(null);
  const [hotkeyStatus, setHotkeyStatus] = useState<HotkeyStatus | undefined>();
  const [capturingHotkey, setCapturingHotkey] = useState(false);
  const [installingModelId, setInstallingModelId] = useState<string | null>(null);
  const [catalogRefreshing, setCatalogRefreshing] = useState(false);
  const [catalogMessage, setCatalogMessage] = useState<string | null>(null);
  const [installProgressById, setInstallProgressById] = useState<Record<string, ModelStatusRecord>>({});
  const [downloadProbeById, setDownloadProbeById] = useState<Record<string, ModelDownloadProbeResult>>({});
  const [probingModelId, setProbingModelId] = useState<string | null>(null);
  const [activatingModelId, setActivatingModelId] = useState<string | null>(null);
  const [deletingModelId, setDeletingModelId] = useState<string | null>(null);
  const [syncRepoUrl, setSyncRepoUrl] = useState('');
  const [syncBusy, setSyncBusy] = useState<string | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<GitHubSyncStatus | null>(null);
  const [conflictBackups, setConflictBackups] = useState<string[]>([]);
  const [autoSyncState, setAutoSyncState] = useState<AutoSyncState | null>(null);
  const [appUpdateState, setAppUpdateState] = useState<AppUpdateState | null>(null);
  const [updateBusy, setUpdateBusy] = useState<string | null>(null);
  const [testingHotkey, setTestingHotkey] = useState(false);
  const [hotkeyTestMessage, setHotkeyTestMessage] = useState<string | null>(null);
  const [lexicon, setLexicon] = useState<Lexicon | null>(null);
  const [lexiconDirty, setLexiconDirty] = useState(false);
  const [lexiconMessage, setLexiconMessage] = useState<string | null>(null);
  const [prompts, setPrompts] = useState<PromptFiles | null>(null);
  const [promptDrafts, setPromptDrafts] = useState<{ natural: string; structured: string }>({ natural: '', structured: '' });
  const [promptDirty, setPromptDirty] = useState<{ natural: boolean; structured: boolean }>({ natural: false, structured: false });
  const [promptMessage, setPromptMessage] = useState<string | null>(null);
  const [llmDetections, setLlmDetections] = useState<LlmProviderDetection[]>([]);
  const [llmInstallers, setLlmInstallers] = useState<LlmInstallerTarget[]>([]);
  const [llmInstallerBusy, setLlmInstallerBusy] = useState<string | null>(null);
  const [llmMessage, setLlmMessage] = useState<string | null>(null);
  const [llmApiKeyDraft, setLlmApiKeyDraft] = useState('');
  const [llmFallbackApiKeyDraft, setLlmFallbackApiKeyDraft] = useState('');
  const [pathMessage, setPathMessage] = useState<string | null>(null);
  const recorderRef = useRef<PcmRecorder | null>(null);
  const modeRef = useRef<InputMode>('natural');
  const recordingStateRef = useRef<RecordingState>('idle');
  const recordingStartedAtRef = useRef<number | undefined>(undefined);
  const recordingElapsedMsRef = useRef<number | undefined>(undefined);
  const inputLevelRef = useRef(0);
  const inputActiveRef = useRef(false);
  const silenceStartedAtRef = useRef<number | undefined>(undefined);
  const silenceMsRef = useRef(0);
  const recordingLimitTimerRef = useRef<number | undefined>(undefined);
  const capturedHotkeyKeysRef = useRef<Set<string>>(new Set());

  const applySetup = useCallback((nextSetup: SetupPayload) => {
    setSetup(nextSetup);
    setSettings(nextSetup.settings);
    setMode(nextSetup.settings.defaultMode);
    setHotkeyStatus(nextSetup.hotkeyStatus);
    setAutoSyncState(nextSetup.autoSyncState);
    setAppUpdateState(nextSetup.appUpdateState);
    setSyncRepoUrl(nextSetup.settings.sync.github.repoUrl ?? '');
    setInstallProgressById(nextSetup.modelStatuses);
  }, []);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    recordingStateRef.current = state;
  }, [state]);

  useEffect(() => {
    document.documentElement.dataset.theme = settings?.appearance.theme ?? 'system';
  }, [settings?.appearance.theme]);

  const resetInputMeter = useCallback(() => {
    inputLevelRef.current = 0;
    inputActiveRef.current = false;
    silenceStartedAtRef.current = undefined;
    silenceMsRef.current = 0;
  }, []);

  const clearRecordingLimitTimer = useCallback(() => {
    if (recordingLimitTimerRef.current !== undefined) {
      window.clearTimeout(recordingLimitTimerRef.current);
      recordingLimitTimerRef.current = undefined;
    }
  }, []);

  const showEditMenu = (event: MouseEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    event.preventDefault();
    window.v2t.showEditMenu();
  };

  const updateInputMeter = useCallback((samples: Float32Array) => {
    if (samples.length === 0) {
      return;
    }

    let sum = 0;
    for (let index = 0; index < samples.length; index += 1) {
      const sample = samples[index] ?? 0;
      sum += sample * sample;
    }

    const rms = Math.sqrt(sum / samples.length);
    const nextLevel = Math.min(1, rms * 12);
    inputLevelRef.current = inputLevelRef.current * 0.72 + nextLevel * 0.28;
    inputActiveRef.current = inputLevelRef.current > 0.045;

    const now = Date.now();
    if (inputActiveRef.current) {
      silenceStartedAtRef.current = undefined;
      silenceMsRef.current = 0;
      return;
    }

    silenceStartedAtRef.current ??= now;
    silenceMsRef.current = now - silenceStartedAtRef.current;
  }, []);

  useEffect(() => {
    void window.v2t.getSetup().then(applySetup);
    return window.v2t.onHotkeyStatus(setHotkeyStatus);
  }, [applySetup]);

  useEffect(() => {
    return window.v2t.onModelCatalogRefresh((nextSetup) => {
      applySetup(nextSetup);
      setCatalogRefreshing(nextSetup.modelCatalogRefresh.status === 'refreshing');
    });
  }, [applySetup]);

  useEffect(() => {
    void window.v2t
      .getHistory(30)
      .then((entries) => setHistory(entries.map(historyEntryToLocalItem)))
      .catch((caught) => setError(caught instanceof Error ? caught.message : String(caught)));
  }, []);

  useEffect(() => {
    void window.v2t
      .getLexicon()
      .then(setLexicon)
      .catch((caught) => setError(caught instanceof Error ? caught.message : String(caught)));
  }, []);

  useEffect(() => {
    void window.v2t
      .getPrompts()
      .then(applyPrompts)
      .catch((caught) => setError(caught instanceof Error ? caught.message : String(caught)));
  }, []);

  useEffect(() => {
    void window.v2t
      .getLlmInstallers()
      .then(setLlmInstallers)
      .catch((caught) => setLlmMessage(caught instanceof Error ? caught.message : String(caught)));
  }, []);

  useEffect(() => {
    return window.v2t.onModelInstallProgress((status) => {
      setInstallProgressById((current) => ({ ...current, [status.modelId]: status }));
      setSetup((current) =>
        current
          ? {
              ...current,
              modelStatuses: {
                ...current.modelStatuses,
                [status.modelId]: status
              }
            }
          : current
      );
    });
  }, []);

  useEffect(() => {
    return window.v2t.onAutoSyncStatus(setAutoSyncState);
  }, []);

  useEffect(() => {
    return window.v2t.onAppUpdateStatus(setAppUpdateState);
  }, []);

  const stopRecording = useCallback(() => {
    clearRecordingLimitTimer();
    const recorder = recorderRef.current;
    if (!recorder) {
      if (recordingStateRef.current === 'starting') {
        recordingStateRef.current = 'idle';
        setState('idle');
        setActiveRecordingMode(null);
      }
      return;
    }

    recorder.processor.disconnect();
    recorder.source.disconnect();
    recorder.stream.getTracks().forEach((track) => track.stop());
    void recorder.context.close();
    recorderRef.current = null;
    recordingElapsedMsRef.current = recordingStartedAtRef.current ? Date.now() - recordingStartedAtRef.current : 0;
    resetInputMeter();

    const wav = encodeWav(recorder.chunks, recorder.inputSampleRate, 16000);
    void processRecording(wav, modeRef.current);
  }, [clearRecordingLimitTimer, resetInputMeter]);

  const startRecording = useCallback(async (activeMode: InputMode = modeRef.current) => {
    if (recordingStateRef.current === 'starting' || recordingStateRef.current === 'recording' || recordingStateRef.current === 'processing') {
      return;
    }

    setError(null);
    resetInputMeter();
    modeRef.current = activeMode;
    setActiveRecordingMode(activeMode);
    recordingStateRef.current = 'starting';
    recordingStartedAtRef.current = Date.now();
    recordingElapsedMsRef.current = undefined;
    setState('starting');

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const context = new AudioContext();
      const source = context.createMediaStreamSource(stream);
      const processor = context.createScriptProcessor(4096, 1, 1);
      const chunks: Float32Array[] = [];

      processor.onaudioprocess = (event) => {
        const samples = event.inputBuffer.getChannelData(0);
        chunks.push(new Float32Array(samples));
        updateInputMeter(samples);
      };
      source.connect(processor);
      processor.connect(context.destination);

      recorderRef.current = {
        context,
        stream,
        source,
        processor,
        chunks,
        inputSampleRate: context.sampleRate
      };
      recordingStateRef.current = 'recording';
      setState('recording');
      recordingLimitTimerRef.current = window.setTimeout(() => {
        stopRecording();
      }, MAX_RECORDING_MS);
    } catch (caught) {
      clearRecordingLimitTimer();
      recordingStartedAtRef.current = undefined;
      recordingElapsedMsRef.current = undefined;
      recordingStateRef.current = 'error';
      setActiveRecordingMode(null);
      resetInputMeter();
      setState('error');
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }, [clearRecordingLimitTimer, resetInputMeter, stopRecording, updateInputMeter]);

  const processRecording = useCallback(async (bytes: Uint8Array, activeMode: InputMode) => {
    recordingStateRef.current = 'processing';
    setState('processing');
    try {
      const result = await window.v2t.processAudio({ bytes, mode: activeMode });
      setHistory((items) => [{ ...result, createdAt: new Date().toISOString(), mode: activeMode }, ...items].slice(0, 30));
      recordingStartedAtRef.current = undefined;
      recordingElapsedMsRef.current = undefined;
      setActiveRecordingMode(null);
      resetInputMeter();
      recordingStateRef.current = 'idle';
      setState('idle');
    } catch (caught) {
      recordingStartedAtRef.current = undefined;
      recordingElapsedMsRef.current = undefined;
      setActiveRecordingMode(null);
      resetInputMeter();
      recordingStateRef.current = 'error';
      setState('error');
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }, [resetInputMeter]);

  const windowRecordingMode = settings?.hotkey.singleClickMode ?? 'natural';

  useEffect(() => {
    const syncOverlay = () => {
      void window.v2t
        .setRecordingOverlayState({
          state,
          mode: activeRecordingMode ?? windowRecordingMode,
          startedAt: recordingStartedAtRef.current,
          elapsedMs: state === 'processing' ? recordingElapsedMsRef.current : undefined,
          now: Date.now(),
          level: inputLevelRef.current,
          inputActive: inputActiveRef.current,
          silenceMs: silenceMsRef.current
        })
        .catch(() => undefined);
    };
    syncOverlay();
    if (state !== 'starting' && state !== 'recording' && state !== 'processing') {
      return;
    }
    const timer = window.setInterval(syncOverlay, state === 'recording' ? 120 : 500);
    return () => window.clearInterval(timer);
  }, [activeRecordingMode, state, windowRecordingMode]);

  useEffect(() => {
    return window.v2t.onRecordingCommand((command: RecordingCommand) => {
      if (command.type === 'start') {
        void startRecording(command.inputMode ?? modeRef.current);
      } else if (command.type === 'set-mode' && command.inputMode) {
        modeRef.current = command.inputMode;
        setActiveRecordingMode(command.inputMode);
      } else {
        stopRecording();
      }
    });
  }, [startRecording, stopRecording]);

  const saveSettings = async () => {
    if (!settings) {
      return;
    }
    const result = await window.v2t.saveSettings({ ...settings, defaultMode: mode });
    setSettings(result.settings);
    setHotkeyStatus(result.hotkeyStatus);
    const nextSetup = await window.v2t.getSetup();
    applySetup(nextSetup);
  };

  const updateDefaultMode = async (nextMode: InputMode) => {
    setMode(nextMode);
    modeRef.current = nextMode;
    if (!settings) {
      return;
    }
    const result = await window.v2t.saveSettings({ ...settings, defaultMode: nextMode });
    setSettings(result.settings);
    setHotkeyStatus(result.hotkeyStatus);
  };

  const updateHotkeyClickMode = async (singleClickMode: InputMode) => {
    if (!settings) {
      return;
    }
    const nextSettings: Settings = {
      ...settings,
      hotkey: {
        ...settings.hotkey,
        singleClickMode,
        doubleClickMode: oppositeMode(singleClickMode)
      }
    };
    const result = await window.v2t.saveSettings(nextSettings);
    setSettings(result.settings);
    setHotkeyStatus(result.hotkeyStatus);
    const nextSetup = await window.v2t.getSetup();
    applySetup(nextSetup);
  };

  const updateIncludeHistory = async (includeHistory: boolean) => {
    if (!settings) {
      return;
    }
    const result = await window.v2t.saveSettings({
      ...settings,
      sync: {
        ...settings.sync,
        github: {
          ...settings.sync.github,
          includeHistory
        }
      }
    });
    setSettings(result.settings);
    setHotkeyStatus(result.hotkeyStatus);
    const nextSetup = await window.v2t.getSetup();
    applySetup(nextSetup);
  };

  const updateAutoSync = async (autoSync: boolean) => {
    if (!settings) {
      return;
    }
    const result = await window.v2t.saveSettings({
      ...settings,
      sync: {
        ...settings.sync,
        github: {
          ...settings.sync.github,
          autoSync
        }
      }
    });
    setSettings(result.settings);
    setHotkeyStatus(result.hotkeyStatus);
    const nextSetup = await window.v2t.getSetup();
    applySetup(nextSetup);
  };

  const updateTheme = async (theme: Settings['appearance']['theme']) => {
    if (!settings) {
      return;
    }
    const result = await window.v2t.saveSettings({
      ...settings,
      appearance: {
        ...settings.appearance,
        theme
      }
    });
    setSettings(result.settings);
    setHotkeyStatus(result.hotkeyStatus);
    const nextSetup = await window.v2t.getSetup();
    applySetup(nextSetup);
  };

  const updateUpdaterSetting = async (patch: Partial<Settings['updates']>) => {
    if (!settings) {
      return;
    }
    const result = await window.v2t.saveSettings({
      ...settings,
      updates: {
        ...settings.updates,
        ...patch
      }
    });
    setSettings(result.settings);
    setHotkeyStatus(result.hotkeyStatus);
    const nextSetup = await window.v2t.getSetup();
    applySetup(nextSetup);
  };

  const updateLexicon = (updater: (current: Lexicon) => Lexicon) => {
    setLexicon((current) => (current ? updater(current) : current));
    setLexiconDirty(true);
    setLexiconMessage(null);
  };

  const saveLexicon = async () => {
    if (!lexicon) {
      return;
    }

    setError(null);
    const result = await window.v2t.saveLexicon(lexicon);
    if (result.ok && result.lexicon) {
      setLexicon(result.lexicon);
      setLexiconDirty(false);
      setLexiconMessage('词库已保存');
      return;
    }

    setError(result.error ?? '词库保存失败');
  };

  const applyPrompts = (nextPrompts: PromptFiles) => {
    setPrompts(nextPrompts);
    setPromptDrafts({ natural: nextPrompts.natural, structured: nextPrompts.structured });
    setPromptDirty({ natural: false, structured: false });
  };

  const applySavedPrompt = (modeName: InputMode, nextPrompts: PromptFiles) => {
    setPrompts(nextPrompts);
    setPromptDrafts((current) => ({ ...current, [modeName]: nextPrompts[modeName] }));
    setPromptDirty((current) => ({ ...current, [modeName]: false }));
  };

  const updatePromptDraft = (modeName: InputMode, value: string) => {
    setPromptDrafts((current) => ({ ...current, [modeName]: value }));
    setPromptDirty((current) => ({ ...current, [modeName]: true }));
    setPromptMessage(null);
  };

  const savePrompt = async (modeName: InputMode) => {
    setError(null);
    const result = await window.v2t.savePrompt(modeName, promptDrafts[modeName]);
    if (result.ok && result.prompts) {
      applySavedPrompt(modeName, result.prompts);
      setPromptMessage(`${modeName === 'natural' ? '自然输入' : '结构输入'} Prompt 已保存`);
      return;
    }
    setError(result.error ?? 'Prompt 保存失败');
  };

  const resetPrompt = async (modeName: InputMode) => {
    setError(null);
    const result = await window.v2t.resetPrompt(modeName);
    if (result.ok && result.prompts) {
      applySavedPrompt(modeName, result.prompts);
      setPromptMessage(`${modeName === 'natural' ? '自然输入' : '结构输入'} Prompt 已恢复默认`);
      return;
    }
    setError(result.error ?? 'Prompt 恢复失败');
  };

  const installModel = async (modelId: string) => {
    setError(null);
    setInstallingModelId(modelId);
    const result = await window.v2t.installModel(modelId);
    setInstallingModelId(null);
    applySetup(result.setup);
    if (!result.ok) {
      setError(result.error ?? '模型安装失败');
    }
  };

  const reinstallModel = async (modelId: string) => {
    setError(null);
    setInstallingModelId(modelId);
    const result = await window.v2t.reinstallModel(modelId);
    setInstallingModelId(null);
    applySetup(result.setup);
    if (!result.ok) {
      setError(result.error ?? '模型重新安装失败');
    }
  };

  const cancelModelInstall = async (modelId: string) => {
    setError(null);
    const result = await window.v2t.cancelModelInstall(modelId);
    applySetup(result.setup);
    if (!result.ok) {
      setError(result.error ?? '取消安装失败');
    }
  };

  const importModelArchive = async (modelId: string) => {
    setError(null);
    setInstallingModelId(modelId);
    const result = await window.v2t.importModelArchive(modelId, '');
    setInstallingModelId(null);
    applySetup(result.setup);
    if (!result.ok) {
      setError(result.error ?? '模型压缩包导入失败');
    }
  };

  const importModelDirectory = async (modelId: string) => {
    setError(null);
    setInstallingModelId(modelId);
    const result = await window.v2t.importModelDirectory(modelId, '');
    setInstallingModelId(null);
    applySetup(result.setup);
    if (!result.ok) {
      setError(result.error ?? '模型目录导入失败');
    }
  };

  const clearModelInstall = async (modelId: string) => {
    setError(null);
    const result = await window.v2t.clearModelInstall(modelId);
    applySetup(result.setup);
    if (!result.ok) {
      setError(result.error ?? '清除残留失败');
    }
  };

  const activateModel = async (modelId: string) => {
    setError(null);
    setActivatingModelId(modelId);
    const result = await window.v2t.activateModel(modelId);
    setActivatingModelId(null);
    applySetup(result.setup);
    if (!result.ok) {
      setError(result.error ?? '模型启用失败');
    }
  };

  const deleteModel = async (modelId: string) => {
    setError(null);
    setDeletingModelId(modelId);
    const result = await window.v2t.deleteModel(modelId);
    setDeletingModelId(null);
    applySetup(result.setup);
    if (!result.ok) {
      setError(result.error ?? '模型删除失败');
    }
  };

  const checkForUpdates = async () => {
    setUpdateBusy('checking');
    const state = await window.v2t.checkForUpdates();
    setAppUpdateState(state);
    setUpdateBusy(null);
  };

  const downloadUpdate = async () => {
    setUpdateBusy('downloading');
    const state = await window.v2t.downloadUpdate();
    setAppUpdateState(state);
    setUpdateBusy(null);
  };

  const installUpdate = async () => {
    setUpdateBusy('installing');
    const state = await window.v2t.installUpdate();
    setAppUpdateState(state);
  };

  const copyAppUpdateDiagnostics = async () => {
    await window.v2t.copyAppUpdateDiagnostics();
  };

  const openReleasePage = async () => {
    await window.v2t.openReleasePage();
  };

  const openAccessibilitySettings = async () => {
    await window.v2t.openAccessibilitySettings();
  };

  const refreshHotkeyPermissions = async () => {
    setHotkeyTestMessage('正在重新检测系统键盘监听');
    applySetup(await window.v2t.refreshHotkeyPermissions());
  };

  const refreshModelCatalog = async () => {
    setCatalogRefreshing(true);
    setCatalogMessage(null);
    try {
      applySetup(await window.v2t.refreshModelCatalog());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setCatalogRefreshing(false);
    }
  };

  const copyModelCatalogDiagnostics = async () => {
    await window.v2t.copyModelCatalogDiagnostics();
    setCatalogMessage('模型榜单诊断信息已复制到剪贴板');
  };

  const testModelDownload = async (modelId: string) => {
    setError(null);
    setProbingModelId(modelId);
    const result = await window.v2t.testModelDownload(modelId);
    setDownloadProbeById((current) => ({ ...current, [modelId]: result }));
    setProbingModelId(null);
  };

  const testHotkey = async () => {
    if (!settings?.hotkey.accelerator) {
      return;
    }
    setTestingHotkey(true);
    setHotkeyTestMessage(`请在 5 秒内按下 ${hotkeyLabel(settings.hotkey.accelerator)}`);
    const result = await window.v2t.testHotkey(settings.hotkey.accelerator);
    setTestingHotkey(false);
    if (result.ok) {
      setHotkeyTestMessage(`已收到 ${result.eventName ?? '系统按键事件'}`);
    } else {
      setHotkeyTestMessage(result.diagnosticMessage ?? result.error ?? '未收到系统按键事件');
    }
    applySetup(await window.v2t.getSetup());
  };

  const showNativeHelper = async () => {
    await window.v2t.showNativeHelper();
  };

  const repairHotkeyHelper = async () => {
    setHotkeyTestMessage('正在检查监听组件');
    const result = await window.v2t.repairHotkeyHelper();
    applySetup(result.setup);
    setHotkeyTestMessage(result.ok ? '监听组件已检查并重新检测' : result.error ?? '监听组件检查失败');
  };

  const cleanupStaleHotkeyHelpers = async () => {
    setHotkeyTestMessage('正在清理旧监听进程');
    const result = await window.v2t.cleanupStaleHotkeyHelpers();
    applySetup(result.setup);
    setHotkeyTestMessage(result.ok ? '旧监听进程已清理并重新检测' : result.error ?? '旧监听进程清理失败');
  };

  const copyHotkeyDiagnostics = async () => {
    await window.v2t.copyHotkeyDiagnostics();
    setHotkeyTestMessage('快捷键诊断信息已复制到剪贴板');
  };

  const copyText = async (value?: string) => {
    if (!value) {
      return;
    }
    await window.v2t.copyText(value);
    setPathMessage('路径已复制');
  };

  const openPath = async (value?: string) => {
    if (!value) {
      return;
    }
    const result = await window.v2t.openPath(value);
    if (!result.ok) {
      setError(result.error ?? '打开路径失败');
    }
  };

  const chooseModelRootPath = async () => {
    setPathMessage(null);
    const result = await window.v2t.chooseModelRootPath();
    applySetup(result.setup);
    if (result.ok) {
      setPathMessage('模型目录已迁移并切换');
    } else if (result.error) {
      setError(result.error);
    }
  };

  const chooseDataDir = async () => {
    setPathMessage(null);
    const result = await window.v2t.chooseDataDir();
    applySetup(result.setup);
    if (result.ok) {
      setPathMessage('同步数据目录已迁移并切换');
      void window.v2t.getPrompts().then(applyPrompts);
      void window.v2t.getLexicon().then(setLexicon);
      void window.v2t.getHistory(30).then((entries) => setHistory(entries.map(historyEntryToLocalItem)));
    } else if (result.error) {
      setError(result.error);
    }
  };

  const detectLlmProviders = async () => {
    setLlmMessage('正在检测 Ollama 和 LM Studio');
    const result = await window.v2t.detectLlmProviders();
    setLlmDetections(result);
    void window.v2t.getLlmInstallers().then(setLlmInstallers);
    const okCount = result.filter((item) => item.ok).length;
    setLlmMessage(okCount > 0 ? `检测到 ${okCount} 个本地 LLM 服务` : '未检测到 Ollama 或 LM Studio；请先安装并启动，或填写 OpenAI-compatible 配置。');
  };

  const refreshLlmInstallers = async () => {
    setLlmInstallerBusy('detect');
    setLlmMessage('正在检测 Ollama 和 LM Studio');
    try {
      const [installers, detections] = await Promise.all([window.v2t.getLlmInstallers(), window.v2t.detectLlmProviders()]);
      setLlmInstallers(installers);
      setLlmDetections(detections);
      const okCount = installers.filter((item) => item.status === 'service-available').length;
      setLlmMessage(okCount > 0 ? `检测到 ${okCount} 个可用本地 LLM 服务` : '未检测到可用本地 LLM 服务；可打开官方安装器或启动本地服务后重新检测。');
    } catch (caught) {
      setLlmMessage(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLlmInstallerBusy(null);
    }
  };

  const openLlmInstaller = async (kind: LlmInstallerTarget['kind'], docs = false) => {
    setLlmInstallerBusy(`${kind}-${docs ? 'docs' : 'download'}`);
    setLlmMessage(null);
    const result = docs ? await window.v2t.openLlmInstallerDocs(kind) : await window.v2t.openLlmInstaller(kind);
    setLlmInstallerBusy(null);
    if (result.ok) {
      setLlmMessage(docs ? '已打开官方文档。安装或启动服务后，请重新检测。' : '已打开官方下载入口。安装完成并启动服务后，请重新检测。');
      if (result.target) {
        setLlmInstallers((current) => current.map((item) => (item.kind === result.target?.kind ? result.target : item)));
      }
    } else {
      setError(result.error ?? '打开 LLM 安装入口失败');
    }
  };

  const enableLlmProvider = async (detection: LlmProviderDetection, modelName: string) => {
    setLlmMessage(null);
    const result = await window.v2t.enableLlmProvider(detection, modelName);
    applySetup(result.setup);
    if (result.ok) {
      setLlmMessage(`已启用 ${detection.label} · ${modelName}`);
    } else {
      setError(result.error ?? '启用 LLM 失败');
    }
  };

  const testLlmConnection = async () => {
    setLlmMessage('正在测试结构化整理');
    const result = await window.v2t.testLlmConnection();
    if (result.ok) {
      const elapsed = typeof result.elapsedMs === 'number' ? ` · ${Math.round(result.elapsedMs / 100) / 10}s` : '';
      setLlmMessage(`LLM 已生效${elapsed}：${result.output ?? '测试通过'}`);
    } else {
      const elapsed = typeof result.elapsedMs === 'number' ? `（${Math.round(result.elapsedMs / 100) / 10}s）` : '';
      setLlmMessage(`${result.error ?? 'LLM 测试失败'}${elapsed}${result.reasoningOnly ? '；这是 reasoning-only 响应，建议关闭 Thinking 或启用云端兜底。' : ''}`);
    }
  };

  const saveLlmApiKey = async () => {
    await window.v2t.setOpenAIKey(llmApiKeyDraft);
    setLlmApiKeyDraft('');
    setLlmMessage('API Key 已保存到系统钥匙串，不会写入同步目录。');
  };

  const saveFallbackLlmApiKey = async () => {
    await window.v2t.setFallbackOpenAIKey(llmFallbackApiKeyDraft);
    setLlmFallbackApiKeyDraft('');
    setLlmMessage('云端兜底 API Key 已保存到系统钥匙串，不会写入同步目录。');
  };

  const updateLlmEngine = (engine: Settings['providers']['llm']['engine']) => {
    if (!settings) {
      return;
    }
    setSettings({
      ...settings,
      providers: {
        ...settings.providers,
        llm: {
          ...settings.providers.llm,
          engine,
          enabled: engine !== 'off' && engine !== 'cloud',
          fallback: {
            ...settings.providers.llm.fallback,
            enabled: engine === 'local-with-cloud-fallback'
          }
        }
      }
    });
  };

  const useCloudRecommendation = (recommendation: (typeof CLOUD_LLM_RECOMMENDATIONS)[number]) => {
    if (!settings) {
      return;
    }
    setSettings({
      ...settings,
      providers: {
        ...settings.providers,
        llm: {
          ...settings.providers.llm,
          engine: 'cloud',
          enabled: false,
          fallback: {
            ...settings.providers.llm.fallback,
            enabled: false,
            baseUrl: recommendation.baseUrl,
            model: recommendation.model
          }
        }
      }
    });
    setLlmSettingsPage('cloud');
    setLlmMessage(`已填入 ${recommendation.name}，保存设置和 API Key 后即可使用。`);
  };

  const connectSyncRepo = async () => {
    setError(null);
    setSyncMessage(null);
    setSyncBusy('connect');
    const result = await window.v2t.connectSyncRepo(syncRepoUrl.trim());
    setSyncBusy(null);
    setSyncStatus(result.status);
    if (result.setup) {
      applySetup(result.setup);
    }
    if (result.ok) {
      setSyncMessage(result.status.message ?? '同步仓库已连接');
    } else {
      setError(result.error ?? '同步仓库连接失败');
    }
  };

  const chooseSyncRepoPath = async () => {
    setError(null);
    setSyncMessage(null);
    const result = await window.v2t.chooseSyncRepoPath();
    setSyncStatus(result.status);
    if (result.setup) {
      applySetup(result.setup);
    }
    if (result.ok) {
      setSyncMessage(result.status.message ?? '已选择本地同步仓库位置');
    } else if (result.error) {
      setError(result.error);
    }
  };

  const resolveSyncImport = async (strategy: SyncImportStrategy) => {
    setError(null);
    setSyncMessage(null);
    setSyncBusy(strategy);
    const result = await window.v2t.resolveSyncImport(strategy);
    setSyncBusy(null);
    setSyncStatus(result.status);
    if (result.setup) {
      applySetup(result.setup);
    }
    if (result.ok) {
      setSyncMessage(result.status.message ?? '同步导入策略已执行');
    } else {
      setError(result.error ?? '同步导入策略执行失败');
    }
  };

  const showConflictBackups = async () => {
    const backups = await window.v2t.listConflictBackups();
    setConflictBackups(backups);
    setSyncMessage(backups.length > 0 ? `找到 ${backups.length} 个冲突备份` : '暂无冲突备份');
  };

  const pullSync = async () => {
    setError(null);
    setSyncMessage(null);
    setSyncBusy('pull');
    const result = await window.v2t.pullSync();
    setSyncBusy(null);
    setSyncStatus(result.status);
    if (result.setup) {
      applySetup(result.setup);
    }
    if (result.ok) {
      setSyncMessage(result.status.message ?? '已拉取同步');
    } else {
      setError(result.error ?? '拉取同步失败');
    }
  };

  const pushSync = async () => {
    setError(null);
    setSyncMessage(null);
    setSyncBusy('push');
    const result = await window.v2t.pushSync();
    setSyncBusy(null);
    setSyncStatus(result.status);
    if (result.setup) {
      applySetup(result.setup);
    }
    if (result.ok) {
      setSyncMessage(result.status.message ?? '已推送同步');
    } else {
      setError(result.error ?? '推送同步失败');
    }
  };

  const syncAll = async () => {
    setError(null);
    setSyncMessage(null);
    setSyncBusy('sync');
    const result = await window.v2t.syncAll();
    setSyncBusy(null);
    setSyncStatus(result.status);
    if (result.setup) {
      applySetup(result.setup);
    }
    if (result.ok) {
      setSyncMessage(result.status.message ?? '已完成一键同步');
    } else {
      setError(result.error ?? '一键同步失败');
    }
  };

  const updateHotkey = async (accelerator: string) => {
    setError(null);
    const result = await window.v2t.updateHotkey(accelerator);
    setSettings(result.settings);
    setHotkeyStatus(result.hotkeyStatus);
    setCapturingHotkey(false);
    if (!result.ok) {
      setError(result.error ?? '快捷键注册失败');
    }
    const nextSetup = await window.v2t.getSetup();
    applySetup(nextSetup);
  };

  const handleHotkeyKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!capturingHotkey) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    for (const key of capturedKeysFromEvent(event)) {
      capturedHotkeyKeysRef.current.add(key);
    }
  };

  const handleHotkeyKeyUp = async (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!capturingHotkey) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    for (const key of capturedKeysFromEvent(event)) {
      capturedHotkeyKeysRef.current.add(key);
    }

    try {
      const keys = [...capturedHotkeyKeysRef.current];
      capturedHotkeyKeysRef.current.clear();
      await updateHotkey(shortcutFromRecordedKeys(keys, hotkeyPlatform()));
    } catch (caught) {
      capturedHotkeyKeysRef.current.clear();
      setCapturingHotkey(false);
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  const topRecommendation = setup?.recommendations[0];
  const hasLocalModel = Boolean(settings?.providers.asr.modelId && settings.providers.asr.modelPath);
  const currentPage = APP_PAGES.find((page) => page.id === activePage) ?? APP_PAGES[0];
  const referenceCatalog = setup ? referenceModels(setup.catalog) : [];
  const manualUpdateDownload = hotkeyPlatform() === 'darwin';
  const pageContent = (() => {
    if (activePage === 'voice') {
      return (
        <section className="page-section voice-page">
          {!hasLocalModel && topRecommendation ? (
            <section className="setup-callout">
              <div>
                <h2>本地模型未配置</h2>
                <p>推荐安装 {topRecommendation.model.name}。配置完成后可以离线转写，不需要手动启动服务。</p>
              </div>
              <button onClick={() => void installModel(topRecommendation.model.id)} disabled={Boolean(installingModelId)}>
                {installingModelId === topRecommendation.model.id ? '安装中' : '立即配置'}
              </button>
            </section>
          ) : null}

          <p className="hint mode-hint">
            单击快捷键 {modeLabel(settings?.hotkey.singleClickMode ?? 'natural')}，双击快捷键 {modeLabel(settings?.hotkey.doubleClickMode ?? 'structured')}；窗口内录音默认使用单击模式。
          </p>
          {setup?.processingDiagnostic ? (
            <section className="setup-callout warning">
              <div>
                <h2>上次长语音处理异常退出</h2>
                <p>
                  模式 {modeLabel(setup.processingDiagnostic.mode)} · 音频约 {Math.round(setup.processingDiagnostic.audioDurationSeconds ?? 0)} 秒 ·
                  {setup.processingDiagnostic.chunkCount ?? 1} 个分片
                </p>
              </div>
              <button className="secondary" onClick={() => void window.v2t.copyProcessingDiagnostics()}>
                复制诊断
              </button>
            </section>
          ) : null}
          <p className="hint">
            当前 ASR：{currentAsrLabel(settings)}，负责把语音转成原始文字。当前结构化引擎：{structuredEngineLabel(settings)}。
            {llmPromptUsageHint(settings)}
          </p>
          <section className="gesture-settings">
            <div>
              <span>单击快捷键</span>
              <strong>{modeLabel(settings?.hotkey.singleClickMode ?? 'natural')}</strong>
            </div>
            <div>
              <span>双击快捷键</span>
              <strong>{modeLabel(settings?.hotkey.doubleClickMode ?? 'structured')}</strong>
            </div>
            <button className="secondary compact" onClick={() => void updateHotkeyClickMode(oppositeMode(settings?.hotkey.singleClickMode ?? 'natural'))}>
              互换
            </button>
          </section>

          <section className={`record-control ${state}`}>
            <div>
              <span className={`status-dot ${state}`} />
              <div>
                <strong>{stateLabel(state)}</strong>
                <p>{activeRecordingMode ? `本次 ${modeLabel(activeRecordingMode)}` : `窗口内录音使用 ${modeLabel(windowRecordingMode)}`}</p>
              </div>
            </div>
            <button
              className={state === 'recording' || state === 'starting' ? 'danger' : 'secondary'}
              onClick={() => {
                if (state === 'recording' || state === 'starting') {
                  stopRecording();
                } else {
                  void startRecording(windowRecordingMode);
                }
              }}
              disabled={state === 'processing'}
            >
              {state === 'recording' || state === 'starting' ? '停止' : state === 'processing' ? '整理中' : '开始录音'}
            </button>
          </section>

          <section className="history">
            <h2>历史</h2>
            {history.length === 0 ? (
              <p className="empty">暂无记录</p>
            ) : (
              <ol>
                {history.map((item) => (
                  <li key={item.id}>
                    <div className="history-meta">
                      <span>{item.mode === 'natural' ? '自然' : '结构'}</span>
                      <span>{new Date(item.createdAt).toLocaleTimeString()}</span>
                      <span>{item.injection.method === 'cursor' ? '已输入' : '剪贴板'}</span>
                    </div>
                    <pre>{item.outputText}</pre>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </section>
      );
    }

    if (activePage === 'asrModels') {
      return (
        <section className="page-section asr-models-page">
          <h2>语音识别模型 ASR</h2>
          {setup ? (
            <>
               <p className="hint">
                 {setup.hardware.cpuName} · {setup.hardware.memoryGb}GB · {tierLabel(setup.hardware.recommendedTier)}
               </p>
               <p className="hint">ASR 负责把语音转成原始文字；FireRed、SenseVoice、Fun-ASR-Nano 都属于语音识别模型，不负责提示词驱动的结构化整理。</p>
               <p className="hint">中文推荐分优先看普通话、方言/粤语、中英混输和本机可运行性；Open ASR 英文榜只作参考。V2T 本机适配分只表示这台设备上的推荐优先级。WER/CER 越低越好，RTFx 越高越快。</p>
               <p className="hint">导入模型可以使用浏览器或下载器先下载官方压缩包，再从这里导入。当前一键下载主要来自 GitHub/k2-fsa Release，速度受 GitHub CDN、地区网络、代理和安全软件扫描影响。</p>
               <p className="hint">只有满足以下条件的模型才显示“一键安装”：V2T 已接入 runtime、知道 required files、下载源可信、checksum 或 smoke test 可验证，并且打包后能在 macOS/Windows 跑通。其他高分模型会放在“公开高分参考 / 待接入”。</p>
              <section className="catalog-refresh">
                <div>
                  <span>模型榜单</span>
                  <strong>{catalogRefreshLabel(setup.modelCatalogRefresh)}</strong>
                  <p>
                    上次刷新 {setup.modelCatalogRefresh.lastRefreshAt ? new Date(setup.modelCatalogRefresh.lastRefreshAt).toLocaleString() : '尚未刷新'} · 版本{' '}
                    {setup.modelCatalogRefresh.catalogVersion ?? '内置'}
                  </p>
                  {setup.modelCatalogRefresh.error ? <p className="error-text">{setup.modelCatalogRefresh.error}</p> : null}
                  {setup.modelCatalogRefresh.cacheUsed ? (
                    <p className="hint">当前使用本地缓存，缓存时间 {setup.modelCatalogRefresh.cacheUpdatedAt ? new Date(setup.modelCatalogRefresh.cacheUpdatedAt).toLocaleString() : '未知'}</p>
                  ) : null}
                  {setup.modelCatalogRefresh.attempts?.length ? (
                    <p className="hint">
                      最近尝试：
                      {setup.modelCatalogRefresh.attempts
                        .map((attempt) => `${attempt.method} ${attempt.status ?? '-'} ${attempt.ok ? '成功' : '失败'}`)
                        .join('；')}
                    </p>
                  ) : null}
                  {catalogMessage ? <p className="sync-message">{catalogMessage}</p> : null}
                </div>
                <div className="inline-actions">
                  <button className="secondary compact" onClick={() => void copyModelCatalogDiagnostics()}>
                    复制榜单诊断
                  </button>
                  <button className="secondary compact" onClick={() => void refreshModelCatalog()} disabled={catalogRefreshing}>
                    {catalogRefreshing ? '刷新中' : '刷新模型榜单'}
                  </button>
                </div>
              </section>
              <ModelComparisonTable recommendations={setup.recommendations} referenceModels={referenceCatalog} />
              <div className="model-list">
                {setup.recommendations.map((recommendation) => (
                  <ModelRow
                    key={recommendation.model.id}
                    recommendation={recommendation}
                    currentModelId={settings?.providers.asr.modelId}
                    statusRecord={installProgressById[recommendation.model.id] ?? setup.modelStatuses[recommendation.model.id]}
                    probeResult={downloadProbeById[recommendation.model.id]}
                    probing={probingModelId === recommendation.model.id}
                    installingModelId={installingModelId}
                    deletingModelId={deletingModelId}
                    onInstall={installModel}
                     onReinstall={reinstallModel}
                     onCancelInstall={cancelModelInstall}
                     onImportArchive={importModelArchive}
                     onImportDirectory={importModelDirectory}
                     onClearInstall={clearModelInstall}
                     onTestDownload={testModelDownload}
                    onActivate={activateModel}
                    onDelete={deleteModel}
                  />
                ))}
              </div>
              {setup.installedModels.length > 0 ? (
                <>
                  <h2 className="subsection-title">已安装模型</h2>
                  <div className="model-list">
                    {setup.installedModels.map((model) => (
                      <InstalledModelRow
                        key={model.modelId}
                        model={model}
                        activatingModelId={activatingModelId}
                        deletingModelId={deletingModelId}
                        onActivate={activateModel}
                        onReinstall={reinstallModel}
                        onDelete={deleteModel}
                      />
                    ))}
                  </div>
                </>
              ) : null}
              <h2 className="subsection-title">公开高分参考 / 待接入</h2>
              <p className="hint">这些模型有公开榜单或上游文档参考，但还没有完成 V2T 一键下载、运行配置和打包 smoke test，因此不会显示“安装”。</p>
              <div className="model-list reference-models">
                {referenceCatalog.map((model) => (
                  <ReferenceModelRow key={model.id} model={model} />
                ))}
              </div>
            </>
          ) : (
            <p className="empty">检测中</p>
          )}
        </section>
      );
    }

    if (activePage === 'llmModels') {
      return (
        <section className="page-section llm-models-page">
          <h2>文本整理模型 LLM</h2>
          {settings ? (
            <>
              <p className="hint">LLM 负责自然输入纠错和结构输入整理；ASR 只负责听写，不等于 LLM。未启用 LLM 时，Prompt 不会参与处理，结构输入只会使用本地基础规则。</p>
              <section className="llm-current">
                <div>
                  <span>当前整理引擎</span>
                  <strong>{llmEngineLabel(settings)}</strong>
                  <p>{llmEngineDescription(settings)}</p>
                </div>
                <div className="inline-actions">
                  <button className="secondary compact" onClick={() => void refreshLlmInstallers()} disabled={Boolean(llmInstallerBusy)}>
                    {llmInstallerBusy === 'detect' ? '检测中' : '重新检测'}
                  </button>
                  <button className="secondary compact" onClick={() => void testLlmConnection()}>
                    测试结构化整理
                  </button>
                </div>
              </section>

              <section className="advanced-group">
                <h3>当前整理引擎</h3>
                <p className="hint">选择结构输入和自然纠错实际使用哪个文本整理引擎。云端会发送 ASR 后的文字到第三方 API；本地不会上传。</p>
                <div className="llm-engine-grid">
                  {(['off', 'local', 'cloud', 'local-with-cloud-fallback'] as const).map((engine) => (
                    <button
                      key={engine}
                      className={settings.providers.llm.engine === engine ? 'engine-card active' : 'engine-card'}
                      onClick={() => updateLlmEngine(engine)}
                    >
                      <strong>{llmEngineName(engine)}</strong>
                      <span>{llmEngineHint(engine)}</span>
                    </button>
                  ))}
                </div>
              </section>

              <div className="subpage-tabs">
                <button className={llmSettingsPage === 'local' ? 'active' : ''} onClick={() => setLlmSettingsPage('local')}>
                  本地 LLM
                </button>
                <button className={llmSettingsPage === 'cloud' ? 'active' : ''} onClick={() => setLlmSettingsPage('cloud')}>
                  云端模型
                </button>
              </div>

              {llmSettingsPage === 'local' ? (
                <>
                  <h3 className="subsection-title">本地 LLM 安装向导</h3>
                  <p className="hint">V2T 只会打开 Ollama / LM Studio 官方下载或文档入口，引导你完成系统安装；不会静默运行未知脚本，也不会绕过系统权限。</p>
                  <div className="llm-installer-list">
                    {llmInstallers.map((target) => (
                      <LlmInstallerCard
                        key={target.kind}
                        target={target}
                        busy={llmInstallerBusy}
                        onOpenInstaller={openLlmInstaller}
                        onEnable={enableLlmProvider}
                      />
                    ))}
                  </div>

                  {llmDetections.length > 0 ? (
                    <div className="llm-detection-list">
                      {llmDetections.map((detection) => (
                        <article key={detection.kind} className={detection.ok ? 'llm-detection ok' : 'llm-detection'}>
                          <div>
                            <strong>{detection.label}</strong>
                            <p>{detection.ok ? `${detection.baseUrl} · ${detection.models.length || 0} 个模型` : detection.error ?? '未连接'}</p>
                          </div>
                          {detection.ok && detection.models.length > 0 ? (
                            <div className="inline-actions">
                              {detection.models.slice(0, 3).map((modelName) => (
                                <button key={modelName} className="secondary compact" onClick={() => void enableLlmProvider(detection, modelName)}>
                                  启用 {shortModelName(modelName)}
                                </button>
                              ))}
                            </div>
                          ) : null}
                        </article>
                      ))}
                    </div>
                  ) : null}

                  <section className="advanced-group llm-manual-config">
                    <h3>本地 OpenAI-compatible 配置</h3>
                    <p className="hint">适合 Ollama、LM Studio 或其它本机兼容服务；API Key 只保存到系统钥匙串，不写入同步目录。</p>
                    <label className="check setting-check">
                      <input
                        type="checkbox"
                        checked={settings.providers.llm.fastMode}
                        onChange={(event) =>
                          setSettings({
                            ...settings,
                            providers: {
                              ...settings.providers,
                              llm: { ...settings.providers.llm, fastMode: event.target.checked }
                            }
                          })
                        }
                      />
                      快速模式：限制输出长度、尝试关闭 Thinking、30 秒超时
                    </label>
                    <label>
                      Local Base URL
                      <input
                        className="no-drag"
                        value={settings.providers.llm.baseUrl}
                        onContextMenu={showEditMenu}
                        onChange={(event) =>
                          setSettings({
                            ...settings,
                            providers: {
                              ...settings.providers,
                              llm: { ...settings.providers.llm, baseUrl: event.target.value }
                            }
                          })
                        }
                      />
                    </label>
                    <label>
                      Local Model
                      <input
                        className="no-drag"
                        value={settings.providers.llm.model}
                        onContextMenu={showEditMenu}
                        onChange={(event) =>
                          setSettings({
                            ...settings,
                            providers: {
                              ...settings.providers,
                              llm: { ...settings.providers.llm, model: event.target.value }
                            }
                          })
                        }
                      />
                    </label>
                    <label>
                      Local API Key
                      <input
                        className="no-drag"
                        type="password"
                        value={llmApiKeyDraft}
                        placeholder="本地服务通常可留空；只保存到系统钥匙串"
                        onContextMenu={showEditMenu}
                        onChange={(event) => setLlmApiKeyDraft(event.target.value)}
                      />
                    </label>
                    <div className="button-row">
                      <button className="secondary" onClick={() => void saveLlmApiKey()} disabled={!llmApiKeyDraft}>
                        保存本地 API Key
                      </button>
                    </div>
                  </section>
                </>
              ) : (
                <>
                  <section className="advanced-group">
                    <h3>推荐云端模型</h3>
                    <p className="hint">优先推荐适合中文和中英混合口述整理的 OpenAI-compatible 模型。免费模型可能限流或变动；敏感内容建议继续用本地 LLM。</p>
                    <div className="cloud-model-list">
                      {CLOUD_LLM_RECOMMENDATIONS.map((recommendation) => (
                        <article key={recommendation.model} className="cloud-model-card">
                          <div>
                            <span>{recommendation.tag}</span>
                            <strong>{recommendation.name}</strong>
                            <p>{recommendation.model}</p>
                            <small>{recommendation.note}</small>
                          </div>
                          <button className="secondary compact" onClick={() => useCloudRecommendation(recommendation)}>
                            填入
                          </button>
                        </article>
                      ))}
                    </div>
                  </section>
                  <section className="advanced-group llm-manual-config">
                    <h3>云端 OpenAI-compatible 配置</h3>
                    <p className="hint">这里的文本会发送到第三方 API。OpenRouter 可填 `https://openrouter.ai/api/v1`；模型可以用 `openrouter/free` 或具体模型 ID。</p>
                    <label>
                      Cloud Base URL
                      <input
                        className="no-drag"
                        value={settings.providers.llm.fallback.baseUrl}
                        placeholder="例如 https://openrouter.ai/api/v1"
                        onContextMenu={showEditMenu}
                        onChange={(event) =>
                          setSettings({
                            ...settings,
                            providers: {
                              ...settings.providers,
                              llm: {
                                ...settings.providers.llm,
                                fallback: { ...settings.providers.llm.fallback, baseUrl: event.target.value }
                              }
                            }
                          })
                        }
                      />
                    </label>
                    <label>
                      Cloud Model
                      <input
                        className="no-drag"
                        value={settings.providers.llm.fallback.model}
                        placeholder="例如 openrouter/free"
                        onContextMenu={showEditMenu}
                        onChange={(event) =>
                          setSettings({
                            ...settings,
                            providers: {
                              ...settings.providers,
                              llm: {
                                ...settings.providers.llm,
                                fallback: { ...settings.providers.llm.fallback, model: event.target.value }
                              }
                            }
                          })
                        }
                      />
                    </label>
                    <label>
                      Cloud API Key
                      <input
                        className="no-drag"
                        type="password"
                        value={llmFallbackApiKeyDraft}
                        placeholder="只保存到系统钥匙串，不写入同步目录"
                        onContextMenu={showEditMenu}
                        onChange={(event) => setLlmFallbackApiKeyDraft(event.target.value)}
                      />
                    </label>
                    <div className="button-row">
                      <button className="secondary" onClick={() => void saveFallbackLlmApiKey()} disabled={!llmFallbackApiKeyDraft}>
                        保存云端 API Key
                      </button>
                    </div>
                  </section>
                </>
              )}
              <button className="save" onClick={() => void saveSettings()}>
                保存文本整理模型设置
              </button>
              {llmMessage ? <p className="sync-message">{llmMessage}</p> : null}
            </>
          ) : (
            <p className="empty">加载中</p>
          )}
        </section>
      );
    }

    if (activePage === 'hotkey') {
      return (
        <section className="page-section">
          <h2>快捷键</h2>
          <p className="hint">单击快捷键 {modeLabel(settings?.hotkey.singleClickMode ?? 'natural')}，双击快捷键 {modeLabel(settings?.hotkey.doubleClickMode ?? 'structured')}；录音稳定开始后再次触发会停止当前录音。</p>
          {hotkeyStatus?.permissionKind === 'windows-native-hook' ? (
            <p className="hint">
              Windows 现在使用 V2TKeyboardListener.exe 的 Raw Input 监听；Defender 已隔离 WinKeyServer.exe 时不要恢复，旧组件会被自动清理。
            </p>
          ) : null}
          <section className="gesture-settings">
            <div>
              <span>单击进入</span>
              <strong>{modeLabel(settings?.hotkey.singleClickMode ?? 'natural')}</strong>
            </div>
            <div>
              <span>双击进入</span>
              <strong>{modeLabel(settings?.hotkey.doubleClickMode ?? 'structured')}</strong>
            </div>
            <button className="secondary compact" onClick={() => void updateHotkeyClickMode(oppositeMode(settings?.hotkey.singleClickMode ?? 'natural'))}>
              互换
            </button>
          </section>
          <dl>
            <div>
              <dt>当前</dt>
              <dd>{settings?.hotkey.accelerator ? hotkeyLabel(settings.hotkey.accelerator) : '加载中'}</dd>
            </div>
            <div>
              <dt>监听</dt>
              <dd>{hotkeyStatusLabel(hotkeyStatus)}</dd>
            </div>
            {hotkeyStatus?.activeAccelerator && hotkeyStatus.activeAccelerator !== settings?.hotkey.accelerator ? (
              <div>
                <dt>当前生效</dt>
                <dd>{hotkeyLabel(hotkeyStatus.activeAccelerator)}</dd>
              </div>
            ) : null}
            {hotkeyStatus?.message ? (
              <div>
                <dt>提示</dt>
                <dd>{hotkeyStatus.message}</dd>
              </div>
            ) : null}
            {hotkeyStatus?.diagnosticMessage && hotkeyStatus.diagnosticMessage !== hotkeyStatus.message ? (
              <div>
                <dt>诊断</dt>
                <dd>{hotkeyStatus.diagnosticMessage}</dd>
              </div>
            ) : null}
            {hotkeyStatus?.lastError ? (
              <div>
                <dt>最近错误</dt>
                <dd>{hotkeyStatus.lastError}</dd>
              </div>
            ) : null}
            {hotkeyStatus?.lastNativeEventAt ? (
              <div>
                <dt>最近按键事件</dt>
                <dd>{new Date(hotkeyStatus.lastNativeEventAt).toLocaleTimeString()}</dd>
              </div>
            ) : null}
            {hotkeyStatus?.helperAttempted !== undefined ? (
              <div>
                <dt>监听组件检测</dt>
                <dd>{hotkeyHelperStateLabel(hotkeyStatus)}</dd>
              </div>
            ) : null}
            {hotkeyStatus?.helperListenAccess !== undefined ? (
              <div>
                <dt>监听权限</dt>
                <dd>{hotkeyStatus.helperListenAccess ? 'Input Monitoring / Listen Event 已通过' : 'Input Monitoring / Listen Event 未通过'}</dd>
              </div>
            ) : null}
            {hotkeyStatus?.helperEventTapCreated !== undefined ? (
              <div>
                <dt>Event Tap</dt>
                <dd>{hotkeyStatus.helperEventTapCreated ? '已创建' : '创建失败'}</dd>
              </div>
            ) : null}
            {hotkeyStatus?.permissionKind === 'macos-accessibility' && hotkeyStatus.appAccessibilityTrusted !== undefined ? (
              <div>
                <dt>V2T 权限</dt>
                <dd>{hotkeyStatus.appAccessibilityTrusted ? '主应用辅助功能权限已确认' : '主应用辅助功能权限未确认；仍会继续检测监听组件'}</dd>
              </div>
            ) : null}
            {hotkeyStatus?.needsAccessibilityPermission ? (
              <div>
                <dt>权限</dt>
                <dd>{hotkeyPermissionHint(hotkeyStatus)}</dd>
              </div>
            ) : null}
            {hotkeyStatus?.helperLastStderr ? (
              <div>
                <dt>监听组件日志</dt>
                <dd>{hotkeyStatus.helperLastStderr}</dd>
              </div>
            ) : null}
            {hotkeyStatus?.helperSourcePath ? (
              <div>
                <dt>组件来源</dt>
                <dd>{hotkeyStatus.helperSourcePath}</dd>
              </div>
            ) : null}
            {hotkeyStatus?.helperFileExists !== undefined ? (
              <div>
                <dt>组件文件</dt>
                <dd>{hotkeyStatus.helperFileExists ? '存在' : '缺失，请重新安装新版 V2T 或检查 release 包'}</dd>
              </div>
            ) : null}
            {hotkeyStatus?.repairAttempted !== undefined ? (
              <div>
                <dt>旧组件清理</dt>
                <dd>{hotkeyStatus.repairError ? `失败：${hotkeyStatus.repairError}` : hotkeyStatus.repairAttempted ? '已检查并清理旧 WinKeyServer' : '未执行'}</dd>
              </div>
            ) : null}
            {hotkeyStatus?.staleHelperCount !== undefined ? (
              <div>
                <dt>旧监听进程</dt>
                <dd>
                  发现 {hotkeyStatus.staleHelperCount} 个，已清理 {hotkeyStatus.staleHelperKilled ?? 0} 个
                </dd>
              </div>
            ) : null}
            {settings?.hotkey.fallbackAccelerator ? (
              <div>
                <dt>备用</dt>
                <dd>{hotkeyLabel(settings.hotkey.fallbackAccelerator)}</dd>
              </div>
            ) : null}
            {hotkeyStatus?.nativeHelperPath ? (
              <div>
                <dt>监听组件</dt>
                <dd>{hotkeyStatus.nativeHelperPath}</dd>
              </div>
            ) : null}
            {hotkeyStatus?.nativeHelperSignature ? (
              <div>
                <dt>组件签名</dt>
                <dd>{hotkeyStatus.nativeHelperSignature}</dd>
              </div>
            ) : null}
            {hotkeyStatus?.hotkeyLogPath ? (
              <div>
                <dt>诊断日志</dt>
                <dd>{hotkeyStatus.hotkeyLogPath}</dd>
              </div>
            ) : null}
          </dl>
          <div className="button-row three">
            {hotkeyStatus?.permissionKind === 'macos-accessibility' ? (
              <button className="secondary" onClick={() => void openAccessibilitySettings()}>
                打开权限
              </button>
            ) : null}
            {hotkeyStatus?.nativeHelperPath ? (
              <button className="secondary" onClick={() => void showNativeHelper()}>
                显示组件
              </button>
            ) : null}
            <button className="secondary" onClick={() => void refreshHotkeyPermissions()}>
              重新检测
            </button>
          </div>
          {hotkeyStatus?.permissionKind === 'windows-native-hook' ? (
            <div className="button-row">
              <button className="secondary" onClick={() => void repairHotkeyHelper()}>
                检查监听组件
              </button>
              <button className="secondary" onClick={() => void cleanupStaleHotkeyHelpers()}>
                清理旧监听进程
              </button>
            </div>
          ) : null}
          <div className="button-row">
            <button
              className={`secondary ${capturingHotkey ? 'listening' : ''}`}
              onClick={() => setCapturingHotkey(true)}
              onKeyDown={handleHotkeyKeyDown}
              onKeyUp={(event) => void handleHotkeyKeyUp(event)}
            >
              {capturingHotkey ? '按下触发键或组合键' : '录制快捷键'}
            </button>
            <button className="secondary" onClick={() => void updateHotkey('CommandOrControl+Shift+Space')}>
              恢复默认
            </button>
          </div>
          <button className="secondary full-width" onClick={() => void testHotkey()} disabled={testingHotkey}>
            {testingHotkey ? '等待按键中' : '测试快捷键'}
          </button>
          <button className="secondary full-width" onClick={() => void copyHotkeyDiagnostics()}>
            复制诊断信息
          </button>
          {hotkeyTestMessage ? <p className="hint hotkey-test-message">{hotkeyTestMessage}</p> : null}
          {capturingHotkey ? <p className="hint">单个修饰键可以保存，但更容易误触；普通字母和数字单键仍会被拒绝。</p> : null}
        </section>
      );
    }

    if (activePage === 'lexicon') {
      return (
        <section className="page-section lexicon-page">
          <h2>词库</h2>
          <p className="hint">这些内容保存在 lexicon.json，会随 GitHub 同步推送和拉取。</p>
          {lexicon ? (
            <>
              <section className="lexicon-group">
                <div className="section-heading">
                  <h3>专有名词</h3>
                  <button
                    className="secondary compact"
                    onClick={() =>
                      updateLexicon((current) => ({
                        ...current,
                        terms: [...current.terms, { phrase: '', aliases: [] }]
                      }))
                    }
                  >
                    新增
                  </button>
                </div>
                {lexicon.terms.length === 0 ? <p className="empty">暂无专有名词</p> : null}
                {lexicon.terms.map((term, index) => (
                  <article className="lexicon-row" key={`term-${index}`}>
                    <label>
                      词条
                      <input
                        value={term.phrase}
                        onChange={(event) =>
                          updateLexicon((current) => {
                            const terms = [...current.terms];
                            terms[index] = { ...(terms[index] ?? { phrase: '', aliases: [] }), phrase: event.target.value };
                            return { ...current, terms };
                          })
                        }
                      />
                    </label>
                    <label>
                      别名
                      <input
                        value={(term.aliases ?? []).join(', ')}
                        placeholder="多个别名用逗号分隔"
                        onChange={(event) =>
                          updateLexicon((current) => {
                            const terms = [...current.terms];
                            terms[index] = { ...(terms[index] ?? { phrase: '', aliases: [] }), aliases: parseDelimitedList(event.target.value) };
                            return { ...current, terms };
                          })
                        }
                      />
                    </label>
                    <button
                      className="danger compact"
                      onClick={() =>
                        updateLexicon((current) => ({
                          ...current,
                          terms: current.terms.filter((_, itemIndex) => itemIndex !== index)
                        }))
                      }
                    >
                      删除
                    </button>
                  </article>
                ))}
              </section>

              <section className="lexicon-group">
                <div className="section-heading">
                  <h3>固定替换</h3>
                  <button
                    className="secondary compact"
                    onClick={() =>
                      updateLexicon((current) => ({
                        ...current,
                        replacements: [...current.replacements, { from: '', to: '', enabled: true }]
                      }))
                    }
                  >
                    新增
                  </button>
                </div>
                {lexicon.replacements.length === 0 ? <p className="empty">暂无固定替换</p> : null}
                {lexicon.replacements.map((rule, index) => (
                  <article className="lexicon-row replacement" key={`replacement-${index}`}>
                    <label>
                      原文
                      <input
                        value={rule.from}
                        onChange={(event) =>
                          updateLexicon((current) => {
                            const replacements = [...current.replacements];
                            replacements[index] = { ...(replacements[index] ?? { from: '', to: '', enabled: true }), from: event.target.value };
                            return { ...current, replacements };
                          })
                        }
                      />
                    </label>
                    <label>
                      替换为
                      <input
                        value={rule.to}
                        onChange={(event) =>
                          updateLexicon((current) => {
                            const replacements = [...current.replacements];
                            replacements[index] = { ...(replacements[index] ?? { from: '', to: '', enabled: true }), to: event.target.value };
                            return { ...current, replacements };
                          })
                        }
                      />
                    </label>
                    <label className="inline-check">
                      <input
                        type="checkbox"
                        checked={rule.enabled ?? true}
                        onChange={(event) =>
                          updateLexicon((current) => {
                            const replacements = [...current.replacements];
                            replacements[index] = { ...(replacements[index] ?? { from: '', to: '', enabled: true }), enabled: event.target.checked };
                            return { ...current, replacements };
                          })
                        }
                      />
                      启用
                    </label>
                    <button
                      className="danger compact"
                      onClick={() =>
                        updateLexicon((current) => ({
                          ...current,
                          replacements: current.replacements.filter((_, itemIndex) => itemIndex !== index)
                        }))
                      }
                    >
                      删除
                    </button>
                  </article>
                ))}
              </section>

              <section className="lexicon-group">
                <div className="section-heading">
                  <h3>禁用词</h3>
                  <button
                    className="secondary compact"
                    onClick={() =>
                      updateLexicon((current) => ({
                        ...current,
                        blocked: [...current.blocked, '']
                      }))
                    }
                  >
                    新增
                  </button>
                </div>
                {lexicon.blocked.length === 0 ? <p className="empty">暂无禁用词</p> : null}
                {lexicon.blocked.map((word, index) => (
                  <article className="lexicon-row blocked" key={`blocked-${index}`}>
                    <label>
                      词语
                      <input
                        value={word}
                        onChange={(event) =>
                          updateLexicon((current) => {
                            const blocked = [...current.blocked];
                            blocked[index] = event.target.value;
                            return { ...current, blocked };
                          })
                        }
                      />
                    </label>
                    <button
                      className="danger compact"
                      onClick={() =>
                        updateLexicon((current) => ({
                          ...current,
                          blocked: current.blocked.filter((_, itemIndex) => itemIndex !== index)
                        }))
                      }
                    >
                      删除
                    </button>
                  </article>
                ))}
              </section>

              <div className="lexicon-actions">
                <button className="save" onClick={() => void saveLexicon()} disabled={!lexiconDirty}>
                  保存词库
                </button>
                {lexiconMessage ? <p className="sync-message">{lexiconMessage}</p> : null}
              </div>
            </>
          ) : (
            <p className="empty">加载中</p>
          )}
        </section>
      );
    }

    if (activePage === 'sync') {
      return (
        <section className="page-section">
          <h2>GitHub 同步</h2>
          {settings ? (
            <>
              <p className="hint">
                建议使用一个单独的私有仓库，例如 v2t-sync。先选择本地同步仓库位置，再连接 GitHub 仓库；连接不会自动覆盖本机提示词。
                settings.json、lexicon.json、prompts/natural.md、prompts/structured.md。词库页保存只改本地 lexicon.json，需要点击“推送”才会写入 GitHub。
                模型和密钥不会同步；同步历史默认关闭，可以在这里单独开启。
              </p>
              <div className="sync-repo-path-block">
                <div className="button-row">
                <button className="secondary" onClick={() => void chooseSyncRepoPath()}>
                  选择本地同步仓库位置
                </button>
                <button className="secondary" onClick={() => void showConflictBackups()}>
                  查看冲突备份
                </button>
                </div>
                <p className="hint">本地仓库路径：{settings.sync.github.localPath ?? '未选择'}</p>
              </div>
              <label className="sync-repo-url-field">
                仓库 URL
                <input
                  className="no-drag"
                  value={syncRepoUrl}
                  placeholder="git@github.com:you/v2t-sync.git"
                  spellCheck={false}
                  autoCapitalize="off"
                  autoCorrect="off"
                  onContextMenu={showEditMenu}
                  onChange={(event) => setSyncRepoUrl(event.target.value)}
                />
              </label>
              <dl>
                <div>
                  <dt>本地仓库</dt>
                  <dd>{settings.sync.github.localPath ?? '未选择'}</dd>
                </div>
                <div>
                  <dt>最后同步</dt>
                  <dd>{settings.sync.github.lastSyncAt ? new Date(settings.sync.github.lastSyncAt).toLocaleString() : '暂无'}</dd>
                </div>
              </dl>
              <label className="check sync-history-toggle">
                <input
                  type="checkbox"
                  checked={settings.sync.github.includeHistory ?? false}
                  onChange={(event) => void updateIncludeHistory(event.target.checked)}
                />
                同步历史
              </label>
              <p className="hint">开启后会把本机文字历史同步到 GitHub 私有仓库；仍不会同步音频、模型或密钥。</p>
              <label className="check sync-history-toggle">
                <input
                  type="checkbox"
                  checked={settings.sync.github.autoSync ?? false}
                  onChange={(event) => void updateAutoSync(event.target.checked)}
                />
                自动同步
              </label>
              <p className="hint">
                开启后，每次成功输入、保存词库或保存提示词都会排队同步；如果要同步录音历史，请同时开启“同步历史”。
              </p>
              <dl>
                <div>
                  <dt>自动同步状态</dt>
                  <dd>{autoSyncStatusLabel(autoSyncState, settings)}</dd>
                </div>
              </dl>
              {syncStatus?.needsImportDecision ? (
                <section className="sync-import-decision">
                  <h3>远端已有同步文件</h3>
                  <p className="hint">请选择导入策略；默认不会覆盖本机 settings、词库或 Prompt。</p>
                  <div className="button-row three">
                    <button className="secondary" onClick={() => void resolveSyncImport('local-over-remote')} disabled={Boolean(syncBusy)}>
                      使用本机覆盖远端
                    </button>
                    <button className="secondary" onClick={() => void resolveSyncImport('remote-over-local')} disabled={Boolean(syncBusy)}>
                      导入远端到本机
                    </button>
                    <button className="secondary" onClick={() => void resolveSyncImport('smart-merge')} disabled={Boolean(syncBusy)}>
                      智能合并
                    </button>
                  </div>
                  {syncStatus.remoteFiles?.length ? <p className="hint">远端文件：{syncStatus.remoteFiles.join('、')}</p> : null}
                </section>
              ) : null}
              {conflictBackups.length > 0 ? (
                <ul className="conflict-list">
                  {conflictBackups.map((file) => (
                    <li key={file}>{file}</li>
                  ))}
                </ul>
              ) : null}
              <button className="save" onClick={() => void syncAll()} disabled={Boolean(syncBusy) || !settings.sync.github.localPath}>
                {syncBusy === 'sync' ? '同步中' : '一键同步'}
              </button>
              <div className="button-row three">
                <button className="secondary" onClick={() => void connectSyncRepo()} disabled={Boolean(syncBusy) || !settings.sync.github.localPath}>
                  {syncBusy === 'connect' ? '连接中' : '连接'}
                </button>
                <button className="secondary" onClick={() => void pullSync()} disabled={Boolean(syncBusy) || !settings.sync.github.localPath}>
                  {syncBusy === 'pull' ? '拉取中' : '拉取'}
                </button>
                <button className="secondary" onClick={() => void pushSync()} disabled={Boolean(syncBusy) || !settings.sync.github.localPath}>
                  {syncBusy === 'push' ? '推送中' : '推送'}
                </button>
              </div>
              {syncMessage ? <p className="sync-message">{syncMessage}</p> : null}
            </>
          ) : (
            <p className="empty">加载中</p>
          )}
        </section>
      );
    }

    if (activePage === 'prompts') {
      return (
        <section className="page-section prompts-page">
          <h2>提示词</h2>
          <p className="hint">自然输入 Prompt 和结构输入 Prompt 保存在 prompts/，会随 GitHub 同步推送和拉取。</p>
          <p className="hint">结构化引擎：{structuredEngineLabel(settings)}。{llmPromptUsageHint(settings)}</p>
          {prompts ? (
            <>
              <PromptEditor
                title="自然输入 Prompt"
                path={prompts.paths.natural}
                value={promptDrafts.natural}
                dirty={promptDirty.natural}
                onChange={(value) => updatePromptDraft('natural', value)}
                onSave={() => void savePrompt('natural')}
                onReset={() => void resetPrompt('natural')}
              />
              <PromptEditor
                title="结构输入 Prompt"
                path={prompts.paths.structured}
                value={promptDrafts.structured}
                dirty={promptDirty.structured}
                onChange={(value) => updatePromptDraft('structured', value)}
                onSave={() => void savePrompt('structured')}
                onReset={() => void resetPrompt('structured')}
              />
              {promptMessage ? <p className="sync-message">{promptMessage}</p> : null}
            </>
          ) : (
            <p className="empty">加载中</p>
          )}
        </section>
      );
    }

    if (activePage === 'advanced') {
      return (
        <section className="page-section advanced">
          <h2>高级设置</h2>
          {settings ? (
            <>
              <section className="advanced-group path-management">
                <h3>路径管理</h3>
                <p className="hint">模型目录只保存本机 ASR 模型；同步数据目录保存 settings、词库、提示词、历史和冲突备份。GitHub 仓库位置请在 GitHub 同步页管理，不会在这里改动。</p>
                <PathRow title="模型目录" value={setup?.modelRoot ?? ''} onCopy={copyText} onOpen={openPath} onChange={chooseModelRootPath} />
                <PathRow title="同步数据目录" value={settings.dataDir ?? ''} onCopy={copyText} onOpen={openPath} onChange={chooseDataDir} />
                {pathMessage ? <p className="sync-message">{pathMessage}</p> : null}
              </section>

              <section className="advanced-group">
                <h3>语音识别模型 ASR</h3>
                <p className="hint">ASR 负责把语音转成原始文字。FireRed、SenseVoice、Fun-ASR-Nano 都属于 ASR，不负责高质量结构化整理。</p>
                <label>
                  ASR 模式
                  <select
                    value={settings.providers.asr.kind}
                    onChange={(event) =>
                      setSettings({
                        ...settings,
                        providers: {
                          ...settings.providers,
                          asr: {
                            ...settings.providers.asr,
                            kind: event.target.value as Settings['providers']['asr']['kind']
                          }
                        }
                      })
                    }
                  >
                    <option value="local-sherpa-onnx">本地 sherpa-onnx</option>
                    <option value="funasr-http">FunASR HTTP</option>
                    <option value="whisper-cpp">Whisper.cpp</option>
                  </select>
                </label>
                <label>
                  FunASR 服务地址
                  <input
                    className="no-drag"
                    value={settings.providers.asr.endpoint ?? ''}
                    onContextMenu={showEditMenu}
                    onChange={(event) =>
                      setSettings({
                        ...settings,
                        providers: {
                          ...settings.providers,
                          asr: { ...settings.providers.asr, endpoint: event.target.value }
                        }
                      })
                    }
                  />
                </label>
              </section>

              <button className="save" onClick={() => void saveSettings()}>
                保存高级设置
              </button>
            </>
          ) : (
            <p className="empty">加载中</p>
          )}
        </section>
      );
    }

    return (
      <section className="page-section">
        <h2>应用</h2>
        <p className="hint">关闭窗口会隐藏到菜单栏；需要结束后台进程时使用完全退出。</p>
        {settings ? (
          <section className="appearance-settings">
            <h3>外观</h3>
            <div className="segmented-control" role="radiogroup" aria-label="外观主题">
              {[
                ['system', '跟随系统'],
                ['light', '浅色'],
                ['dark', '深色']
              ].map(([value, label]) => (
                <button
                  key={value}
                  className={settings.appearance.theme === value ? 'active' : ''}
                  onClick={() => void updateTheme(value as Settings['appearance']['theme'])}
                >
                  {label}
                </button>
              ))}
            </div>
          </section>
        ) : null}
        {setup ? (
          <p className="build-info">
            当前版本 v{setup.appInfo.version} · {setup.appInfo.buildCommit}
          </p>
        ) : null}
         {settings && appUpdateState ? (
           <section className="update-panel">
             <h3>应用更新</h3>
             <p className="hint">{appUpdateStatusLabel(appUpdateState)}</p>
             {manualUpdateDownload ? (
               <p className="hint">macOS 暂不做无缝自动安装；检测到新版后会下载 DMG。</p>
             ) : null}
             {appUpdateState.latestVersion ? (
               <p>
                 最新版本 v{appUpdateState.latestVersion}
                {appUpdateState.releaseName ? ` · ${appUpdateState.releaseName}` : ''}
              </p>
            ) : null}
            {appUpdateState.status === 'downloading' ? (
              <>
                <div className="progress-track">
                  <span style={{ width: `${Math.min(100, Math.max(0, appUpdateState.percent ?? 0))}%` }} />
                </div>
                <p className="progress-meta">
                  {appUpdateState.percent !== undefined ? `${Math.round(appUpdateState.percent)}%` : '下载中'}
                  {appUpdateState.bytesPerSecond ? ` · ${formatBytes(appUpdateState.bytesPerSecond)}/s` : ''}
                  {appUpdateState.transferred ? ` · ${formatBytes(appUpdateState.transferred)}` : ''}
                  {appUpdateState.total ? ` / ${formatBytes(appUpdateState.total)}` : ''}
                </p>
              </>
            ) : null}
            {appUpdateState.error ? <p className="error-text">{appUpdateState.error}</p> : null}
            {appUpdateState.errorCode === 'mac-signature-mismatch' ? (
              <p className="hint">更新包签名不匹配时，当前版本需要先手动安装新版签名包作为桥接版本；之后自动更新会继续使用同一签名校验。</p>
            ) : null}
             <div className="inline-actions">
               <button className="secondary compact" onClick={() => void checkForUpdates()} disabled={Boolean(updateBusy)}>
                 {updateBusy === 'checking' ? '检查中' : '检查更新'}
               </button>
               {manualUpdateDownload ? (
                 <button className="secondary compact" onClick={() => void downloadUpdate()} disabled={Boolean(updateBusy)}>
                   下载新版
                 </button>
               ) : (
                 <>
                   <button className="secondary compact" onClick={() => void downloadUpdate()} disabled={Boolean(updateBusy) || appUpdateState.status !== 'available'}>
                     {updateBusy === 'downloading' ? '下载中' : '下载更新'}
                   </button>
                   <button className="secondary compact" onClick={() => void installUpdate()} disabled={appUpdateState.status !== 'downloaded'}>
                     立即安装并重启
                   </button>
                 </>
               )}
               <button className="secondary compact" onClick={() => void copyAppUpdateDiagnostics()}>
                 复制更新诊断
               </button>
            </div>
            <label className="setting-check">
              <input type="checkbox" checked={settings.updates.autoCheck} onChange={(event) => void updateUpdaterSetting({ autoCheck: event.target.checked })} />
              启动时自动检查更新
            </label>
            {manualUpdateDownload ? null : (
              <label className="setting-check">
                <input type="checkbox" checked={settings.updates.autoDownload} onChange={(event) => void updateUpdaterSetting({ autoDownload: event.target.checked })} />
                有新版时自动下载
              </label>
            )}
          </section>
        ) : null}
        <button className="secondary full-width" onClick={() => void window.v2t.quitApp()}>
          完全退出 V2T
        </button>
      </section>
    );
  })();

  return (
    <main className="shell">
      <aside className="app-sidebar">
        <div className="sidebar-brand">
          <p className="eyebrow">V2T</p>
          <h1>语音输入</h1>
          {setup ? (
            <p className="build-info">
              v{setup.appInfo.version} · {setup.appInfo.buildCommit}
            </p>
          ) : null}
        </div>
        <nav className="page-nav" aria-label="V2T 页面">
          {APP_PAGES.map((page) => (
            <button key={page.id} className={activePage === page.id ? 'active' : ''} onClick={() => setActivePage(page.id)}>
              {page.label}
            </button>
          ))}
        </nav>
      </aside>

      <section className="app-main">
        <header className="topbar">
          <div>
            <p className="eyebrow">当前页面</p>
            <h1>{currentPage.label}</h1>
          </div>
          <div className="status-row">
            <span className={`status-dot ${state}`} />
            <span>{stateLabel(state)}</span>
          </div>
        </header>

        <section className="page-content">
          {error ? <p className="error">{error}</p> : null}
          {pageContent}
        </section>
      </section>
    </main>
  );
}

function PathRow({
  title,
  value,
  onCopy,
  onOpen,
  onChange
}: {
  title: string;
  value: string;
  onCopy(value?: string): Promise<void>;
  onOpen(value?: string): Promise<void>;
  onChange(): Promise<void>;
}) {
  const usablePath = value && value !== '未选择' ? value : undefined;
  return (
    <article className="path-row">
      <div>
        <span>{title}</span>
        <p>{value || '未选择'}</p>
      </div>
      <div className="inline-actions">
        <button className="secondary compact" onClick={() => void onCopy(usablePath)} disabled={!usablePath}>
          复制
        </button>
        <button className="secondary compact" onClick={() => void onOpen(usablePath)} disabled={!usablePath}>
          打开
        </button>
        <button className="secondary compact" onClick={() => void onChange()}>
          更改位置
        </button>
      </div>
    </article>
  );
}

function LlmInstallerCard({
  target,
  busy,
  onOpenInstaller,
  onEnable
}: {
  target: LlmInstallerTarget;
  busy: string | null;
  onOpenInstaller(kind: LlmInstallerTarget['kind'], docs?: boolean): Promise<void>;
  onEnable(detection: LlmProviderDetection, model: string): Promise<void>;
}) {
  const available = target.status === 'service-available';
  const detection: LlmProviderDetection = {
    kind: target.kind,
    label: target.label,
    baseUrl: target.baseUrl,
    ok: available,
    models: target.models,
    error: target.error
  };

  return (
    <article className={`llm-installer-card ${available ? 'ok' : ''}`}>
      <div>
        <h3>{target.label}</h3>
        <p>{llmInstallerStatusLabel(target)}</p>
        <small>{target.baseUrl}</small>
        <p className="hint">{target.serviceHint}</p>
      </div>
      {available && target.models.length > 0 ? (
        <div className="llm-model-pills">
          {target.models.slice(0, 4).map((modelName) => (
            <button key={modelName} className="secondary compact" onClick={() => void onEnable(detection, modelName)}>
              启用 {shortModelName(modelName)}
            </button>
          ))}
        </div>
      ) : null}
      <div className="model-row-actions">
        <button className="secondary" onClick={() => void onOpenInstaller(target.kind)} disabled={busy === `${target.kind}-download`}>
          {busy === `${target.kind}-download` ? '打开中' : target.installActionLabel}
        </button>
        <button className="secondary" onClick={() => void onOpenInstaller(target.kind, true)} disabled={busy === `${target.kind}-docs`}>
          官方文档
        </button>
      </div>
    </article>
  );
}

function InstalledModelRow({
  model,
  activatingModelId,
  deletingModelId,
  onActivate,
  onReinstall,
  onDelete
}: {
  model: InstalledModelView;
  activatingModelId: string | null;
  deletingModelId: string | null;
  onActivate(modelId: string): Promise<void>;
  onReinstall(modelId: string): Promise<void>;
  onDelete(modelId: string): Promise<void>;
}) {
  const activating = activatingModelId === model.modelId;
  const deleting = deletingModelId === model.modelId;

  return (
    <article className={`model-row ${model.current ? 'current' : ''}`}>
      <div>
        <h3>{model.name}</h3>
        <p>{model.legacy ? '旧模型 · 本机已安装' : '本机已安装'}</p>
        <small>{model.modelPath ?? model.modelId}</small>
      </div>
      <div className="model-row-actions">
        <button onClick={() => void onActivate(model.modelId)} disabled={!model.canActivate || activating || model.current}>
          {model.current ? '当前' : activating ? '启用中' : '启用'}
        </button>
        {model.canReinstall ? (
          <button className="secondary" onClick={() => void onReinstall(model.modelId)}>
            重新安装
          </button>
        ) : null}
        {model.canDelete ? (
          <button className="danger" onClick={() => void onDelete(model.modelId)} disabled={deleting}>
            {deleting ? '删除中' : '删除'}
          </button>
        ) : null}
      </div>
    </article>
  );
}

function PromptEditor({
  title,
  path,
  value,
  dirty,
  onChange,
  onSave,
  onReset
}: {
  title: string;
  path: string;
  value: string;
  dirty: boolean;
  onChange(value: string): void;
  onSave(): void;
  onReset(): void;
}) {
  return (
    <section className="prompt-editor">
      <div className="section-heading">
        <div>
          <h3>{title}</h3>
          <p>{path}</p>
        </div>
        <div className="inline-actions">
          <button className="secondary compact" onClick={onReset}>
            恢复默认
          </button>
          <button className="secondary compact" onClick={onSave} disabled={!dirty}>
            保存
          </button>
        </div>
      </div>
      <textarea value={value} spellCheck={false} onChange={(event) => onChange(event.target.value)} />
    </section>
  );
}

function ModelComparisonTable({
  recommendations,
  referenceModels
}: {
  recommendations: ModelRecommendation[];
  referenceModels: ModelCatalogItem[];
}) {
  const rows = [
    ...recommendations.map((recommendation) => ({
      model: recommendation.model,
      score: recommendation.score,
      status: '可一键安装'
    })),
    ...referenceModels.map((model) => ({
      model,
      score: undefined,
      status: model.availability === 'manual' ? '可手动配置' : '待接入'
    }))
  ];

  return (
    <section className="comparison-panel" aria-label="模型横向对比">
      <h3>模型横向对比</h3>
      <div className="comparison-table">
        <div className="comparison-head">
          <span>模型</span>
          <span>中文推荐分</span>
          <span>中文/方言指标</span>
          <span>英文公开榜参考</span>
          <span>RTFx</span>
          <span>状态</span>
        </div>
        {rows.map(({ model, score, status }) => {
          const openAsr = model.evaluationSources?.openAsrLeaderboard;
          const chineseMetric = bestChineseMetricLabel(model);
          return (
            <div className="comparison-row" key={model.id}>
              <strong>{model.name}</strong>
              <ComparisonMetric value={score} label={score ? `${score}` : '参考'} max={100} />
              <ComparisonMetric value={chineseMetric.value} label={chineseMetric.label} lowerIsBetter={chineseMetric.lowerIsBetter} max={chineseMetric.max} />
              <ComparisonMetric value={openAsr?.avgWer} label={openAsr?.avgWer ? `WER ${openAsr.avgWer}%` : '无英文榜'} lowerIsBetter max={10} />
              <ComparisonMetric value={openAsr?.rtfx} label={openAsr?.rtfx ? `${Math.round(openAsr.rtfx)}` : '暂无'} max={3500} />
              <span>{status}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ComparisonMetric({
  value,
  label,
  max,
  lowerIsBetter = false
}: {
  value?: number;
  label: string;
  max: number;
  lowerIsBetter?: boolean;
}) {
  const normalized = value === undefined ? 0 : Math.max(0, Math.min(100, lowerIsBetter ? 100 - (value / max) * 100 : (value / max) * 100));
  return (
    <span className="comparison-metric">
      <i style={{ width: `${normalized}%` }} />
      <em>{label}</em>
    </span>
  );
}

function ReferenceModelRow({ model }: { model: ModelCatalogItem }) {
  const openAsr = model.evaluationSources?.openAsrLeaderboard;
  return (
    <article className="model-row reference">
      <div>
        <h3>{model.name}</h3>
        <div className="score-row">
          <strong>
            {openAsr?.exactModelMatch ? `Open ASR Rank ${openAsr.rank ?? '-'} · WER ${openAsr.avgWer ?? '-'} · RTFx ${openAsr.rtfx ?? '-'}` : '暂无 exact Open ASR 排名'}
          </strong>
          <span>{model.availability === 'manual' ? '可手动配置' : '待接入'}</span>
        </div>
        <p>{model.unavailableReason}</p>
        {model.manualSetup ? <p>配置办法：{model.manualSetup}</p> : null}
        <small>{model.sourceUrl}</small>
      </div>
      <div className="model-row-actions">
        <button disabled>{model.availability === 'manual' ? '手动配置' : '待接入'}</button>
      </div>
    </article>
  );
}

function ModelRow({
  recommendation,
  currentModelId,
  statusRecord,
  probeResult,
  probing,
  installingModelId,
  deletingModelId,
  onInstall,
  onReinstall,
  onCancelInstall,
  onImportArchive,
  onImportDirectory,
  onClearInstall,
  onTestDownload,
  onActivate,
  onDelete
}: {
  recommendation: ModelRecommendation;
  currentModelId?: string;
  statusRecord?: ModelStatusRecord;
  probeResult?: ModelDownloadProbeResult;
  probing: boolean;
  installingModelId: string | null;
  deletingModelId: string | null;
  onInstall(modelId: string): Promise<void>;
  onReinstall(modelId: string): Promise<void>;
  onCancelInstall(modelId: string): Promise<void>;
  onImportArchive(modelId: string): Promise<void>;
  onImportDirectory(modelId: string): Promise<void>;
  onClearInstall(modelId: string): Promise<void>;
  onTestDownload(modelId: string): Promise<void>;
  onActivate(modelId: string): Promise<void>;
  onDelete(modelId: string): Promise<void>;
}) {
  const isCurrent = currentModelId === recommendation.model.id;
  const status = statusRecord?.status;
  const installing = installingModelId === recommendation.model.id || isInstallInProgress(status);
  const deleting = deletingModelId === recommendation.model.id;
  const installed = status === 'installed' || status === 'current';
  const canDelete = !isCurrent && installed;
  const canClearResidue = !isCurrent && Boolean(statusRecord?.isInterrupted || statusRecord?.status === 'failed');
  const primaryInstallLabel = statusRecord?.status === 'failed' && statusRecord.canResume ? '继续下载' : '安装';

  return (
    <article className={`model-row ${isCurrent ? 'current' : ''}`}>
      <div>
        <h3>{recommendation.model.name}</h3>
        <div className="score-row">
          <strong>V2T 本机适配推荐分 {recommendation.score}/100</strong>
          <span>{recommendation.model.evaluationSources?.localRecommendation?.note}</span>
        </div>
        <div className="score-bars">
          <ScoreBar label="总分" value={recommendation.score} />
          {recommendation.scoreBreakdown.map((item) => (
            <ScoreBar key={item.label} label={item.label} value={item.value} max={40} title={item.reason} />
          ))}
        </div>
        <EvaluationSummary recommendation={recommendation} />
        <p>{recommendation.reasons.join(' · ')}</p>
       <small>
         {recommendation.model.sizeMb}MB · {recommendation.model.languages.join('/')}
       </small>
       <p className="progress-meta">导入模型：可选择已下载的官方压缩包，或选择已解压目录。</p>
       <DownloadProbeSummary result={probeResult} />
         {statusRecord ? <InstallProgress status={statusRecord} /> : null}
       </div>
      <div className="model-row-actions">
        <button
          onClick={() => void (installed ? onActivate(recommendation.model.id) : onInstall(recommendation.model.id))}
          disabled={installing || isCurrent}
        >
          {isCurrent ? '当前' : installing ? '安装中' : installed ? '启用' : primaryInstallLabel}
        </button>
        {installed || statusRecord?.status === 'failed' ? (
          <button className="secondary" onClick={() => void onReinstall(recommendation.model.id)} disabled={installing}>
            重新安装
          </button>
        ) : null}
        <button className="secondary" onClick={() => void onImportArchive(recommendation.model.id)} disabled={installing}>
          导入压缩包
        </button>
        <button className="secondary" onClick={() => void onImportDirectory(recommendation.model.id)} disabled={installing}>
          导入已解压目录
        </button>
        <button className="secondary" onClick={() => void onTestDownload(recommendation.model.id)} disabled={probing || installing}>
          {probing ? '测速中' : probeResult ? '重新测速' : '下载测速'}
        </button>
        {installing ? (
          <button className="secondary" onClick={() => void onCancelInstall(recommendation.model.id)}>
            取消
          </button>
        ) : null}
        {canClearResidue ? (
          <button className="secondary" onClick={() => void onClearInstall(recommendation.model.id)}>
            清除残留
          </button>
        ) : null}
        {canDelete ? (
          <button className="danger" onClick={() => void onDelete(recommendation.model.id)} disabled={deleting}>
            {deleting ? '删除中' : '删除'}
          </button>
        ) : null}
      </div>
    </article>
  );
}

function ScoreBar({ label, value, max = 100, title }: { label: string; value: number; max?: number; title?: string }) {
  const width = Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <div className="score-bar" title={title}>
      <span>{label}</span>
      <div>
        <i style={{ width: `${width}%` }} />
      </div>
      <strong>{value}</strong>
    </div>
  );
}

function EvaluationSummary({ recommendation }: { recommendation: ModelRecommendation }) {
  const sources = recommendation.model.evaluationSources;
  return (
    <div className="evaluation-summary">
      <section>
        <h4>中文评测</h4>
        {sources?.chineseBenchmark ? (
          <>
            <p>{sources.chineseBenchmark.note}</p>
            <div className="metric-list">
              {sources.chineseBenchmark.metrics.slice(0, 5).map((metric) => (
                <span key={`${metric.label}-${metric.metric}`}>
                  {metric.label} {formatMetric(metric)}
                </span>
              ))}
            </div>
          </>
        ) : (
          <p>暂无统一中文公开评测。</p>
        )}
      </section>
      <section>
        <h4>英文公开榜参考</h4>
        {sources?.openAsrLeaderboard ? (
          <p>
            {sources.openAsrLeaderboard.exactModelMatch
              ? `${sources.openAsrLeaderboard.track} · Rank ${sources.openAsrLeaderboard.rank ?? '-'} · WER ${sources.openAsrLeaderboard.avgWer ?? '-'} · RTFx ${sources.openAsrLeaderboard.rtfx ?? '-'}`
              : sources.openAsrLeaderboard.note}
          </p>
        ) : (
          <p>暂无 Open ASR Leaderboard exact match。</p>
        )}
      </section>
      <section>
        <h4>官方评测</h4>
        {sources?.officialBenchmark ? (
          <>
            <p>{sources.officialBenchmark.note}</p>
            <div className="metric-list">
              {sources.officialBenchmark.metrics.slice(0, 5).map((metric) => (
                <span key={`${metric.label}-${metric.metric}`}>
                  {metric.label} {formatMetric(metric)}
                </span>
              ))}
            </div>
          </>
        ) : (
          <p>暂无统一公开评测。</p>
        )}
      </section>
    </div>
  );
}

function InstallProgress({ status }: { status: ModelStatusRecord }) {
  if (!isInstallInProgress(status.status) && status.status !== 'failed') {
    return null;
  }

  return (
    <div className="install-progress">
      <div>
        <span>{installStatusLabel(status)}</span>
        {status.progress === undefined && status.downloadedBytes ? <span>{formatBytes(status.downloadedBytes)}</span> : null}
      </div>
      <p className="progress-meta">
        {[
          status.sourceLabel,
          status.bytesPerSecond ? `${formatBytes(status.bytesPerSecond)}/s` : undefined,
          status.etaSeconds ? `剩余 ${formatDuration(status.etaSeconds)}` : undefined,
          status.attempt ? `第 ${status.attempt} 次` : undefined
        ]
          .filter(Boolean)
          .join(' · ')}
      </p>
      {status.downloadedBytes ? (
        <p className="progress-meta">
          {formatBytes(status.downloadedBytes)}
          {status.totalBytes ? ` / ${formatBytes(status.totalBytes)}` : ''}
        </p>
      ) : null}
      {status.progress !== undefined ? (
        <div className="progress-track">
          <span style={{ width: `${Math.min(100, Math.max(0, status.progress))}%` }} />
        </div>
      ) : (
        <div className="progress-track indeterminate">
          <span />
        </div>
      )}
      {status.error ? <p className="progress-error">{status.error}</p> : null}
    </div>
  );
}

function DownloadProbeSummary({ result }: { result?: ModelDownloadProbeResult }) {
  if (!result) {
    return <p className="progress-meta">下载测速可检测当前源速度、耗时和是否支持断点续传。</p>;
  }

  return (
    <div className={`download-probe ${result.ok ? 'ok' : 'failed'}`}>
      <p className="progress-meta">
        {[
          result.sourceLabel,
          result.ok ? '测速成功' : '测速失败',
          result.bytesPerSecond ? `${formatBytes(result.bytesPerSecond)}/s` : undefined,
          result.downloadedBytes ? `测试 ${formatBytes(result.downloadedBytes)}` : undefined,
          `${Math.max(1, Math.round(result.durationMs / 1000))} 秒`,
          result.supportsRange ? '支持断点续传' : '未确认断点续传'
        ]
          .filter(Boolean)
          .join(' · ')}
      </p>
      {result.error ? <p className="progress-error">{result.error}</p> : null}
      <small>{result.url}</small>
    </div>
  );
}

function historyEntryToLocalItem(entry: HistoryEntry): LocalHistoryItem {
  return {
    id: entry.id,
    rawText: entry.rawText,
    outputText: entry.outputText,
    createdAt: entry.createdAt,
    mode: entry.mode,
    injection: {
      method: entry.injectionMethod,
      error: entry.error
    },
    usedLlm:
      entry.postProcessorEngine === 'llm' ||
      entry.postProcessorEngine === 'llm-local' ||
      entry.postProcessorEngine === 'llm-cloud' ||
      entry.postProcessorEngine === 'llm-fallback',
    postProcessorEngine: entry.postProcessorEngine ?? 'local-rules'
  };
}

function stateLabel(state: RecordingState): string {
  if (state === 'starting') {
    return '启动中';
  }
  if (state === 'recording') {
    return '录音中';
  }
  if (state === 'processing') {
    return '处理中';
  }
  if (state === 'error') {
    return '异常';
  }
  return '待命';
}

function tierLabel(tier: string): string {
  if (tier === 'high') {
    return '高性能';
  }
  if (tier === 'medium') {
    return '均衡';
  }
  return '轻量';
}

function modeLabel(inputMode: InputMode): string {
  return inputMode === 'natural' ? '自然输入' : '结构输入';
}

function structuredEngineLabel(settings: Settings | null): string {
  const engine = settings?.providers.llm.engine ?? 'off';
  if (engine === 'local') {
    return '本地 LLM Prompt';
  }
  if (engine === 'cloud') {
    return '云端 LLM Prompt';
  }
  if (engine === 'local-with-cloud-fallback') {
    return '本地 LLM Prompt + 云端兜底';
  }
  return '本地规则';
}

function llmPromptUsageHint(settings: Settings | null): string {
  const engine = settings?.providers.llm.engine ?? 'off';
  if (engine === 'off') {
    return 'Prompt 仅在启用 LLM 后生效；未启用时结构输入使用本地规则。';
  }
  if (engine === 'cloud') {
    return '当前会把对应 Prompt 和整理文本发送给云端文本整理模型。';
  }
  if (engine === 'local-with-cloud-fallback') {
    return '当前优先使用本地 Prompt；本地失败时会把文本发送给云端兜底模型。';
  }
  return '当前会把对应 Prompt 发送给本地文本整理模型 LLM。';
}

function llmEngineName(engine: Settings['providers']['llm']['engine']): string {
  if (engine === 'local') {
    return '本地 LLM';
  }
  if (engine === 'cloud') {
    return '云端模型';
  }
  if (engine === 'local-with-cloud-fallback') {
    return '本地优先，云端兜底';
  }
  return '本地规则';
}

function llmEngineHint(engine: Settings['providers']['llm']['engine']): string {
  if (engine === 'local') {
    return '使用 Ollama、LM Studio 或本机兼容服务，不上传文本。';
  }
  if (engine === 'cloud') {
    return '直接使用 OpenAI-compatible 云端 API，速度和稳定性通常更好。';
  }
  if (engine === 'local-with-cloud-fallback') {
    return '先跑本地；本地超时、空结果或失败时再调用云端。';
  }
  return '不调用 LLM，只用基础规则做轻量整理。';
}

function llmEngineLabel(settings: Settings): string {
  const engine = settings.providers.llm.engine;
  if (engine === 'local') {
    return `${providerLabel(settings.providers.llm.kind)} · ${settings.providers.llm.model || '未选择模型'}`;
  }
  if (engine === 'cloud') {
    return `云端模型 · ${settings.providers.llm.fallback.model || '未选择模型'}`;
  }
  if (engine === 'local-with-cloud-fallback') {
    return `本地优先 · ${settings.providers.llm.model || '未选择模型'}`;
  }
  return '本地规则';
}

function llmEngineDescription(settings: Settings): string {
  const engine = settings.providers.llm.engine;
  if (engine === 'local') {
    return `${settings.providers.llm.baseUrl || '未配置 Local Base URL'} · 不上传到云端`;
  }
  if (engine === 'cloud') {
    return `${settings.providers.llm.fallback.baseUrl || '未配置 Cloud Base URL'} · 文字会发送到第三方 API`;
  }
  if (engine === 'local-with-cloud-fallback') {
    return `${settings.providers.llm.baseUrl || '未配置 Local Base URL'}；失败时使用 ${
      settings.providers.llm.fallback.baseUrl || '未配置 Cloud Base URL'
    }`;
  }
  return 'Prompt 不会生效，结构输入使用内置本地规则。';
}

function postProcessorEngineLabel(engine?: HistoryEntry['postProcessorEngine']): string {
  if (engine === 'llm-local' || engine === 'llm') {
    return '本地 LLM';
  }
  if (engine === 'llm-cloud') {
    return '云端模型';
  }
  if (engine === 'llm-fallback') {
    return '云端兜底';
  }
  return '本地规则';
}

function providerLabel(kind: Settings['providers']['llm']['kind']): string {
  if (kind === 'ollama') {
    return 'Ollama';
  }
  if (kind === 'lm-studio') {
    return 'LM Studio';
  }
  return 'OpenAI-compatible';
}

function llmInstallerStatusLabel(target: LlmInstallerTarget): string {
  if (target.status === 'service-available') {
    return `服务可用 · ${target.models.length || 0} 个模型`;
  }
  if (target.status === 'installed-not-running') {
    return `未检测到本地服务${target.error ? `：${target.error}` : ''}`;
  }
  if (target.status === 'error') {
    return `检测失败${target.error ? `：${target.error}` : ''}`;
  }
  return '未检测到本地服务';
}

function currentAsrLabel(settings: Settings | null): string {
  if (!settings) {
    return '加载中';
  }
  if (settings.providers.asr.modelId) {
    return settings.providers.asr.modelId;
  }
  if (settings.providers.asr.kind === 'funasr-http') {
    return 'FunASR HTTP';
  }
  if (settings.providers.asr.kind === 'whisper-cpp') {
    return 'Whisper.cpp';
  }
  return '本地 sherpa-onnx';
}

function shortModelName(modelName: string): string {
  return modelName.length > 18 ? `${modelName.slice(0, 15)}...` : modelName;
}

function oppositeMode(inputMode: InputMode): InputMode {
  return inputMode === 'natural' ? 'structured' : 'natural';
}

function isInstallInProgress(status?: string): boolean {
  return status === 'downloading' || status === 'extracting' || status === 'verifying' || status === 'activating';
}

function installStatusLabel(status: ModelStatusRecord): string {
  if (status.status === 'downloading') {
    return status.progress === undefined ? '下载中' : `下载中 ${status.progress}%`;
  }
  if (status.status === 'extracting') {
    return '解压中';
  }
  if (status.status === 'verifying') {
    return '校验中';
  }
  if (status.status === 'activating') {
    return '启用中';
  }
  if (status.status === 'failed') {
    return '安装失败';
  }
  return '';
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / 1024 / 1024 / 1024).toFixed(1)}GB`;
  }
  if (bytes >= 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1)}KB`;
  }
  return `${bytes}B`;
}

function formatDuration(seconds: number): string {
  if (seconds >= 3600) {
    return `${Math.round(seconds / 3600)} 小时`;
  }
  if (seconds >= 60) {
    return `${Math.round(seconds / 60)} 分钟`;
  }
  return `${Math.max(1, Math.round(seconds))} 秒`;
}

function formatMetric(metric: ModelEvaluationMetric): string {
  if (metric.metric === 'RTFx') {
    return `${metric.value} RTFx`;
  }
  if (metric.metric === 'Rank') {
    return `${metric.value}`;
  }
  return `${metric.value}% ${metric.metric}`;
}

function bestChineseMetricLabel(model: ModelCatalogItem): { value?: number; label: string; max: number; lowerIsBetter: boolean } {
  const metrics = model.evaluationSources?.chineseBenchmark?.metrics ?? [];
  const cerOrWer = metrics.find((metric) => metric.metric === 'CER' || metric.metric === 'WER');
  if (cerOrWer) {
    return {
      value: cerOrWer.value,
      label: `${cerOrWer.label} ${formatMetric(cerOrWer)}`,
      max: cerOrWer.metric === 'CER' ? 20 : 30,
      lowerIsBetter: true
    };
  }
  const rank = metrics.find((metric) => metric.metric === 'Rank');
  if (rank) {
    return { value: rank.value, label: `${rank.label} ${formatMetric(rank)}`, max: 5, lowerIsBetter: false };
  }
  return { label: '暂无中文指标', max: 1, lowerIsBetter: false };
}

function catalogRefreshLabel(state: ModelCatalogRefreshState): string {
  if (state.status === 'refreshing') {
    return '刷新中';
  }
  if (state.status === 'success') {
    return state.message ?? '已刷新';
  }
  if (state.status === 'failed') {
    return state.message ?? '刷新失败，使用内置榜单';
  }
  return state.message ?? '使用内置模型榜单';
}

function autoSyncStatusLabel(state: AutoSyncState | null, settings: Settings): string {
  if (!settings.sync.github.autoSync) {
    return '未开启';
  }
  if (state?.status === 'queued') {
    return '已排队，稍后自动同步';
  }
  if (state?.status === 'syncing') {
    return '同步中';
  }
  if (state?.status === 'failed') {
    return `失败：${state.error ?? settings.sync.github.lastAutoSyncError ?? '未知错误'}`;
  }
  if (settings.sync.github.lastAutoSyncAt) {
    return `上次自动同步 ${new Date(settings.sync.github.lastAutoSyncAt).toLocaleString()}`;
  }
  return '待命';
}

function appUpdateStatusLabel(state: AppUpdateState): string {
  if (state.status === 'checking') {
    return '正在检查更新';
  }
  if (state.status === 'available') {
    return '发现新版本，可以下载';
  }
  if (state.status === 'not-available') {
    return '当前已是最新版本';
  }
  if (state.status === 'downloading') {
    return '正在下载更新';
  }
  if (state.status === 'downloaded') {
    return '更新已下载，可以安装';
  }
  if (state.status === 'installing') {
    return '正在准备安装更新';
  }
  if (state.status === 'error') {
    return '更新检查失败';
  }
  return '自动更新待命';
}

function hotkeyStatusLabel(status?: HotkeyStatus): string {
  if (!status) {
    return '初始化';
  }
  if (status.checking) {
    return '检测中';
  }
  if (status.backend === 'native-listener' && status.helperVerified) {
    return '系统监听已验证；备用快捷键待命';
  }
  if (status.backend === 'native-listener' && status.helperStarted && !status.helperVerified) {
    return `系统监听中：${hotkeyLabel(status.requestedAccelerator ?? status.activeAccelerator ?? '')}；备用快捷键待命`;
  }
  if (status.fallbackRegistered && status.nativeActive === false) {
    const prefix = status.helperAttempted ? '系统监听未确认；备用快捷键已启用' : '备用快捷键已启用';
    return `${prefix}：${hotkeyLabel(status.activeAccelerator ?? '')}`;
  }
  if (status.fallbackRegistered && status.nativeActive) {
    return '系统监听已注册；备用快捷键待命';
  }
  if (!status.registered) {
    return `${hotkeyBackendLabel(status.backend)} 未注册`;
  }
  return `${hotkeyBackendLabel(status.backend)} 已注册`;
}

function hotkeyHelperStateLabel(status: HotkeyStatus): string {
  if (status.helperVerified || status.nativeActive) {
    return '已收到系统按键事件';
  }
  if (status.helperStarted) {
    return '已启动，按一次快捷键完成验证';
  }
  if (status.helperAttempted) {
    return '正在启动或等待诊断';
  }
  return '尚未开始';
}

function hotkeyPermissionHint(status?: HotkeyStatus): string {
  if (status?.permissionKind === 'windows-native-hook') {
    return 'Windows Raw Input 监听无需额外系统授权；如果 Defender 已隔离 WinKeyServer.exe，不要恢复旧文件。新版只使用 V2TKeyboardListener.exe。';
  }
  if (status?.permissionKind === 'none') {
    return '当前快捷键使用系统组合键注册，不需要额外权限。';
  }
  if (status?.nativeHelperPath) {
    return `纯修饰键需要 macOS 辅助功能权限；请给监听组件 ${status.nativeHelperPath} 开启权限。如果已添加权限但仍无效，请完全退出 V2T 后重新打开；如果仍失败，移除 MacKeyServer 和 V2T 后重新添加。`;
  }
  return '单键或纯修饰键需要 macOS 辅助功能权限。如果已添加权限但仍无效，请完全退出 V2T 后重新打开；如果仍失败，移除 MacKeyServer 和 V2T 后重新添加。';
}

function hotkeyBackendLabel(backend: HotkeyStatus['backend']): string {
  return backend === 'native-listener' ? '系统监听' : 'Electron 快捷键';
}

function parseDelimitedList(value: string): string[] {
  return value
    .split(/[,，\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function capturedKeysFromEvent(event: React.KeyboardEvent<HTMLButtonElement>): string[] {
  const currentModifier = sideSpecificModifierFromCode(event.code);
  if (currentModifier) {
    return [currentModifier];
  }

  const keys = [
    event.metaKey ? 'Meta' : '',
    event.ctrlKey ? 'Control' : '',
    event.altKey ? 'Alt' : '',
    event.shiftKey ? 'Shift' : ''
  ].filter(Boolean);

  if (event.key && !keys.includes(event.key)) {
    keys.push(event.key);
  }

  return keys;
}

function sideSpecificModifierFromCode(code: string): string | null {
  if (code === 'AltRight') {
    return 'AltRight';
  }
  if (code === 'AltLeft') {
    return 'AltLeft';
  }
  if (code === 'MetaRight') {
    return 'MetaRight';
  }
  if (code === 'MetaLeft') {
    return 'MetaLeft';
  }
  if (code === 'ControlRight') {
    return 'ControlRight';
  }
  if (code === 'ControlLeft') {
    return 'ControlLeft';
  }
  if (code === 'ShiftRight') {
    return 'ShiftRight';
  }
  if (code === 'ShiftLeft') {
    return 'ShiftLeft';
  }
  return null;
}

function hotkeyLabel(accelerator: string): string {
  return hotkeyLabelForPlatform(accelerator, hotkeyPlatform());
}

function hotkeyPlatform(): NodeJS.Platform {
  return navigator.platform.toLowerCase().includes('mac') ? 'darwin' : 'win32';
}

function encodeWav(chunks: Float32Array[], inputSampleRate: number, outputSampleRate: number): Uint8Array {
  const samples = mergeChunks(chunks);
  const resampled = resample(samples, inputSampleRate, outputSampleRate);
  const buffer = new ArrayBuffer(44 + resampled.length * 2);
  const view = new DataView(buffer);
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + resampled.length * 2, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, outputSampleRate, true);
  view.setUint32(28, outputSampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, 'data');
  view.setUint32(40, resampled.length * 2, true);

  let offset = 44;
  for (const sample of resampled) {
    const clamped = Math.max(-1, Math.min(1, sample));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += 2;
  }

  return new Uint8Array(buffer);
}

function mergeChunks(chunks: Float32Array[]): Float32Array {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Float32Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

function resample(samples: Float32Array, inputSampleRate: number, outputSampleRate: number): Float32Array {
  if (inputSampleRate === outputSampleRate) {
    return samples;
  }

  const ratio = inputSampleRate / outputSampleRate;
  const length = Math.floor(samples.length / ratio);
  const output = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    output[i] = samples[Math.floor(i * ratio)] ?? 0;
  }
  return output;
}

function writeString(view: DataView, offset: number, value: string): void {
  for (let i = 0; i < value.length; i += 1) {
    view.setUint8(offset + i, value.charCodeAt(i));
  }
}
