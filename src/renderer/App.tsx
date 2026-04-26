import { useCallback, useEffect, useRef, useState } from 'react';
import { referenceModels } from '../core/modelCatalog';
import { hotkeyLabelForPlatform } from '../core/hotkeyLabels';
import { normalizeAccelerator, shortcutFromRecordedKeys } from '../core/hotkeyRecorder';
import type {
  AutoSyncState,
  HistoryEntry,
  InputMode,
  InstalledModelView,
  Lexicon,
  ModelCatalogItem,
  ModelCatalogRefreshState,
  ModelEvaluationMetric,
  ModelRecommendation,
  ModelStatusRecord,
  PromptFiles,
  Settings,
  VoiceInputPipelineResult
} from '../core/types';
import type { HotkeyStatus } from '../main/hotkeyService';
import type { RecordingCommand, SetupPayload } from '../preload';

type RecordingState = 'idle' | 'starting' | 'recording' | 'processing' | 'error';
type AppPage = 'voice' | 'models' | 'hotkey' | 'lexicon' | 'prompts' | 'sync' | 'advanced' | 'app';

const APP_PAGES: Array<{ id: AppPage; label: string }> = [
  { id: 'voice', label: '语音输入' },
  { id: 'models', label: '模型' },
  { id: 'hotkey', label: '快捷键' },
  { id: 'lexicon', label: '词库' },
  { id: 'prompts', label: '提示词' },
  { id: 'sync', label: 'GitHub 同步' },
  { id: 'advanced', label: '高级设置' },
  { id: 'app', label: '应用' }
];

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
  const [state, setState] = useState<RecordingState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<LocalHistoryItem[]>([]);
  const [activeRecordingMode, setActiveRecordingMode] = useState<InputMode | null>(null);
  const [hotkeyStatus, setHotkeyStatus] = useState<HotkeyStatus | undefined>();
  const [capturingHotkey, setCapturingHotkey] = useState(false);
  const [installingModelId, setInstallingModelId] = useState<string | null>(null);
  const [catalogRefreshing, setCatalogRefreshing] = useState(false);
  const [installProgressById, setInstallProgressById] = useState<Record<string, ModelStatusRecord>>({});
  const [activatingModelId, setActivatingModelId] = useState<string | null>(null);
  const [deletingModelId, setDeletingModelId] = useState<string | null>(null);
  const [syncRepoUrl, setSyncRepoUrl] = useState('');
  const [syncBusy, setSyncBusy] = useState<string | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [autoSyncState, setAutoSyncState] = useState<AutoSyncState | null>(null);
  const [testingHotkey, setTestingHotkey] = useState(false);
  const [hotkeyTestMessage, setHotkeyTestMessage] = useState<string | null>(null);
  const [lexicon, setLexicon] = useState<Lexicon | null>(null);
  const [lexiconDirty, setLexiconDirty] = useState(false);
  const [lexiconMessage, setLexiconMessage] = useState<string | null>(null);
  const [prompts, setPrompts] = useState<PromptFiles | null>(null);
  const [promptDrafts, setPromptDrafts] = useState<{ natural: string; structured: string }>({ natural: '', structured: '' });
  const [promptDirty, setPromptDirty] = useState<{ natural: boolean; structured: boolean }>({ natural: false, structured: false });
  const [promptMessage, setPromptMessage] = useState<string | null>(null);
  const recorderRef = useRef<PcmRecorder | null>(null);
  const modeRef = useRef<InputMode>('natural');
  const recordingStateRef = useRef<RecordingState>('idle');
  const recordingStartedAtRef = useRef<number | undefined>(undefined);
  const recordingElapsedMsRef = useRef<number | undefined>(undefined);
  const inputLevelRef = useRef(0);
  const inputActiveRef = useRef(false);
  const silenceStartedAtRef = useRef<number | undefined>(undefined);
  const silenceMsRef = useRef(0);
  const capturedHotkeyKeysRef = useRef<Set<string>>(new Set());

  const applySetup = useCallback((nextSetup: SetupPayload) => {
    setSetup(nextSetup);
    setSettings(nextSetup.settings);
    setMode(nextSetup.settings.defaultMode);
    setHotkeyStatus(nextSetup.hotkeyStatus);
    setAutoSyncState(nextSetup.autoSyncState);
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

  const stopRecording = useCallback(() => {
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
  }, [resetInputMeter]);

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
    } catch (caught) {
      recordingStartedAtRef.current = undefined;
      recordingElapsedMsRef.current = undefined;
      recordingStateRef.current = 'error';
      setActiveRecordingMode(null);
      resetInputMeter();
      setState('error');
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }, [resetInputMeter, updateInputMeter]);

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

  const openAccessibilitySettings = async () => {
    await window.v2t.openAccessibilitySettings();
  };

  const refreshHotkeyPermissions = async () => {
    setHotkeyTestMessage('正在重新检测系统键盘监听');
    applySetup(await window.v2t.refreshHotkeyPermissions());
  };

  const refreshModelCatalog = async () => {
    setCatalogRefreshing(true);
    try {
      applySetup(await window.v2t.refreshModelCatalog());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setCatalogRefreshing(false);
    }
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
    setHotkeyTestMessage('正在修复监听组件');
    const result = await window.v2t.repairHotkeyHelper();
    applySetup(result.setup);
    setHotkeyTestMessage(result.ok ? '监听组件已修复并重新检测' : result.error ?? '监听组件修复失败');
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

  const connectSyncRepo = async () => {
    setError(null);
    setSyncMessage(null);
    setSyncBusy('connect');
    const result = await window.v2t.connectSyncRepo(syncRepoUrl.trim());
    setSyncBusy(null);
    if (result.setup) {
      applySetup(result.setup);
    }
    if (result.ok) {
      setSyncMessage('同步仓库已连接');
    } else {
      setError(result.error ?? '同步仓库连接失败');
    }
  };

  const pullSync = async () => {
    setError(null);
    setSyncMessage(null);
    setSyncBusy('pull');
    const result = await window.v2t.pullSync();
    setSyncBusy(null);
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

    if (activePage === 'models') {
      return (
        <section className="page-section">
          <h2>推荐安装</h2>
          {setup ? (
            <>
              <p className="hint">
                {setup.hardware.cpuName} · {setup.hardware.memoryGb}GB · {tierLabel(setup.hardware.recommendedTier)}
              </p>
              <p className="hint">中文推荐分优先看普通话、方言/粤语、中英混输和本机可运行性；Open ASR 英文榜只作参考。V2T 本机适配分只表示这台设备上的推荐优先级。WER/CER 越低越好，RTFx 越高越快。</p>
              <section className="catalog-refresh">
                <div>
                  <span>模型榜单</span>
                  <strong>{catalogRefreshLabel(setup.modelCatalogRefresh)}</strong>
                  <p>
                    上次刷新 {setup.modelCatalogRefresh.lastRefreshAt ? new Date(setup.modelCatalogRefresh.lastRefreshAt).toLocaleString() : '尚未刷新'} · 版本{' '}
                    {setup.modelCatalogRefresh.catalogVersion ?? '内置'}
                  </p>
                  {setup.modelCatalogRefresh.error ? <p className="error-text">{setup.modelCatalogRefresh.error}</p> : null}
                </div>
                <button className="secondary compact" onClick={() => void refreshModelCatalog()} disabled={catalogRefreshing}>
                  {catalogRefreshing ? '刷新中' : '刷新模型榜单'}
                </button>
              </section>
              <ModelComparisonTable recommendations={setup.recommendations} referenceModels={referenceCatalog} />
              <div className="model-list">
                {setup.recommendations.map((recommendation) => (
                  <ModelRow
                    key={recommendation.model.id}
                    recommendation={recommendation}
                    currentModelId={settings?.providers.asr.modelId}
                    statusRecord={installProgressById[recommendation.model.id] ?? setup.modelStatuses[recommendation.model.id]}
                    installingModelId={installingModelId}
                    deletingModelId={deletingModelId}
                    onInstall={installModel}
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

    if (activePage === 'hotkey') {
      return (
        <section className="page-section">
          <h2>快捷键</h2>
          <p className="hint">单击快捷键 {modeLabel(settings?.hotkey.singleClickMode ?? 'natural')}，双击快捷键 {modeLabel(settings?.hotkey.doubleClickMode ?? 'structured')}；录音稳定开始后再次触发会停止当前录音。</p>
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
                <dd>{hotkeyStatus.helperFileExists ? '存在' : '缺失，请修复或检查安全软件隔离记录'}</dd>
              </div>
            ) : null}
            {hotkeyStatus?.repairAttempted !== undefined ? (
              <div>
                <dt>自动修复</dt>
                <dd>{hotkeyStatus.repairError ? `失败：${hotkeyStatus.repairError}` : hotkeyStatus.repairAttempted ? '已检查并尝试修复' : '未执行'}</dd>
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
                修复监听组件
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
                建议使用一个单独的私有仓库，例如 v2t-sync。连接后 V2T 会在本机创建 sync-repo，并同步
                settings.json、lexicon.json、prompts/natural.md、prompts/structured.md。词库页保存只改本地 lexicon.json，需要点击“推送”才会写入 GitHub。
                模型和密钥不会同步；同步历史默认关闭，可以在这里单独开启。
              </p>
              <label>
                仓库 URL
                <input
                  value={syncRepoUrl}
                  placeholder="git@github.com:you/v2t-sync.git"
                  spellCheck={false}
                  autoCapitalize="off"
                  autoCorrect="off"
                  onChange={(event) => setSyncRepoUrl(event.target.value)}
                />
              </label>
              <dl>
                <div>
                  <dt>本地仓库</dt>
                  <dd>{settings.sync.github.localPath ?? '未连接'}</dd>
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
              <button className="save" onClick={() => void syncAll()} disabled={Boolean(syncBusy)}>
                {syncBusy === 'sync' ? '同步中' : '一键同步'}
              </button>
              <div className="button-row three">
                <button className="secondary" onClick={() => void connectSyncRepo()} disabled={Boolean(syncBusy)}>
                  {syncBusy === 'connect' ? '连接中' : '连接'}
                </button>
                <button className="secondary" onClick={() => void pullSync()} disabled={Boolean(syncBusy)}>
                  {syncBusy === 'pull' ? '拉取中' : '拉取'}
                </button>
                <button className="secondary" onClick={() => void pushSync()} disabled={Boolean(syncBusy)}>
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
              <label>
                当前模型目录
                <input value={setup?.modelRoot ?? ''} readOnly />
              </label>
              <label>
                同步数据目录
                <input value={settings.dataDir ?? ''} readOnly />
              </label>
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
                  <option value="local-sherpa-onnx">本地 SenseVoice</option>
                  <option value="funasr-http">FunASR HTTP</option>
                  <option value="whisper-cpp">Whisper.cpp</option>
                </select>
              </label>
              <label>
                FunASR 服务地址
                <input
                  value={settings.providers.asr.endpoint ?? ''}
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
              <label>
                LLM Base URL
                <input
                  value={settings.providers.llm.baseUrl}
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
                LLM Model
                <input
                  value={settings.providers.llm.model}
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
              <label className="check">
                <input
                  type="checkbox"
                  checked={settings.providers.llm.enabled}
                  onChange={(event) =>
                    setSettings({
                      ...settings,
                      providers: {
                        ...settings.providers,
                        llm: { ...settings.providers.llm, enabled: event.target.checked }
                      }
                    })
                  }
                />
                结构输入使用 LLM
              </label>
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

function InstalledModelRow({
  model,
  activatingModelId,
  deletingModelId,
  onActivate,
  onDelete
}: {
  model: InstalledModelView;
  activatingModelId: string | null;
  deletingModelId: string | null;
  onActivate(modelId: string): Promise<void>;
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
      <button onClick={() => void onActivate(model.modelId)} disabled={!model.canActivate || activating || model.current}>
        {model.current ? '当前' : activating ? '启用中' : '启用'}
      </button>
      {model.canDelete ? (
        <button className="danger" onClick={() => void onDelete(model.modelId)} disabled={deleting}>
          {deleting ? '删除中' : '删除'}
        </button>
      ) : null}
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
      <button disabled>{model.availability === 'manual' ? '手动配置' : '待接入'}</button>
    </article>
  );
}

function ModelRow({
  recommendation,
  currentModelId,
  statusRecord,
  installingModelId,
  deletingModelId,
  onInstall,
  onActivate,
  onDelete
}: {
  recommendation: ModelRecommendation;
  currentModelId?: string;
  statusRecord?: ModelStatusRecord;
  installingModelId: string | null;
  deletingModelId: string | null;
  onInstall(modelId: string): Promise<void>;
  onActivate(modelId: string): Promise<void>;
  onDelete(modelId: string): Promise<void>;
}) {
  const isCurrent = currentModelId === recommendation.model.id;
  const status = statusRecord?.status;
  const installing = installingModelId === recommendation.model.id || isInstallInProgress(status);
  const deleting = deletingModelId === recommendation.model.id;
  const installed = status === 'installed' || status === 'current';
  const canDelete = !isCurrent && installed;

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
        {statusRecord ? <InstallProgress status={statusRecord} /> : null}
      </div>
      <button
        onClick={() => void (installed ? onActivate(recommendation.model.id) : onInstall(recommendation.model.id))}
        disabled={installing || isCurrent}
      >
        {isCurrent ? '当前' : installing ? '安装中' : installed ? '启用' : '安装'}
      </button>
      {canDelete ? (
        <button className="danger" onClick={() => void onDelete(recommendation.model.id)} disabled={deleting}>
          {deleting ? '删除中' : '删除'}
        </button>
      ) : null}
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
    usedLlm: false
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
    return 'Windows 系统键盘监听无需额外系统授权；如果组件文件缺失，请点击“修复监听组件”，并检查 Windows 安全中心/Defender 是否隔离了 WinKeyServer.exe。';
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
