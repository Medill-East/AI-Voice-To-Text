import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import { cloudLlmTags, sortCloudLlmModels } from '../core/cloudLlmCatalogShared';
import type { CloudLlmSortDirection } from '../core/cloudLlmCatalogShared';
import { cloudBatchRetryDelayMs, selectBestCloudLlmCandidate } from '../core/cloudLlmEvaluation';
import { localSherpaRuntimeLabel, resolveLocalSherpaRuntime } from '../core/asrRuntime';
import { analyzeLexicon } from '../core/postProcessor';
import { oneClickEligibility, oneClickInstallableModels, publicChineseMetrics, referenceModels, scoreModel } from '../core/modelCatalog';
import { hotkeyLabelForPlatform } from '../core/hotkeyLabels';
import { normalizeAccelerator, shortcutFromRecordedKeys } from '../core/hotkeyRecorder';
import type {
  AppUpdateState,
  AsrCudaStatus,
  AsrBenchmarkBatchState,
  AutoSyncState,
  CloudAsrTestResult,
  CloudLlmModelCatalogState,
  CloudLlmModelView,
  CloudLlmSortKey,
  GitHubSyncStatus,
  HistoryEntry,
  InputMode,
  InstalledModelView,
  Lexicon,
  LexiconTextFiles,
  LexiconTextKind,
  LlmInstallerTarget,
  LlmProviderDetection,
  ModelBenchmarkResult,
  ModelCatalogItem,
  ModelCatalogRefreshState,
  ModelDownloadProbeResult,
  ModelEvaluationMetric,
  ModelRecommendation,
  ModelStatusRecord,
  PromptFiles,
  Settings,
  SyncImportStrategy,
  UsageAggregate,
  UsageStatistics,
  VoiceInputRecoveryJob,
  VoiceInputPipelineResult
} from '../core/types';
import type { HotkeyStatus } from '../main/hotkeyService';
import type { RecordingCommand, SetupPayload } from '../preload';

type RecordingState = 'idle' | 'starting' | 'recording' | 'processing' | 'error';
type AppPage = 'voice' | 'asrModels' | 'llmModels' | 'statistics' | 'hotkey' | 'lexicon' | 'prompts' | 'sync' | 'advanced' | 'app';
type LlmSettingsPage = 'local' | 'cloud';
type AsrModelsPage = 'installable' | 'cloud' | 'reference' | 'guide';

const APP_PAGES: Array<{ id: AppPage; label: string }> = [
  { id: 'voice', label: '语音输入' },
  { id: 'asrModels', label: '语音识别模型' },
  { id: 'llmModels', label: '文本整理模型' },
  { id: 'statistics', label: '统计' },
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
const CLOUD_MODELS_PAGE_SIZE = 20;

interface LocalHistoryItem extends VoiceInputPipelineResult {
  createdAt: string;
  sourceDeviceId?: string;
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

interface CloudLlmTestResultView {
  modelId: string;
  modelName: string;
  ok: boolean;
  latencyMs?: number;
  outputChars: number;
  finishReason?: string;
  qualityScore?: number;
  qualityPassed?: boolean;
  preview?: string;
  error?: string;
  testedAt: string;
}

export function App() {
  const [setup, setSetup] = useState<SetupPayload | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [mode, setMode] = useState<InputMode>('natural');
  const [activePage, setActivePage] = useState<AppPage>('voice');
  const [asrModelsPage, setAsrModelsPage] = useState<AsrModelsPage>('installable');
  const [llmSettingsPage, setLlmSettingsPage] = useState<LlmSettingsPage>('local');
  const [state, setState] = useState<RecordingState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [voiceMessage, setVoiceMessage] = useState<string | null>(null);
  const [history, setHistory] = useState<LocalHistoryItem[]>([]);
  const [recoveryJobs, setRecoveryJobs] = useState<VoiceInputRecoveryJob[]>([]);
  const [activeRecordingMode, setActiveRecordingMode] = useState<InputMode | null>(null);
  const [hotkeyStatus, setHotkeyStatus] = useState<HotkeyStatus | undefined>();
  const [capturingHotkey, setCapturingHotkey] = useState(false);
  const [installingModelId, setInstallingModelId] = useState<string | null>(null);
  const [catalogRefreshing, setCatalogRefreshing] = useState(false);
  const [catalogMessage, setCatalogMessage] = useState<string | null>(null);
  const [cudaMessage, setCudaMessage] = useState<string | null>(null);
  const [cudaDetecting, setCudaDetecting] = useState(false);
  const [cudaInstalling, setCudaInstalling] = useState(false);
  const [installProgressById, setInstallProgressById] = useState<Record<string, ModelStatusRecord>>({});
  const [downloadProbeById, setDownloadProbeById] = useState<Record<string, ModelDownloadProbeResult>>({});
  const [probingModelId, setProbingModelId] = useState<string | null>(null);
  const [benchmarkingModelId, setBenchmarkingModelId] = useState<string | null>(null);
  const [batchBenchmarking, setBatchBenchmarking] = useState(false);
  const [asrBenchmarkBatch, setAsrBenchmarkBatch] = useState<AsrBenchmarkBatchState | null>(null);
  const [benchmarkResultById, setBenchmarkResultById] = useState<Record<string, ModelBenchmarkResult>>({});
  const [statisticsDays, setStatisticsDays] = useState(30);
  const [usageStatistics, setUsageStatistics] = useState<UsageStatistics | null>(null);
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
  const [lexiconTextFiles, setLexiconTextFiles] = useState<LexiconTextFiles | null>(null);
  const [lexiconTextDirty, setLexiconTextDirty] = useState(false);
  const [lexiconMessage, setLexiconMessage] = useState<string | null>(null);
  const [lexiconTrialInput, setLexiconTrialInput] = useState('');
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
  const [cloudAsrApiKeyDraft, setCloudAsrApiKeyDraft] = useState('');
  const [cloudAsrMessage, setCloudAsrMessage] = useState<string | null>(null);
  const [cloudAsrTesting, setCloudAsrTesting] = useState(false);
  const [cloudAsrTestResult, setCloudAsrTestResult] = useState<CloudAsrTestResult | null>(null);
  const [cloudLlmCatalog, setCloudLlmCatalog] = useState<CloudLlmModelCatalogState | null>(null);
  const [cloudModelSearch, setCloudModelSearch] = useState('');
  const [cloudModelSort, setCloudModelSort] = useState<CloudLlmSortKey>('recommended');
  const [cloudSortDirection, setCloudSortDirection] = useState<CloudLlmSortDirection>('desc');
  const [cloudModelPage, setCloudModelPage] = useState(0);
  const [cloudOnlyFree, setCloudOnlyFree] = useState(false);
  const [cloudOnlyRecommended, setCloudOnlyRecommended] = useState(true);
  const [cloudSelectedModelIds, setCloudSelectedModelIds] = useState<string[]>([]);
  const [cloudTestingModelId, setCloudTestingModelId] = useState<string | null>(null);
  const [cloudBatchTesting, setCloudBatchTesting] = useState(false);
  const [cloudTestResultsById, setCloudTestResultsById] = useState<Record<string, CloudLlmTestResultView>>(() => loadCloudTestResults());
  const [latestCloudTestResultId, setLatestCloudTestResultId] = useState<string | null>(null);
  const [pathMessage, setPathMessage] = useState<string | null>(null);
  const recorderRef = useRef<PcmRecorder | null>(null);
  const systemAudioMutedRef = useRef(false);
  const modeRef = useRef<InputMode>('natural');
  const recordingStateRef = useRef<RecordingState>('idle');
  const recordingStartedAtRef = useRef<number | undefined>(undefined);
  const recordingElapsedMsRef = useRef<number | undefined>(undefined);
  const inputLevelRef = useRef(0);
  const inputActiveRef = useRef(false);
  const silenceStartedAtRef = useRef<number | undefined>(undefined);
  const silenceMsRef = useRef(0);
  const recordingLimitTimerRef = useRef<number | undefined>(undefined);
  const lexiconSaveTimerRef = useRef<number | undefined>(undefined);
  const capturedHotkeyKeysRef = useRef<Set<string>>(new Set());

  const bestCloudCandidate = useMemo(() => {
    const recommendationById = new Map((cloudLlmCatalog?.models ?? []).map((model) => [model.id, model.recommendationScore]));
    return selectBestCloudLlmCandidate(
      Object.values(cloudTestResultsById).map((result) => ({
        modelId: result.modelId,
        modelName: result.modelName,
        ok: result.ok,
        latencyMs: result.latencyMs,
        qualityScore: result.qualityScore,
        recommendationScore: recommendationById.get(result.modelId)
      }))
    );
  }, [cloudLlmCatalog?.models, cloudTestResultsById]);

  const applySetup = useCallback((nextSetup: SetupPayload) => {
    setSetup(nextSetup);
    setSettings(nextSetup.settings);
    setMode(nextSetup.settings.defaultMode);
    setHotkeyStatus(nextSetup.hotkeyStatus);
    setAutoSyncState(nextSetup.autoSyncState);
    setAppUpdateState(nextSetup.appUpdateState);
    setSyncRepoUrl(nextSetup.settings.sync.github.repoUrl ?? '');
    setInstallProgressById(nextSetup.modelStatuses);
    setRecoveryJobs(nextSetup.recoveryJobs ?? []);
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
      .getRecoveryJobs()
      .then(setRecoveryJobs)
      .catch((caught) => setError(caught instanceof Error ? caught.message : String(caught)));
  }, []);

  useEffect(() => {
    void window.v2t
      .getUsageStatistics(statisticsDays)
      .then(setUsageStatistics)
      .catch((caught) => setError(caught instanceof Error ? caught.message : String(caught)));
  }, [statisticsDays]);

  useEffect(() => {
    void window.v2t
      .getLexicon()
      .then(setLexicon)
      .catch((caught) => setError(caught instanceof Error ? caught.message : String(caught)));
  }, []);

  useEffect(() => {
    void window.v2t
      .getLexiconTextFiles()
      .then(setLexiconTextFiles)
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
    void window.v2t
      .getCloudLlmModels()
      .then(setCloudLlmCatalog)
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
    return window.v2t.onAsrBenchmarkProgress((status) => {
      setAsrBenchmarkBatch(status);
      setBatchBenchmarking(status.status === 'running');
      setBenchmarkResultById((current) => {
        const next = { ...current };
        for (const result of status.results) {
          next[result.modelId] = result;
        }
        return next;
      });
    });
  }, []);

  useEffect(() => {
    return window.v2t.onAutoSyncStatus(setAutoSyncState);
  }, []);

  useEffect(() => {
    return window.v2t.onAppUpdateStatus(setAppUpdateState);
  }, []);

  useEffect(() => {
    return window.v2t.onAsrCudaRuntimeProgress((progress) => {
      setSetup((current) =>
        current
          ? {
              ...current,
              asrCudaStatus: {
                ...current.asrCudaStatus,
                runtime: {
                  ...current.asrCudaStatus.runtime,
                  installProgress: progress,
                  installStatus:
                    progress.phase === 'downloading' || progress.phase === 'extracting' || progress.phase === 'verifying'
                      ? progress.phase
                      : current.asrCudaStatus.runtime.installStatus
                }
              }
            }
          : current
      );
    });
  }, []);

  const stopRecording = useCallback(() => {
    clearRecordingLimitTimer();
    const recorder = recorderRef.current;
    if (!recorder) {
      if (recordingStateRef.current === 'starting') {
        if (systemAudioMutedRef.current) {
          systemAudioMutedRef.current = false;
          void window.v2t.restoreSystemAudioAfterRecording();
        }
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
    if (systemAudioMutedRef.current) {
      systemAudioMutedRef.current = false;
      void window.v2t.restoreSystemAudioAfterRecording().then((result) => {
        if (!result.ok) {
          setError(`系统声音恢复失败：${result.error ?? '未知错误'}`);
        }
      });
    }

    const wav = encodeWav(recorder.chunks, recorder.inputSampleRate, 16000);
    void processRecording(wav, modeRef.current);
  }, [clearRecordingLimitTimer, resetInputMeter]);

  const startRecording = useCallback(async (activeMode: InputMode = modeRef.current) => {
    if (recordingStateRef.current === 'starting' || recordingStateRef.current === 'recording' || recordingStateRef.current === 'processing') {
      return;
    }

    setError(null);
    setVoiceMessage(null);
    resetInputMeter();
    modeRef.current = activeMode;
    setActiveRecordingMode(activeMode);
    recordingStateRef.current = 'starting';
    recordingStartedAtRef.current = Date.now();
    recordingElapsedMsRef.current = undefined;
    setState('starting');

    try {
      if (settings?.recording.muteSystemAudio) {
        const muteResult = await window.v2t.muteSystemAudioForRecording();
        if (muteResult.ok) {
          systemAudioMutedRef.current = true;
        } else {
          setError(`系统声音静音失败，已继续录音：${muteResult.error ?? '未知错误'}`);
        }
      }
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
      const maxDurationMs = recordingMaxDurationMs(settings?.recording.maxDurationMinutes);
      if (maxDurationMs !== null) {
        recordingLimitTimerRef.current = window.setTimeout(() => {
          stopRecording();
        }, maxDurationMs);
      }
    } catch (caught) {
      clearRecordingLimitTimer();
      if (systemAudioMutedRef.current) {
        systemAudioMutedRef.current = false;
        void window.v2t.restoreSystemAudioAfterRecording();
      }
      recordingStartedAtRef.current = undefined;
      recordingElapsedMsRef.current = undefined;
      recordingStateRef.current = 'error';
      setActiveRecordingMode(null);
      resetInputMeter();
      setState('error');
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }, [clearRecordingLimitTimer, resetInputMeter, settings?.recording.maxDurationMinutes, settings?.recording.muteSystemAudio, stopRecording, updateInputMeter]);

  const processRecording = useCallback(async (bytes: Uint8Array, activeMode: InputMode) => {
    recordingStateRef.current = 'processing';
    setState('processing');
    try {
      const result = await window.v2t.processAudio({ bytes, mode: activeMode });
      setHistory((items) => [{ ...result, createdAt: new Date().toISOString(), mode: activeMode }, ...items].slice(0, 30));
      void window.v2t.getUsageStatistics(statisticsDays).then(setUsageStatistics);
      void window.v2t.getRecoveryJobs().then(setRecoveryJobs);
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
      void window.v2t.getRecoveryJobs().then(setRecoveryJobs);
    }
  }, [resetInputMeter, statisticsDays]);

  const retryRecoveryJob = useCallback(async (job: VoiceInputRecoveryJob) => {
    recordingStateRef.current = 'processing';
    setState('processing');
    setError(null);
    setVoiceMessage(`正在重新处理 ${Math.round(job.audioDurationSeconds ?? 0)} 秒失败录音`);
    try {
      const response = await window.v2t.retryRecoveryJob(job.id);
      if (!response.ok || !response.result) {
        throw new Error(response.error ?? '重新处理失败');
      }
      const result = response.result;
      setHistory((items) => [{ ...result, createdAt: new Date().toISOString(), mode: job.mode }, ...items].slice(0, 30));
      if (response.setup) {
        applySetup(response.setup);
      }
      setRecoveryJobs(response.jobs ?? (await window.v2t.getRecoveryJobs()));
      void window.v2t.getUsageStatistics(statisticsDays).then(setUsageStatistics);
      setVoiceMessage('失败录音已重新处理完成');
      recordingStateRef.current = 'idle';
      setState('idle');
    } catch (caught) {
      recordingStateRef.current = 'error';
      setState('error');
      setError(caught instanceof Error ? caught.message : String(caught));
      void window.v2t.getRecoveryJobs().then(setRecoveryJobs);
    }
  }, [applySetup, statisticsDays]);

  const deleteRecoveryJob = useCallback(async (jobId: string) => {
    const response = await window.v2t.deleteRecoveryJob(jobId);
    if (!response.ok) {
      setError(response.error ?? '删除失败录音失败');
      return;
    }
    applySetup(response.setup);
    setRecoveryJobs(response.jobs);
  }, [applySetup]);

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

  const updateRecordingMute = async (muteSystemAudio: boolean) => {
    if (!settings) {
      return;
    }
    const result = await window.v2t.saveSettings({
      ...settings,
      recording: {
        ...settings.recording,
        muteSystemAudio
      }
    });
    setSettings(result.settings);
    setHotkeyStatus(result.hotkeyStatus);
    const nextSetup = await window.v2t.getSetup();
    applySetup(nextSetup);
  };

  const updateRecordingLimit = async (maxDurationMinutes: Settings['recording']['maxDurationMinutes']) => {
    if (!settings) {
      return;
    }
    const result = await window.v2t.saveSettings({
      ...settings,
      recording: {
        ...settings.recording,
        maxDurationMinutes
      }
    });
    setSettings(result.settings);
    setHotkeyStatus(result.hotkeyStatus);
    const nextSetup = await window.v2t.getSetup();
    applySetup(nextSetup);
  };

  const updateAsrThreadSetting = async (numThreads: Settings['providers']['asr']['runtime']['numThreads']) => {
    if (!settings) {
      return;
    }
    const result = await window.v2t.saveSettings({
      ...settings,
      providers: {
        ...settings.providers,
        asr: {
          ...settings.providers.asr,
          runtime: {
            ...settings.providers.asr.runtime,
            provider: 'cpu',
            cudaExperimental: false,
            numThreads
          }
        }
      }
    });
    setSettings(result.settings);
    setHotkeyStatus(result.hotkeyStatus);
    const nextSetup = await window.v2t.getSetup();
    applySetup(nextSetup);
  };

  const refreshAsrCuda = async () => {
    setCudaDetecting(true);
    setCudaMessage(null);
    try {
      const status = await window.v2t.detectAsrCuda();
      setSetup((previous) => (previous ? { ...previous, asrCudaStatus: status } : previous));
      setCudaMessage(status.canEnable ? 'CUDA 检测通过，可以尝试启用后做输出测速。' : status.diagnostic);
    } finally {
      setCudaDetecting(false);
    }
  };

  const enableAsrCuda = async () => {
    setCudaDetecting(true);
    setCudaMessage(null);
    try {
      const result = await window.v2t.enableAsrCuda();
      if (result.ok) {
        applySetup(result.setup);
        setCudaMessage('已启用实验 CUDA 后端。请立即做一次输出测速，确认是否比 CPU 更快。');
      } else {
        setSetup((previous) => (previous ? { ...previous, asrCudaStatus: result.status } : previous));
        setCudaMessage(result.error ?? result.status.diagnostic);
      }
    } finally {
      setCudaDetecting(false);
    }
  };

  const disableAsrCuda = async () => {
    const result = await window.v2t.disableAsrCuda();
    applySetup(result.setup);
    setCudaMessage('已回退到 CPU stable 后端。');
  };

  const installAsrCudaRuntime = async () => {
    setCudaInstalling(true);
    setCudaMessage('正在安装 V2T CUDA 后端。下载和解压可能需要几分钟。');
    try {
      const result = await window.v2t.installAsrCudaRuntime();
      applySetup(result.setup);
      setCudaMessage(result.ok ? 'CUDA 后端已安装并通过 smoke test，可以启用后做输出测速。' : result.error ?? result.status.diagnostic);
    } finally {
      setCudaInstalling(false);
    }
  };

  const cancelAsrCudaRuntimeInstall = async () => {
    const result = await window.v2t.cancelAsrCudaRuntimeInstall();
    applySetup(result.setup);
    setCudaInstalling(false);
    setCudaMessage('已取消 CUDA 后端安装。');
  };

  const clearAsrCudaRuntime = async () => {
    const result = await window.v2t.clearAsrCudaRuntime();
    applySetup(result.setup);
    setCudaMessage(result.ok ? '已清除 CUDA 后端并回退 CPU。' : result.error ?? result.status.diagnostic);
  };

  const runAsrCudaSmokeTest = async () => {
    setCudaDetecting(true);
    setCudaMessage('正在运行 CUDA runtime smoke test。');
    try {
      const result = await window.v2t.runAsrCudaSmokeTest();
      applySetup(result.setup);
      setCudaMessage(result.ok ? 'CUDA runtime smoke test 通过，可以启用实验 CUDA。' : result.error ?? result.status.diagnostic);
    } finally {
      setCudaDetecting(false);
    }
  };

  const copyCudaRuntimeText = async (value: string | undefined, label: string) => {
    if (!value) {
      setCudaMessage(`${label}为空，无法复制。`);
      return;
    }
    await window.v2t.copyText(value);
    setCudaMessage(`${label}已复制。`);
  };

  const openCudaRuntimePath = async (value: string | undefined, label: string) => {
    if (!value) {
      setCudaMessage(`${label}为空，无法打开。`);
      return;
    }
    const result = await window.v2t.openPath(value);
    setCudaMessage(result.ok ? `已打开${label}。` : result.error ?? `无法打开${label}。`);
  };

  const updateOpenAtLogin = async (openAtLogin: boolean, silentOpenAtLogin = settings?.startup.silentOpenAtLogin ?? true) => {
    const result = await window.v2t.setOpenAtLogin(openAtLogin, silentOpenAtLogin);
    setSettings(result.settings);
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

  const updateLexiconTextFile = (kind: LexiconTextKind, content: string) => {
    setLexiconTextFiles((current) => {
      if (!current) {
        return current;
      }
      return {
        ...current,
        [kind]: {
          ...current[kind],
          content
        }
      };
    });
    setLexiconTextDirty(true);
    setLexiconMessage('等待自动保存');
  };

  const saveLexiconTextFiles = async (filesToSave: LexiconTextFiles | null = lexiconTextFiles) => {
    if (!filesToSave) {
      return;
    }

    setError(null);
    setLexiconMessage('正在保存');
    const result = await window.v2t.saveLexiconTextFiles(filesToSave);
    if (result.ok && result.lexicon) {
      setLexicon(result.lexicon);
      if (result.textFiles) {
        setLexiconTextFiles(result.textFiles);
      }
      setLexiconTextDirty(false);
      setLexiconMessage('已保存');
      return;
    }

    setLexiconMessage('保存失败');
    setError(result.error ?? '词库 TXT 保存失败');
  };

  const reloadLexiconTextFiles = async () => {
    setError(null);
    setLexiconMessage('正在从磁盘读取');
    try {
      const [nextLexicon, nextFiles] = await Promise.all([window.v2t.getLexicon(), window.v2t.getLexiconTextFiles()]);
      setLexicon(nextLexicon);
      setLexiconTextFiles(nextFiles);
      setLexiconTextDirty(false);
      setLexiconMessage('已从磁盘读取');
    } catch (caught) {
      setLexiconMessage('读取失败');
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  useEffect(() => {
    if (!lexiconTextDirty || !lexiconTextFiles) {
      return;
    }
    if (lexiconSaveTimerRef.current !== undefined) {
      window.clearTimeout(lexiconSaveTimerRef.current);
    }
    lexiconSaveTimerRef.current = window.setTimeout(() => {
      lexiconSaveTimerRef.current = undefined;
      void saveLexiconTextFiles(lexiconTextFiles);
    }, 900);
    return () => {
      if (lexiconSaveTimerRef.current !== undefined) {
        window.clearTimeout(lexiconSaveTimerRef.current);
        lexiconSaveTimerRef.current = undefined;
      }
    };
  }, [lexiconTextFiles, lexiconTextDirty]);

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

  const openModelDownloadUrl = async (modelId: string) => {
    const result = await window.v2t.openModelDownloadUrl(modelId);
    if (!result.ok) {
      setError(result.error ?? '无法打开模型外部下载链接');
    }
  };

  const copyModelDownloadUrl = async (modelId: string) => {
    const result = await window.v2t.copyModelDownloadUrl(modelId);
    setCatalogMessage(result.ok ? '模型下载链接已复制' : (result.error ?? '无法复制模型下载链接'));
  };

  const testModelDownload = async (modelId: string) => {
    setError(null);
    setProbingModelId(modelId);
    const result = await window.v2t.testModelDownload(modelId);
    setDownloadProbeById((current) => ({ ...current, [modelId]: result }));
    setProbingModelId(null);
  };

  const benchmarkAsrModel = async (modelId: string) => {
    setError(null);
    setBenchmarkingModelId(modelId);
    const result = await window.v2t.benchmarkAsrModel(modelId);
    setBenchmarkResultById((current) => ({ ...current, [modelId]: result }));
    setBenchmarkingModelId(null);
    applySetup(await window.v2t.getSetup());
  };

  const benchmarkInstalledAsrModels = async () => {
    setError(null);
    setBatchBenchmarking(true);
    try {
      const results = await window.v2t.benchmarkInstalledAsrModels();
      setBenchmarkResultById((current) => {
        const next = { ...current };
        for (const result of results) {
          next[result.modelId] = result;
        }
        return next;
      });
      applySetup(await window.v2t.getSetup());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBatchBenchmarking(false);
    }
  };

  const cancelAsrBenchmark = async () => {
    const state = await window.v2t.cancelAsrBenchmark();
    setAsrBenchmarkBatch(state);
    setBatchBenchmarking(false);
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

  const copyLatestLexiconDiagnostics = async (item?: LocalHistoryItem) => {
    if (!item) {
      return;
    }
    await window.v2t.copyText(
      JSON.stringify(
        {
          rawAsrText: item.rawText,
          afterLexiconText: item.afterLexiconText ?? item.outputText,
          outputText: item.outputText,
          lexiconHits: item.lexiconHits ?? [],
          hint: '词库只在 ASR 转写后做确定性替换；如果姓名没有命中，请把 ASR 原文里的错误识别结果加入该专有名词别名。'
        },
        null,
        2
      )
    );
    setVoiceMessage('词库诊断已复制到剪贴板');
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
      void window.v2t.getLexiconTextFiles().then(setLexiconTextFiles);
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

  const testCloudLlmConnection = async (model?: CloudLlmModelView) => {
    const modelId = model?.id ?? settings?.providers.llm.fallback.model ?? 'current-cloud-model';
    const modelName = model?.name ?? modelId;
    setCloudTestingModelId(modelId);
    setLlmMessage('正在用内置样例测试云端整理');
    const result = await window.v2t.testCloudLlmConnection(
      model
        ? {
            baseUrl: 'https://openrouter.ai/api/v1',
            model: model.id
          }
        : undefined
    );
    if (result.ok) {
      const elapsed = typeof result.elapsedMs === 'number' ? ` · ${Math.round(result.elapsedMs / 100) / 10}s` : '';
      setLlmMessage(`${model ? model.name : '云端模型'}可用${elapsed}：${result.output ?? '测试通过'}`);
    } else {
      const elapsed = typeof result.elapsedMs === 'number' ? `（${Math.round(result.elapsedMs / 100) / 10}s）` : '';
      setLlmMessage(`${result.error ?? '云端模型测试失败'}${elapsed}`);
    }
    const view: CloudLlmTestResultView = {
      modelId,
      modelName,
      ok: result.ok,
      latencyMs: result.elapsedMs,
      outputChars: result.output ? [...result.output.replace(/\s+/g, '')].length : 0,
      finishReason: result.finishReason,
      qualityScore: result.qualityScore,
      qualityPassed: result.qualityPassed,
      preview: result.output,
      error: result.error,
      testedAt: new Date().toISOString()
    };
    setCloudTestResultsById((current) => {
      const next = { ...current, [modelId]: view };
      saveCloudTestResults(next);
      return next;
    });
    setLatestCloudTestResultId(modelId);
    setCloudTestingModelId(null);
    return view;
  };

  const testSelectedCloudModels = async () => {
    const models = (cloudLlmCatalog?.models ?? []).filter((model) => cloudSelectedModelIds.includes(model.id));
    if (models.length === 0) {
      setLlmMessage('请先勾选要测试的云端模型。');
      return;
    }
    setCloudBatchTesting(true);
    try {
      for (const model of models) {
        let result: CloudLlmTestResultView | undefined;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          result = await testCloudLlmConnection(model);
          const rateLimited = !result.ok && /429|rate|limit|限流/i.test(result.error ?? '');
          if (!rateLimited || attempt === 2) {
            break;
          }
          const retryDelayMs = cloudBatchRetryDelayMs(attempt);
          setLlmMessage(`${model.name} 遇到限流，${Math.round(retryDelayMs / 1000)} 秒后重试（${attempt + 1}/2）。`);
          await delay(retryDelayMs);
        }
        if (result && !result.ok && /429|rate|limit|限流/i.test(result.error ?? '')) {
          setLlmMessage(`连续限流，已暂停后续测试。已完成结果会保留，可稍后继续：${result.error}`);
          break;
        }
        await delay(2_000);
      }
    } finally {
      setCloudBatchTesting(false);
      setCloudTestingModelId(null);
    }
  };

  const openOpenRouterApiKeys = async () => {
    await window.v2t.openOpenRouterApiKeys();
    setLlmMessage('已打开 OpenRouter API Key 页面。创建 Key 后回到这里保存。');
  };

  const openOpenRouterFreeModels = async () => {
    await window.v2t.openOpenRouterFreeModels();
    setLlmMessage('已打开 OpenRouter 免费模型列表。免费模型可能限流或变化。');
  };

  const refreshCloudLlmModels = async () => {
    setLlmMessage('正在刷新 OpenRouter 云端模型列表');
    const state = await window.v2t.refreshCloudLlmModels();
    setCloudLlmCatalog(state);
    setCloudModelPage(0);
    setLlmMessage(state.status === 'success' ? `已刷新 ${state.models.length} 个云端模型` : `刷新失败：${state.error ?? '未知错误'}；已显示缓存或内置推荐`);
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

  const saveCloudAsrApiKey = async () => {
    await window.v2t.setCloudAsrKey(cloudAsrApiKeyDraft);
    setCloudAsrApiKeyDraft('');
    setCloudAsrMessage('云端 ASR API Key 已保存到系统钥匙串，不会写入 settings 或 GitHub 同步仓库。');
  };

  const updateCloudAsrConfig = (patch: Partial<Settings['providers']['asr']['cloud']>) => {
    if (!settings) {
      return;
    }
    setSettings({
      ...settings,
      providers: {
        ...settings.providers,
        asr: {
          ...settings.providers.asr,
          cloud: {
            ...settings.providers.asr.cloud,
            ...patch
          }
        }
      }
    });
  };

  const applyCloudAsrPreset = (preset: { provider: Settings['providers']['asr']['cloud']['provider']; baseUrl: string; model: string; customEndpoint?: string }) => {
    updateCloudAsrConfig(preset);
    setAsrModelsPage('cloud');
    setCloudAsrMessage('已填入云端 ASR 配置；保存设置和 API Key 后可以测试或启用。');
  };

  const enableCloudAsr = async () => {
    if (!settings) {
      return;
    }
    const next = {
      ...settings,
      providers: {
        ...settings.providers,
        asr: {
          ...settings.providers.asr,
          kind: 'cloud-asr' as const
        }
      }
    };
    const result = await window.v2t.saveSettings(next);
    setSettings(result.settings);
    setHotkeyStatus(result.hotkeyStatus);
    setCloudAsrMessage('已启用云端 ASR。之后录音音频会上传到当前云端 ASR provider。');
    applySetup(await window.v2t.getSetup());
  };

  const testCloudAsr = async () => {
    setCloudAsrTesting(true);
    setCloudAsrMessage('正在发送内置测试音频到云端 ASR');
    try {
      const result = await window.v2t.testCloudAsr();
      setCloudAsrTestResult(result);
      setCloudAsrMessage(result.ok ? `云端 ASR 测试完成：${result.elapsedMs ?? 0}ms，${result.outputChars ?? 0} 字。` : `云端 ASR 测试失败：${result.error ?? '未知错误'}`);
    } finally {
      setCloudAsrTesting(false);
    }
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

  const useCloudModel = (model: CloudLlmModelView) => {
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
            baseUrl: 'https://openrouter.ai/api/v1',
            model: model.id
          }
        }
      }
    });
    setLlmMessage(`已填入 ${model.name}，保存设置和云端 API Key 后即可测试。`);
  };

  const openCloudModelPage = async (model: CloudLlmModelView) => {
    await window.v2t.openPath(model.modelUrl ?? `https://openrouter.ai/models/${model.id}`);
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
              <button className="primary" onClick={() => void installModel(topRecommendation.model.id)} disabled={Boolean(installingModelId)}>
                {installingModelId === topRecommendation.model.id ? '安装中' : '立即配置'}
              </button>
            </section>
          ) : null}

          <p className="hint mode-hint">
            单击快捷键 {modeLabel(settings?.hotkey.singleClickMode ?? 'natural')}，双击快捷键 {modeLabel(settings?.hotkey.doubleClickMode ?? 'structured')}；窗口内录音默认使用单击模式。录音上限：{recordingLimitLabel(settings?.recording.maxDurationMinutes)}。
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
          {recoveryJobs.length > 0 ? (
            <section className="recovery-panel">
              <div className="section-summary">
                <div>
                  <span className="eyebrow">恢复区</span>
                  <h2>有失败录音可重新处理</h2>
                  <p>录音已保存在本机恢复区，不会同步到 GitHub；重新处理成功后会自动删除。</p>
                </div>
              </div>
              <div className="recovery-list">
                {recoveryJobs.map((job) => (
                  <div className="recovery-item" key={job.id}>
                    <div>
                      <strong>{modeLabel(job.mode)} · {Math.round(job.audioDurationSeconds ?? 0)} 秒</strong>
                      <p>
                        {job.modelId ?? '当前模型'} · {job.failedChunkIndex ? `失败分片 ${job.failedChunkIndex}` : '等待重试'} · {job.error ?? '转写中断'}
                      </p>
                    </div>
                    <div className="action-toolbar">
                      <button className="secondary compact" onClick={() => void retryRecoveryJob(job)} disabled={state === 'processing'}>
                        重新处理
                      </button>
                      <button className="secondary compact" onClick={() => void window.v2t.copyRecoveryDiagnostic(job.id)}>
                        复制诊断
                      </button>
                      <button className="danger compact" onClick={() => void deleteRecoveryJob(job.id)}>
                        删除录音
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
          <p className="hint">
            当前 ASR：{currentAsrLabel(settings)}，负责把语音转成原始文字。当前结构化引擎：{structuredEngineLabel(settings)}。
            {llmPromptUsageHint(settings)}
          </p>
          <p className="hint">
            当前 ASR 后端：{asrRuntimeLabel(settings, setup?.hardware.cpuCores, setup?.asrCudaStatus)}。macOS 和 Windows 即使用同一模型，速度也会受 CPU 架构、内存带宽、系统调度和安全软件扫描影响；GPU/CUDA 需要单独 runtime 验证后才会显示。
          </p>
          {settings ? (
            <section className="voice-options settings-control-stack">
              <div className="voice-option-row settings-control-row">
                <label className="setting-check control-chip">
                  <input
                    type="checkbox"
                    checked={settings.recording.muteSystemAudio}
                    onChange={(event) => void updateRecordingMute(event.target.checked)}
                  />
                  录音时临时静音系统输出
                </label>
                <div className="recording-limit-inline settings-field">
                  <span className="setting-label">录音上限</span>
                  <div className="choice-group compact" role="radiogroup" aria-label="录音上限">
                    {recordingLimitOptions().map((option) => (
                      <button
                        key={option.label}
                        className={settings.recording.maxDurationMinutes === option.value ? 'active' : ''}
                        onClick={() => void updateRecordingLimit(option.value)}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="voice-diagnostics-toolbar settings-diagnostics-toolbar action-toolbar equal-actions">
                <button className="secondary compact" onClick={() => void window.v2t.copySystemAudioDiagnostics()}>
                  复制静音诊断
                </button>
                <button
                  className="secondary compact"
                  onClick={() => void copyLatestLexiconDiagnostics(history[0])}
                  disabled={!history[0]?.lexiconHits}
                >
                  复制词库诊断
                </button>
              </div>
            </section>
          ) : null}
          {voiceMessage ? <p className="sync-message">{voiceMessage}</p> : null}
          <section className="gesture-settings control-row">
            <div>
              <span>单击快捷键</span>
              <strong>{modeLabel(settings?.hotkey.singleClickMode ?? 'natural')}</strong>
            </div>
            <div>
              <span>双击快捷键</span>
              <strong>{modeLabel(settings?.hotkey.doubleClickMode ?? 'structured')}</strong>
            </div>
            <button className="secondary compact control-action" onClick={() => void updateHotkeyClickMode(oppositeMode(settings?.hotkey.singleClickMode ?? 'natural'))}>
              互换
            </button>
          </section>

          <section className={`record-control control-row ${state}`}>
            <div>
              <span className={`status-dot ${state}`} />
              <div>
                <strong>{stateLabel(state)}</strong>
                <p>{activeRecordingMode ? `本次 ${modeLabel(activeRecordingMode)}` : `窗口内录音使用 ${modeLabel(windowRecordingMode)}`}</p>
              </div>
            </div>
            <button
              className={`${state === 'recording' || state === 'starting' ? 'danger' : 'secondary'} compact control-action`}
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
                      {item.sourceDeviceId ? <span>{item.sourceDeviceId}</span> : null}
                      <span>{item.injection.method === 'cursor' ? '已输入' : '剪贴板'}</span>
                    </div>
                    <div className="history-timings" aria-label="处理分解">
                      <span>处理分解</span>
                      <span>ASR {formatMs(item.metrics?.asrDurationMs)}</span>
                      <span>整理 {formatMs(item.metrics?.postProcessDurationMs)}</span>
                      <span>注入 {formatMs(item.metrics?.injectionDurationMs)}</span>
                      <span>总计 {formatMs(item.metrics?.totalDurationMs)}</span>
                    </div>
                    <pre className="history-text">{item.outputText}</pre>
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
               <p className="hint">当前本地 ASR 后端：{asrRuntimeLabel(settings, setup.hardware.cpuCores, setup.asrCudaStatus)}。当前版本只显示已验证的真实后端；GPU/CUDA 需要单独 runtime 构建和输出测速验证，暂不默认启用。</p>
              {settings ? (
                <>
                  <section className="asr-runtime-panel">
                    <div>
                      <strong>CPU 线程数</strong>
                      <p>{asrRuntimeDetail(settings, setup.hardware.cpuCores, setup.asrCudaStatus)}</p>
                    </div>
                    <div className="choice-group compact" role="radiogroup" aria-label="ASR CPU 线程数">
                      {asrThreadOptions().map((option) => (
                        <button
                          key={option.label}
                          className={settings.providers.asr.runtime.numThreads === option.value ? 'active' : ''}
                          onClick={() => void updateAsrThreadSetting(option.value)}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </section>
                  <section className="asr-cuda-panel">
                    <div className="asr-cuda-summary">
                      <div>
                        <strong>实验 CUDA 后端</strong>
                        <p>{asrCudaStatusLabel(setup.asrCudaStatus)}。GPU 可能明显更快，但 ASR 小模型、int8 模型或 decoder 受限时不一定比 CPU 快，最终以输出测速为准。</p>
                      </div>
                      <span className={`status-pill ${setup.asrCudaStatus.backendStatus}`}>{asrCudaBadge(setup.asrCudaStatus)}</span>
                    </div>
                    <div className="asr-cuda-grid">
                      <span>NVIDIA GPU</span>
                      <strong>{setup.asrCudaStatus.nvidiaGpuDetected ? setup.asrCudaStatus.gpuName ?? '已检测到' : '未检测到'}</strong>
                      <span>CUDA runtime</span>
                      <strong>{setup.asrCudaStatus.cudaRuntimeDlls.length > 0 ? `${setup.asrCudaStatus.cudaRuntimeDlls.length} 个 DLL` : '未检测到'}</strong>
                      <span>sherpa CUDA runtime</span>
                      <strong>{asrCudaRuntimeText(setup.asrCudaStatus)}</strong>
                      <span>smoke test</span>
                      <strong>{setup.asrCudaStatus.runtime.smokeTestPassed ? `通过${setup.asrCudaStatus.runtime.smokeTestedAt ? ` · ${new Date(setup.asrCudaStatus.runtime.smokeTestedAt).toLocaleDateString()}` : ''}` : '未通过'}</strong>
                      <span>建议</span>
                      <strong>{setup.asrCudaStatus.recommendedAction}</strong>
                    </div>
                    <div className="cuda-runtime-links">
                      <h4>CUDA 后端下载信息</h4>
                      <div>
                        <span>下载源</span>
                        <code>{setup.asrCudaStatus.runtime.downloadUrl ?? '暂无可下载 runtime'}</code>
                        <button className="secondary compact" onClick={() => void openCudaRuntimePath(setup.asrCudaStatus.runtime.downloadUrl, '下载源')}>
                          打开下载链接
                        </button>
                        <button className="secondary compact" onClick={() => void copyCudaRuntimeText(setup.asrCudaStatus.runtime.downloadUrl, '下载链接')}>
                          复制下载链接
                        </button>
                      </div>
                      <div>
                        <span>下载文件</span>
                        <code>{setup.asrCudaStatus.runtime.archivePath ?? '暂无本地下载文件路径'}</code>
                        <button className="secondary compact" onClick={() => void copyCudaRuntimeText(setup.asrCudaStatus.runtime.archivePath, '下载文件路径')}>
                          复制路径
                        </button>
                      </div>
                      <div>
                        <span>安装目录</span>
                        <code>{setup.asrCudaStatus.runtime.runtimePath ?? setup.asrCudaStatus.runtime.expectedRuntimePath ?? '暂无安装目录'}</code>
                        <button
                          className="secondary compact"
                          onClick={() => void openCudaRuntimePath(setup.asrCudaStatus.runtime.runtimePath ?? setup.asrCudaStatus.runtime.expectedRuntimePath, '安装目录')}
                        >
                          打开目录
                        </button>
                        <button
                          className="secondary compact"
                          onClick={() => void copyCudaRuntimeText(setup.asrCudaStatus.runtime.runtimePath ?? setup.asrCudaStatus.runtime.expectedRuntimePath, '安装目录')}
                        >
                          复制路径
                        </button>
                      </div>
                      <p className="progress-meta">
                        如果进度没有百分比，通常是下载源没有返回总大小；此时仍会显示已下载大小和实时速度。也可以复制下载链接，用浏览器或下载器下载后反馈具体速度。
                      </p>
                    </div>
                    {setup.asrCudaStatus.runtime.installProgress ? (
                      <div className="cuda-progress">
                        <span>{cudaProgressLabel(setup.asrCudaStatus.runtime.installProgress.phase)}</span>
                        <strong>
                          {typeof setup.asrCudaStatus.runtime.installProgress.percent === 'number'
                            ? `${Math.round(setup.asrCudaStatus.runtime.installProgress.percent)}%`
                            : setup.asrCudaStatus.runtime.installProgress.message ?? '进行中'}
                        </strong>
                        <p className="progress-meta">
                          {cudaProgressDetail(setup.asrCudaStatus.runtime.installProgress)}
                        </p>
                      </div>
                    ) : null}
                    {cudaMessage ? <p className="sync-message">{cudaMessage}</p> : null}
                    <div className="action-toolbar">
                      <button className="secondary compact" onClick={() => void refreshAsrCuda()} disabled={cudaDetecting}>
                        {cudaDetecting ? '检测中' : '检测 CUDA'}
                      </button>
                      <button className="secondary compact" onClick={() => void installAsrCudaRuntime()} disabled={!setup.asrCudaStatus.runtime.canInstall || cudaInstalling || cudaDetecting}>
                        {setup.asrCudaStatus.runtime.hasRuntimeFiles ? '重新安装 CUDA 后端' : '安装 CUDA 后端'}
                      </button>
                      {setup.asrCudaStatus.runtime.canCancel || cudaInstalling ? (
                        <button className="secondary compact" onClick={() => void cancelAsrCudaRuntimeInstall()}>
                          取消下载
                        </button>
                      ) : null}
                      <button className="secondary compact" onClick={() => void runAsrCudaSmokeTest()} disabled={!setup.asrCudaStatus.runtime.canSmokeTest || cudaDetecting || cudaInstalling}>
                        运行 smoke test
                      </button>
                      <button className="secondary compact" onClick={() => void window.v2t.openAsrCudaDocs()}>
                        sherpa CUDA 文档
                      </button>
                      <button className="secondary compact" onClick={() => void window.v2t.openNvidiaCudaDownload()}>
                        NVIDIA CUDA 下载
                      </button>
                      <button className="secondary compact" onClick={() => void enableAsrCuda()} disabled={!setup.asrCudaStatus.canEnable || setup.asrCudaStatus.active || cudaDetecting}>
                        启用实验 CUDA
                      </button>
                      <button className="secondary compact" onClick={() => void clearAsrCudaRuntime()} disabled={!setup.asrCudaStatus.runtime.canClear || cudaInstalling}>
                        清除 CUDA 后端
                      </button>
                      {setup.asrCudaStatus.active ? (
                        <button className="secondary compact" onClick={() => void disableAsrCuda()}>
                          回退 CPU
                        </button>
                      ) : null}
                    </div>
                  </section>
                </>
              ) : null}
               <p className="hint">公开中文指标只显示 CER / WER；V2T 适配分表示这台设备上的安装、运行和资源匹配优先级。WER/CER 越低越好，RTFx 越高越快。</p>
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
                <div className="action-toolbar">
                  <button className="secondary compact" onClick={() => void copyModelCatalogDiagnostics()}>
                    复制榜单诊断
                  </button>
                  <button className="secondary compact" onClick={() => void refreshModelCatalog()} disabled={catalogRefreshing}>
                    {catalogRefreshing ? '刷新中' : '刷新模型榜单'}
                  </button>
                </div>
              </section>
              <section className="natural-asr-recommendation">
                <h3>自然录入推荐</h3>
                <p className="hint">SenseVoice 速度很快，但自然长句和中英混输不一定最稳。自然口述优先试 Qwen3-ASR 0.6B；如果更在意速度和资源占用，再试 Fun-ASR-Nano。</p>
                <div>
                  {naturalAsrRecommendations(setup.catalog).map((item) => (
                    <article key={item.id}>
                      <strong>{item.title}</strong>
                      <span>{item.reason}</span>
                    </article>
                  ))}
                </div>
              </section>
              <div className="subpage-tabs">
                <button className={asrModelsPage === 'installable' ? 'active' : ''} onClick={() => setAsrModelsPage('installable')}>
                  本地 ASR
                </button>
                <button className={asrModelsPage === 'cloud' ? 'active' : ''} onClick={() => setAsrModelsPage('cloud')}>
                  云端 ASR
                </button>
                <button className={asrModelsPage === 'reference' ? 'active' : ''} onClick={() => setAsrModelsPage('reference')}>
                  待接入 / 外部服务
                </button>
                <button className={asrModelsPage === 'guide' ? 'active' : ''} onClick={() => setAsrModelsPage('guide')}>
                  说明
                </button>
              </div>
              {asrModelsPage === 'installable' ? (
                <>
                  <div className="inline-actions model-table-actions">
                    <button className="secondary compact" onClick={() => void benchmarkInstalledAsrModels()} disabled={batchBenchmarking}>
                      {batchBenchmarking ? '批量输出测速中' : '批量输出测速'}
                    </button>
                    {batchBenchmarking ? (
                      <button className="secondary compact" onClick={() => void cancelAsrBenchmark()}>
                        取消测速
                      </button>
                    ) : null}
                  </div>
                  {asrBenchmarkBatch && asrBenchmarkBatch.status !== 'idle' ? (
                    <p className="hint">
                      {asrBenchmarkBatch.status === 'running' ? `正在测速 ${asrBenchmarkBatch.currentModelName ?? asrBenchmarkBatch.currentModelId ?? ''}` : '输出测速已结束'}
                      {' · '}
                      {asrBenchmarkBatch.completed}/{asrBenchmarkBatch.total} 完成 · {asrBenchmarkBatch.failed} 失败
                    </p>
                  ) : null}
                  <AsrModelTable
                    rows={oneClickInstallableModels(setup.catalog).map((model) =>
                      scoreModel(model, setup.hardware, setup.modelStatuses[model.id]?.status ?? (settings?.providers.asr.modelId === model.id ? 'current' : 'not-installed'))
                    )}
                    currentModelId={settings?.providers.asr.modelId}
                    modelStatuses={setup.modelStatuses}
                    installProgressById={installProgressById}
                    probeResultById={downloadProbeById}
                    benchmarkResultById={benchmarkResultById}
                    probingModelId={probingModelId}
                    benchmarkingModelId={benchmarkingModelId}
                    installingModelId={installingModelId}
                    deletingModelId={deletingModelId}
                    onInstall={installModel}
                    onReinstall={reinstallModel}
                    onCancelInstall={cancelModelInstall}
                    onImportArchive={importModelArchive}
                    onImportDirectory={importModelDirectory}
                    onClearInstall={clearModelInstall}
                    onTestDownload={testModelDownload}
                    onBenchmark={benchmarkAsrModel}
                    onActivate={activateModel}
                    onDelete={deleteModel}
                    onOpenDownloadUrl={openModelDownloadUrl}
                    onCopyDownloadUrl={copyModelDownloadUrl}
                  />
                </>
              ) : null}
              {asrModelsPage === 'cloud' && settings ? (
                <section className="advanced-group cloud-asr-panel">
                  <div className="section-summary">
                    <div className="section-summary-main">
                      <span className="status-meta">云端 ASR</span>
                      <strong className="section-summary-title">{cloudAsrLabel(settings)}</strong>
                      <p className="section-summary-copy">启用后会上传音频，会上传完整录音音频，不只是上传转写后的文字。云端 ASR 成功后仍会继续走词库、Prompt、LLM 整理和历史记录。</p>
                    </div>
                    <div className="action-toolbar section-summary-actions">
                      <button className="secondary compact" onClick={() => void testCloudAsr()} disabled={cloudAsrTesting}>
                        {cloudAsrTesting ? '测试中' : '测试云端 ASR'}
                      </button>
                      <button className="save compact" onClick={() => void enableCloudAsr()}>
                        启用云端 ASR
                      </button>
                    </div>
                  </div>

                  <div className="cloud-asr-presets">
                    {[
                      {
                        title: '速度优先',
                        detail: 'OpenAI gpt-4o-mini-transcribe，适合低延迟和成本控制。',
                        provider: 'openai' as const,
                        baseUrl: 'https://api.openai.com/v1',
                        model: 'gpt-4o-mini-transcribe'
                      },
                      {
                        title: '质量优先',
                        detail: 'OpenAI gpt-4o-transcribe，适合更高质量转写。',
                        provider: 'openai' as const,
                        baseUrl: 'https://api.openai.com/v1',
                        model: 'gpt-4o-transcribe'
                      },
                      {
                        title: 'Groq 免费层',
                        detail: 'Whisper Large V3 Turbo，免费层有请求和音频时长限制；适合先测试速度。',
                        provider: 'groq' as const,
                        baseUrl: 'https://api.groq.com/openai/v1',
                        model: 'whisper-large-v3-turbo'
                      },
                      {
                        title: '自定义服务',
                        detail: '兼容 multipart WAV 输入、JSON transcript 输出的自建或第三方 ASR。',
                        provider: 'custom-http' as const,
                        baseUrl: 'http://127.0.0.1:8080/transcribe',
                        model: 'custom-asr',
                        customEndpoint: 'http://127.0.0.1:8080/transcribe'
                      }
                    ].map((preset) => (
                      <button key={preset.title} className="engine-card" onClick={() => applyCloudAsrPreset(preset)}>
                        <span className="engine-badge">{preset.title}</span>
                        <strong>{preset.model}</strong>
                        <span>{preset.detail}</span>
                      </button>
                    ))}
                  </div>

                  <section className="llm-manual-config">
                    <h3>云端 ASR 配置</h3>
                    <p className="hint">Groq 免费层与 OpenAI 都使用 `/audio/transcriptions` 文件转写接口。Groq 免费层受请求和音频时长限制；豆包/火山第一版建议通过自定义 HTTP 代理接入，流式 WebSocket 后续单独做。</p>
                    <label>
                      Provider
                      <select
                        value={settings.providers.asr.cloud.provider}
                        onChange={(event) => updateCloudAsrConfig({ provider: event.target.value as Settings['providers']['asr']['cloud']['provider'] })}
                      >
                        <option value="openai">OpenAI Transcription</option>
                        <option value="groq">Groq 免费层 / Whisper</option>
                        <option value="custom-http">自定义 HTTP ASR</option>
                        <option value="doubao">豆包 / 火山代理</option>
                      </select>
                    </label>
                    <label>
                      Cloud ASR Base URL
                      <input
                        className="no-drag"
                        value={settings.providers.asr.cloud.baseUrl}
                        placeholder="例如 https://api.openai.com/v1"
                        onContextMenu={showEditMenu}
                        onChange={(event) => updateCloudAsrConfig({ baseUrl: event.target.value })}
                      />
                    </label>
                    <label>
                      Cloud ASR Model
                      <input
                        className="no-drag"
                        value={settings.providers.asr.cloud.model}
                        placeholder="例如 gpt-4o-mini-transcribe"
                        onContextMenu={showEditMenu}
                        onChange={(event) => updateCloudAsrConfig({ model: event.target.value })}
                      />
                    </label>
                    <label>
                      自定义 Endpoint
                      <input
                        className="no-drag"
                        value={settings.providers.asr.cloud.customEndpoint ?? ''}
                        placeholder="自定义 HTTP 或豆包代理 endpoint，可留空"
                        onContextMenu={showEditMenu}
                        onChange={(event) => updateCloudAsrConfig({ customEndpoint: event.target.value })}
                      />
                    </label>
                    <label>
                      Cloud ASR API Key
                      <input
                        className="no-drag"
                        type="password"
                        value={cloudAsrApiKeyDraft}
                        placeholder="只保存到系统钥匙串，不写入同步目录"
                        onContextMenu={showEditMenu}
                        onChange={(event) => setCloudAsrApiKeyDraft(event.target.value)}
                      />
                    </label>
                    <div className="action-toolbar">
                      <button className="secondary compact" onClick={() => void saveCloudAsrApiKey()} disabled={!cloudAsrApiKeyDraft}>
                        保存云端 ASR API Key
                      </button>
                      <button className="secondary compact" onClick={() => void saveSettings()}>
                        保存云端 ASR 设置
                      </button>
                      <button className="secondary compact" onClick={() => void testCloudAsr()} disabled={cloudAsrTesting}>
                        测试云端 ASR
                      </button>
                    </div>
                    {cloudAsrTestResult ? (
                      <p className={cloudAsrTestResult.ok ? 'sync-message' : 'error-text'}>
                        {cloudAsrTestResult.ok
                          ? `测试成功：${cloudAsrTestResult.elapsedMs ?? 0}ms · ${cloudAsrTestResult.outputChars ?? 0} 字 · ${cloudAsrTestResult.outputText ?? ''}`
                          : `测试失败：${cloudAsrTestResult.error ?? '未知错误'}`}
                      </p>
                    ) : null}
                    {cloudAsrMessage ? <p className="sync-message">{cloudAsrMessage}</p> : null}
                  </section>
                </section>
              ) : null}
              {asrModelsPage === 'reference' ? (
                <>
                  <ReferenceModelTable models={referenceCatalog} />
                  <section className="doubao-comparison">
                    <h3>豆包 / 火山引擎云端 ASR 参考</h3>
                    <p>豆包适合低延迟流式、云端高可用、热词和自学习体系；V2T 本地 ASR 更适合隐私、离线和成本可控。</p>
                    <div>
                      {['低延迟流式', '中文/方言覆盖', '热词/自学习', '长音频能力', '隐私', '成本', '离线可用性', '延迟稳定性'].map((item) => (
                        <span key={item}>{item}</span>
                      ))}
                    </div>
                  </section>
                </>
              ) : null}
              {asrModelsPage === 'guide' ? (
                <section className="advanced-group">
                  <h3>一键安装条件</h3>
                  <p>一键安装只开放给 V2T 已接入 runtime、文件结构明确、下载源可信、可以校验并能 smoke test 的模型。</p>
                  <p>云 API、专有服务、缺少本地 runtime、缺少 required files 或未通过打包验证的模型会留在“待接入 / 外部服务”。</p>
                  <p>输出测速使用 V2T 固定样例或模型包样例，表示你的设备上的实际转写处理速度；公开榜单 RTFx 只是外部参考，二者不混用。</p>
                  <p>Qwen3-ASR 1.7B 偏准确率；Qwen3-ASR 0.6B 偏效率、吞吐和资源占用。1.7B 只有完成 V2T runtime、文件结构、校验和打包 smoke test 后才会进入可一键安装。</p>
                </section>
              ) : null}
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
              <section className="section-summary llm-current-summary">
                <div className="section-summary-main">
                  <span className="status-meta">当前整理引擎</span>
                  <strong className="section-summary-title">{llmEngineLabel(settings)}</strong>
                  <p className="section-summary-copy">{llmEngineDescription(settings)}</p>
                </div>
                <div className="action-toolbar section-summary-actions">
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
                      <span className="engine-badge">{llmEngineBadge(engine)}</span>
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

                  <section className="advanced-group">
                    <h3>低内存本地模型建议</h3>
                    <p className="hint">0.5B-1.7B 适合短文本纠错和轻量结构化，内存占用低但稳定性不如 4B-9B；4B 左右通常是速度和质量更稳的折中。</p>
                    <div className="local-llm-suggestions">
                      {['Qwen3.5 1.7B / Q4', 'Qwen3.5 4B / Q4', 'Gemma 4 4B / Q4', 'Nemotron 3 Nano 小参数量量化版'].map((name) => (
                        <span key={name}>{name}</span>
                      ))}
                    </div>
                  </section>

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
                    <div className="action-toolbar">
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
                    <div className="action-toolbar cloud-quick-actions">
                      <button className="secondary compact" onClick={() => void openOpenRouterApiKeys()}>
                        打开 OpenRouter API Key
                      </button>
                      <button className="secondary compact" onClick={() => void refreshCloudLlmModels()}>
                        刷新云端模型
                      </button>
                      <button className="secondary compact" onClick={() => void testSelectedCloudModels()} disabled={cloudBatchTesting || cloudSelectedModelIds.length === 0}>
                        {cloudBatchTesting ? '测试中' : `测试已选模型${cloudSelectedModelIds.length ? ` (${cloudSelectedModelIds.length})` : ''}`}
                      </button>
                    </div>
                    <div className="cloud-model-workspace">
                      <CloudTestResultPanel
                        result={latestCloudTestResultId ? cloudTestResultsById[latestCloudTestResultId] : latestCloudResult(cloudTestResultsById)}
                        bestCandidate={bestCloudCandidate}
                      />
                      <CloudModelTable
                        state={cloudLlmCatalog}
                        search={cloudModelSearch}
                        sortKey={cloudModelSort}
                        sortDirection={cloudSortDirection}
                        page={cloudModelPage}
                        onlyFree={cloudOnlyFree}
                        onlyRecommended={cloudOnlyRecommended}
                        selectedModelIds={cloudSelectedModelIds}
                        testingModelId={cloudTestingModelId}
                        testResultsById={cloudTestResultsById}
                        onToggleSelected={(modelId) =>
                          setCloudSelectedModelIds((current) => (current.includes(modelId) ? current.filter((id) => id !== modelId) : [...current, modelId]))
                        }
                        onSearch={(value) => {
                          setCloudModelSearch(value);
                          setCloudModelPage(0);
                        }}
                        onSort={(value) => {
                          setCloudModelSort(value);
                          setCloudModelPage(0);
                        }}
                        onSortDirection={(value) => {
                          setCloudSortDirection(value);
                          setCloudModelPage(0);
                        }}
                        onOnlyFree={(value) => {
                          setCloudOnlyFree(value);
                          setCloudModelPage(0);
                        }}
                        onOnlyRecommended={(value) => {
                          setCloudOnlyRecommended(value);
                          setCloudModelPage(0);
                        }}
                        onPage={setCloudModelPage}
                        onUse={useCloudModel}
                        onTest={async (model) => {
                          useCloudModel(model);
                          await testCloudLlmConnection(model);
                        }}
                        onOpen={openCloudModelPage}
                      />
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
                    <div className="action-toolbar">
                      <button className="secondary" onClick={() => void saveFallbackLlmApiKey()} disabled={!llmFallbackApiKeyDraft}>
                        保存云端 API Key
                      </button>
                    </div>
                  </section>
                </>
              )}
              <div className="settings-save-row">
                <button className="save" onClick={() => void saveSettings()}>
                  保存文本整理模型设置
                </button>
              </div>
              {llmMessage ? <p className="sync-message">{llmMessage}</p> : null}
            </>
          ) : (
            <p className="empty">加载中</p>
          )}
        </section>
      );
    }

    if (activePage === 'statistics') {
      return (
        <section className="page-section statistics-page">
          <h2>统计</h2>
          <p className="hint">只统计文本和性能元数据，不保存音频。旧历史没有模型字段时会显示“旧记录：未记录模型”；后续记录会自动统计到具体模型。</p>
          <div className="subpage-tabs">
            {[7, 30].map((days) => (
              <button key={days} className={statisticsDays === days ? 'active' : ''} onClick={() => setStatisticsDays(days)}>
                最近 {days} 天
              </button>
            ))}
          </div>
          {usageStatistics ? (
            <>
              <p className="hint">
                统计来源：本机历史 {usageStatistics.localDeviceCount ?? 0} 台设备
                {usageStatistics.remoteImportedAt
                  ? `；远端摘要${usageStatistics.remoteSummaryIncluded ? '已合并' : '已缓存未合并'}，导入时间 ${new Date(usageStatistics.remoteImportedAt).toLocaleString()}`
                  : '；暂无远端统计摘要'}
                {usageStatistics.sourceDeviceIds?.length ? `；参与统计设备 ${usageStatistics.sourceDeviceIds.length} 台` : ''}
              </p>
              <div className="stats-grid">
                <StatCard label="输入次数" value={`${usageStatistics.totalCount}`} />
                <StatCard label="总录音时长" value={formatSeconds(usageStatistics.totalAudioSeconds)} />
                <StatCard label="输出字数" value={`${usageStatistics.totalOutputChars}`} />
                <StatCard label="平均总耗时" value={formatMs(usageStatistics.averageTotalMs)} />
              </div>
              <UsageAggregateTable title="ASR 模型使用情况" rows={usageStatistics.asrModels} />
              <UsageAggregateTable title="文本整理引擎使用情况" rows={usageStatistics.postProcessors} />
            </>
          ) : (
            <p className="empty">统计读取中</p>
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
            {hotkeyStatus?.nativeHelperVersion || hotkeyStatus?.nativeHelperBundledVersion ? (
              <div>
                <dt>组件版本</dt>
                <dd>
                  当前 {hotkeyStatus.nativeHelperVersion ?? '未知'}；随包 {hotkeyStatus.nativeHelperBundledVersion ?? '未知'}
                  {hotkeyStatus.helperReusedExisting ? '；已复用稳定路径组件' : ''}
                </dd>
              </div>
            ) : null}
            {hotkeyStatus?.helperNeedsUpgrade || hotkeyStatus?.helperUpgradeReason ? (
              <div>
                <dt>组件升级</dt>
                <dd>{hotkeyStatus.helperNeedsUpgrade ? hotkeyStatus.helperUpgradeReason ?? '监听组件需要升级。' : hotkeyStatus.helperUpgradeReason}</dd>
              </div>
            ) : null}
            {hotkeyStatus?.helperFileExists !== undefined ? (
              <div>
                <dt>组件文件</dt>
                <dd>{hotkeyStatus.helperFileExists ? '存在' : '缺失，请重新安装新版 V2T 或检查 release 包'}</dd>
              </div>
            ) : null}
            {hotkeyStatus?.permissionKind === 'windows-native-hook' && hotkeyStatus?.repairAttempted !== undefined ? (
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
          {hotkeyStatus?.permissionKind === 'macos-accessibility' ? (
            <div className="button-row">
              <button className="secondary" onClick={() => void repairHotkeyHelper()}>
                重新安装监听组件
              </button>
              <p className="hint">只有页面明确提示组件需要升级时才需要点击；普通版本更新会复用已授权组件。</p>
            </div>
          ) : null}
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
          <p className="hint">lexicon.json 会作为运行时权威数据；这里直接编辑三个 TXT 文件，保存后会自动解析、去重并同步更新 lexicon.json。</p>
          {lexicon ? (
            <>
              <section className="lexicon-group lexicon-trial">
                <h3>词库试运行</h3>
                <p className="hint">粘贴 ASR 原文，检查专有名词别名、固定替换和禁用词是否会命中。词库不会改变 ASR 的听写过程，只会在转写后替换文本。</p>
                <textarea
                  className="no-drag"
                  value={lexiconTrialInput}
                  placeholder="例如：今天我想聊一下被错误识别出来的人名"
                  onContextMenu={showEditMenu}
                  onChange={(event) => setLexiconTrialInput(event.target.value)}
                />
                <LexiconTrialResult input={lexiconTrialInput} lexicon={lexicon} />
              </section>
              <section className="lexicon-group lexicon-text-files">
                <div className="section-heading">
                  <h3>TXT 文件编辑器</h3>
                  <div className="inline-actions">
                    <button className="secondary compact" onClick={() => void reloadLexiconTextFiles()}>
                      重新从磁盘读取
                    </button>
                  </div>
                </div>
                <p className="hint">按 TXT 内容维护词库：专有名词支持同行别名，固定替换使用 `错误词 -&gt; 正确词`，禁用词按行或逗号分隔。编辑后会自动保存。</p>
                <div className="lexicon-text-grid">
                  <LexiconTextEditor
                    title="专有名词 terms.txt"
                    description="每行第一个词是标准词，同行逗号后的内容会作为别名。"
                    file={lexiconTextFiles?.terms}
                    placeholder="王小波, 王小博\n许知远, 许之远\nQwen3-ASR"
                    onChange={(value) => updateLexiconTextFile('terms', value)}
                    onOpen={() => void window.v2t.openLexiconTextFile('terms')}
                    onContextMenu={showEditMenu}
                  />
                  <LexiconTextEditor
                    title="固定替换 replacements.txt"
                    description="每行一个规则，支持 -> 或 =>。"
                    file={lexiconTextFiles?.replacements}
                    placeholder={'Github -> GitHub\n错别词 => 正确词'}
                    onChange={(value) => updateLexiconTextFile('replacements', value)}
                    onOpen={() => void window.v2t.openLexiconTextFile('replacements')}
                    onContextMenu={showEditMenu}
                  />
                  <LexiconTextEditor
                    title="禁用词 blocked.txt"
                    description="按行、逗号、中文逗号或顿号分隔。"
                    file={lexiconTextFiles?.blocked}
                    placeholder="嗯\n呃\n啊"
                    onChange={(value) => updateLexiconTextFile('blocked', value)}
                    onOpen={() => void window.v2t.openLexiconTextFile('blocked')}
                    onContextMenu={showEditMenu}
                  />
                </div>
              </section>
              <div className="lexicon-actions">
                <p className="sync-message">{lexiconMessage ?? (lexiconTextDirty ? '等待自动保存' : '已保存')}</p>
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
                settings.json、lexicon.json、lexicon/*.txt、prompts/natural.md、prompts/structured.md 和文字历史。词库页保存只改本地数据，需要点击“推送”才会写入 GitHub。
                默认同步语音输入文字历史；音频、模型和密钥不会同步。
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
                  checked={settings.sync.github.includeHistory ?? true}
                  onChange={(event) => void updateIncludeHistory(event.target.checked)}
                />
                同步文字历史
              </label>
              <p className="hint">默认开启，会把多端语音输入文本历史同步到 GitHub 私有仓库；仍不会同步音频、模型或密钥。</p>
              <label className="check sync-history-toggle">
                <input
                  type="checkbox"
                  checked={settings.sync.github.autoSync ?? false}
                  onChange={(event) => void updateAutoSync(event.target.checked)}
                />
                自动同步
              </label>
              <p className="hint">
                开启后，每次成功输入、保存词库或保存提示词都会排队同步；文字历史是否进入同步由“同步文字历史”开关控制。
              </p>
              <section className="sync-stats-note">
                <h3>统计摘要同步</h3>
                <p className="hint">
                  默认同步 stats/usage-summary.json，只包含总输入次数、总录音时长、输出字数和模型耗时聚合，不包含历史原文、ASR 原文或音频。
                </p>
                <dl>
                  <div>
                    <dt>本机摘要生成</dt>
                    <dd>{syncStatus?.statsLocalGeneratedAt ? new Date(syncStatus.statsLocalGeneratedAt).toLocaleString() : '等待下次同步生成'}</dd>
                  </div>
                  <div>
                    <dt>远端摘要导入</dt>
                    <dd>{syncStatus?.statsRemoteImportedAt ? new Date(syncStatus.statsRemoteImportedAt).toLocaleString() : '暂无'}</dd>
                  </div>
                  <div>
                    <dt>摘要设备数</dt>
                    <dd>{syncStatus?.statsDeviceCount ?? '暂无'}</dd>
                  </div>
                </dl>
              </section>
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
                    <option value="cloud-asr">云端 ASR</option>
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
            <div className="settings-control-stack">
              <div className="settings-control-row">
                <label className="setting-check control-chip">
                  <input
                    type="checkbox"
                    checked={settings.startup.openAtLogin}
                    onChange={(event) => void updateOpenAtLogin(event.target.checked)}
                  />
                  开机自动启动 V2T
                </label>
                <label className="setting-check control-chip">
                  <input
                    type="checkbox"
                    checked={settings.startup.silentOpenAtLogin}
                    onChange={(event) => void updateOpenAtLogin(settings.startup.openAtLogin, event.target.checked)}
                  />
                  开机时静默进入菜单栏
                </label>
              </div>
              <div className="settings-control-row">
                <label className="setting-check control-chip">
                  <input
                    type="checkbox"
                    checked={settings.recording.muteSystemAudio}
                    onChange={(event) => void updateRecordingMute(event.target.checked)}
                  />
                  录音时临时静音系统输出
                </label>
                <div className="recording-limit-setting settings-field">
                  <span className="setting-label">录音上限</span>
                  <div className="choice-group compact" role="radiogroup" aria-label="录音上限">
                    {recordingLimitOptions().map((option) => (
                      <button
                        key={option.label}
                        className={settings.recording.maxDurationMinutes === option.value ? 'active' : ''}
                        onClick={() => void updateRecordingLimit(option.value)}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="settings-diagnostics-toolbar action-toolbar">
                <button className="secondary compact" onClick={() => void window.v2t.copySystemAudioDiagnostics()}>
                  复制静音诊断
                </button>
              </div>
            </div>
          </section>
        ) : null}
        {setup ? (
          <dl className="version-list">
            <div>
              <dt>应用版本</dt>
              <dd>{setup.appInfo.version}</dd>
            </div>
            <div>
              <dt>构建号</dt>
              <dd>{setup.appInfo.buildCommit}</dd>
            </div>
            <div>
              <dt>Release 标签</dt>
              <dd>v{setup.appInfo.version}-{setup.appInfo.buildCommit}</dd>
            </div>
          </dl>
        ) : null}
         {settings && appUpdateState ? (
           <section className="update-panel">
             <h3>应用更新</h3>
             <p className="hint">{appUpdateStatusLabel(appUpdateState)}</p>
             {appUpdateState.windowsUpdateStage ? (
               <p className="hint">
                 Windows 更新阶段：{windowsUpdateStageLabel(appUpdateState)}
                 {appUpdateState.differentialFallbackLikely ? ' · 本次疑似需要完整安装包' : ''}
               </p>
             ) : null}
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
            {appUpdateState.differentialFallbackLikely ? (
              <p className="hint">
                {appUpdateState.differentialFallbackReason ?? '本次更新可能从差分下载回退到完整安装包。'}
                {appUpdateState.installerSizeBytes ? ` 完整包约 ${formatBytes(appUpdateState.installerSizeBytes)}。` : ''}
              </p>
            ) : null}
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
              版本 {setup.appInfo.version}
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
          {error ? (
            <div className="error">
              <span>{error}</span>
              {error.includes('本地语音模型') || error.includes('ASR') ? (
                <button className="secondary compact" onClick={() => void window.v2t.copyAsrDiagnostics()}>
                  复制 ASR 诊断
                </button>
              ) : null}
            </div>
          ) : null}
          {pageContent}
        </section>
      </section>
    </main>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <article className="stat-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function UsageAggregateTable({ title, rows }: { title: string; rows: UsageAggregate[] }) {
  return (
    <section className="comparison-panel usage-panel">
      <h3>{title}</h3>
      {rows.length === 0 ? (
        <p className="empty">暂无统计数据</p>
      ) : (
        <div className="usage-table dense-table">
          <div className="usage-head">
            <span>名称</span>
            <span>次数</span>
            <span>录音时长</span>
            <span>输出字数</span>
            <span>平均总耗时</span>
            <span>平均 ASR</span>
            <span>平均整理</span>
            <span>平均 RTF</span>
          </div>
          {rows.map((row) => (
            <div className="usage-row" key={row.key}>
              <strong>{row.label}</strong>
              <span>{row.count}</span>
              <span>{formatSeconds(row.audioDurationSeconds)}</span>
              <span>{row.outputCharCount}</span>
              <span>{formatMs(row.averageTotalMs)}</span>
              <span>{formatMs(row.averageAsrMs)}</span>
              <span>{formatMs(row.averagePostProcessMs)}</span>
              <span>{row.averageRealTimeFactor ? `${row.averageRealTimeFactor}x` : '-'}</span>
            </div>
          ))}
        </div>
      )}
    </section>
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
  benchmarking,
  onActivate,
  onReinstall,
  onBenchmark,
  onDelete
}: {
  model: InstalledModelView;
  activatingModelId: string | null;
  deletingModelId: string | null;
  benchmarking: boolean;
  onActivate(modelId: string): Promise<void>;
  onReinstall(modelId: string): Promise<void>;
  onBenchmark(modelId: string): Promise<void>;
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
        <button className="primary" onClick={() => void onActivate(model.modelId)} disabled={!model.canActivate || activating || model.current}>
          {model.current ? '当前' : activating ? '启用中' : '启用'}
        </button>
        {model.canReinstall ? (
          <button className="secondary" onClick={() => void onReinstall(model.modelId)}>
            重新安装
          </button>
        ) : null}
        <button className="secondary" onClick={() => void onBenchmark(model.modelId)} disabled={benchmarking}>
          {benchmarking ? '测速中' : '输出测速'}
        </button>
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

function CloudModelTable({
  state,
  search,
  sortKey,
  sortDirection,
  page,
  onlyFree,
  onlyRecommended,
  onSearch,
  onSort,
  onSortDirection,
  onOnlyFree,
  onOnlyRecommended,
  onPage,
  onUse,
  onTest,
  onOpen,
  selectedModelIds,
  testingModelId,
  testResultsById,
  onToggleSelected
}: {
  state: CloudLlmModelCatalogState | null;
  search: string;
  sortKey: CloudLlmSortKey;
  sortDirection: CloudLlmSortDirection;
  page: number;
  onlyFree: boolean;
  onlyRecommended: boolean;
  onSearch(value: string): void;
  onSort(value: CloudLlmSortKey): void;
  onSortDirection(value: CloudLlmSortDirection): void;
  onOnlyFree(value: boolean): void;
  onOnlyRecommended(value: boolean): void;
  onPage(value: number): void;
  onUse(model: CloudLlmModelView): void;
  onTest(model: CloudLlmModelView): Promise<void>;
  onOpen(model: CloudLlmModelView): Promise<void>;
  selectedModelIds: string[];
  testingModelId: string | null;
  testResultsById: Record<string, CloudLlmTestResultView>;
  onToggleSelected(modelId: string): void;
}) {
  const query = search.trim().toLowerCase();
  const sortedModels = sortCloudLlmModels(state?.models ?? [], sortKey, sortDirection);
  const matchesQuery = (model: CloudLlmModelView) => {
    if (!query) {
      return true;
    }
    return `${model.name} ${model.id} ${model.description ?? ''} ${cloudLlmTags(model).join(' ')}`.toLowerCase().includes(query);
  };
  const filtered = sortedModels.filter((model) => {
    if (onlyFree && !model.isFree) {
      return false;
    }
    if (onlyRecommended && !model.recommended) {
      return false;
    }
    return matchesQuery(model);
  });
  const freeRecommendedCount = sortedModels.filter((model) => model.recommended && model.isFree).length;
  const paidRecommendedCount = sortedModels.filter((model) => model.recommended && !model.isFree).length;
  const hiddenPaidRecommendedCount = onlyFree
    ? sortedModels.filter((model) => model.recommended && !model.isFree && (!onlyRecommended || model.recommended) && matchesQuery(model)).length
    : 0;
  const totalPages = Math.max(1, Math.ceil(filtered.length / CLOUD_MODELS_PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const visible = filtered.slice(safePage * CLOUD_MODELS_PAGE_SIZE, safePage * CLOUD_MODELS_PAGE_SIZE + CLOUD_MODELS_PAGE_SIZE);

  return (
    <div className="cloud-model-browser">
      <div className="cloud-model-toolbar">
        <input
          className="no-drag"
          value={search}
          placeholder="搜索模型名或 ID"
          spellCheck={false}
          onChange={(event) => onSearch(event.target.value)}
        />
        <select value={sortKey} onChange={(event) => onSort(event.target.value as CloudLlmSortKey)}>
          <option value="recommended">推荐</option>
          <option value="performance">Performance</option>
          <option value="name">Name</option>
          <option value="releasedAt">发布时间</option>
          <option value="price">价格</option>
        </select>
        <select value={sortDirection} onChange={(event) => onSortDirection(event.target.value as CloudLlmSortDirection)}>
          <option value="desc">倒序</option>
          <option value="asc">正序</option>
        </select>
        <label className="setting-check">
          <input type="checkbox" checked={onlyFree} onChange={(event) => onOnlyFree(event.target.checked)} />
          只看免费
        </label>
        <label className="setting-check">
          <input type="checkbox" checked={onlyRecommended} onChange={(event) => onOnlyRecommended(event.target.checked)} />
          只看推荐
        </label>
      </div>
      <p className="progress-meta">
        {state?.status === 'failed' ? `刷新失败：${state.error ?? '未知错误'}；正在显示缓存或内置推荐。` : `共 ${filtered.length} 个模型`}
        {` · 免费推荐 ${freeRecommendedCount} · 付费推荐 ${paidRecommendedCount}`}
        {sortKey === 'releasedAt' ? ` · ${sortDirection === 'desc' ? '按发布时间倒序' : '按发布时间正序'}` : ''}
        {state?.updatedAt ? ` · 上次刷新 ${new Date(state.updatedAt).toLocaleString()}` : ''}
      </p>
      {hiddenPaidRecommendedCount > 0 ? (
        <div className="cloud-paid-hidden-notice">
          <span>已隐藏 {hiddenPaidRecommendedCount} 个付费推荐模型，包括 Qwen 3.6 Plus。免费候选仍保留 Ling-2.6-flash free；免费不等于更推荐，可能限流或波动。</span>
          <button className="secondary compact" onClick={() => onOnlyFree(false)}>显示全部推荐</button>
        </div>
      ) : null}
      <p className="progress-meta">
        Qwen 3.6 Plus 是付费稳定主力，适合中文/中英混合和较长整理；Ling-2.6-flash free 是免费快速候选，适合短文本试用。
      </p>
      {filtered.length === 0 ? (
        <div className="cloud-empty-state">
          <strong>未找到同时满足当前筛选的模型</strong>
          <p>免费模型、推荐模型和搜索条件叠加后可能没有结果，可以先放宽其中一个条件。</p>
          <div className="button-row three">
            {onlyFree && onlyRecommended ? <button className="secondary compact" onClick={() => onOnlyRecommended(false)}>放宽为只看免费</button> : null}
            {onlyFree && onlyRecommended ? <button className="secondary compact" onClick={() => onOnlyFree(false)}>放宽为只看推荐</button> : null}
            <button className="secondary compact" onClick={() => { onOnlyFree(false); onOnlyRecommended(false); onSearch(''); }}>清除筛选</button>
          </div>
        </div>
      ) : (
        <div className="cloud-model-list-rows">
          {visible.map((model) => (
            <article className="cloud-model-row" key={model.id}>
              <div className="cloud-model-row-main">
                <label className="row-check" aria-label={`选择 ${model.name}`}>
                  <input type="checkbox" checked={selectedModelIds.includes(model.id)} onChange={() => onToggleSelected(model.id)} />
                </label>
                <div className="cloud-model-title-block">
                  <div className="cloud-model-title">
                    <strong>{model.name}</strong>
                  </div>
                  <small>{model.id}</small>
                  {model.note ? <p>{model.note}</p> : null}
                </div>
                <div className="cloud-model-tags">
                  {cloudLlmTags(model).map((tag) => (
                    <span key={tag}>{tag}</span>
                  ))}
                </div>
              </div>
              <div className="cloud-model-meta-line">
                <span>适配 {model.recommendationScore}</span>
                <span>{cloudPriceLabel(model)}</span>
                <span>发布 {model.createdAt ? new Date(model.createdAt).toLocaleDateString() : '未知'}</span>
                <span>上下文 {model.contextLength ? `${Math.round(model.contextLength / 1000)}k` : '-'}</span>
              </div>
              <div className="cloud-model-row-actions">
                <div className="action-strip">
                  <button className="secondary compact" onClick={() => onUse(model)}>填入</button>
                  <button className="secondary compact" onClick={() => void onTest(model)} disabled={testingModelId === model.id}>
                    {testingModelId === model.id ? '测试中' : testResultsById[model.id] ? '重测' : '测试'}
                  </button>
                  <button className="secondary compact" onClick={() => void onOpen(model)}>打开模型页</button>
                </div>
                {testResultsById[model.id] ? <small className="cloud-test-inline">{cloudTestInlineLabel(testResultsById[model.id])}</small> : null}
              </div>
            </article>
          ))}
        </div>
      )}
      <div className="pager">
        <button className="secondary compact" onClick={() => onPage(Math.max(0, safePage - 1))} disabled={safePage === 0}>
          上一页
        </button>
        <span>
          {safePage + 1} / {totalPages}
        </span>
        <button className="secondary compact" onClick={() => onPage(Math.min(totalPages - 1, safePage + 1))} disabled={safePage >= totalPages - 1}>
          下一页
        </button>
      </div>
    </div>
  );
}

function CloudTestResultPanel({
  result,
  bestCandidate
}: {
  result?: CloudLlmTestResultView;
  bestCandidate?: { modelName: string; latencyMs?: number; qualityScore?: number };
}) {
  return (
    <section className="cloud-test-summary">
      <div className="cloud-test-summary-head">
        <h3>云端测试结果</h3>
        {result ? <small>{new Date(result.testedAt).toLocaleString()}</small> : null}
      </div>
      {result ? (
        <>
          <div className="cloud-test-summary-line">
            <strong>{result.modelName}</strong>
            <span>{result.ok ? '可用' : '失败'}</span>
            <span>{result.latencyMs ? `${Math.round(result.latencyMs / 100) / 10}s` : '-'}</span>
            <span>{result.outputChars} 字</span>
            <span>质量验收 {result.qualityScore ?? '-'}{result.qualityPassed === false ? '（未通过）' : ''}</span>
            <span>{result.finishReason ?? '-'}</span>
          </div>
          <details>
            <summary>{result.ok ? result.preview ?? '测试通过' : result.error ?? '测试失败'}</summary>
            <pre>{result.ok ? result.preview ?? '测试通过' : result.error ?? '测试失败'}</pre>
          </details>
        </>
      ) : (
        <p className="empty">还没有测试结果。选择模型后点击“测试”或“测试已选模型”。</p>
      )}
      {bestCandidate ? (
        <p className="cloud-best-candidate">
          最快合格候选：<strong>{bestCandidate.modelName}</strong> · {formatMs(bestCandidate.latencyMs)} · 质量验收 {bestCandidate.qualityScore}
        </p>
      ) : (
        <p className="cloud-best-candidate">完成至少一项质量验收通过的测试后，才会给出最快合格候选。</p>
      )}
    </section>
  );
}

function LexiconTextEditor({
  title,
  description,
  file,
  placeholder,
  onChange,
  onOpen,
  onContextMenu
}: {
  title: string;
  description: string;
  file?: { path: string; content: string };
  placeholder: string;
  onChange: (value: string) => void;
  onOpen: () => void;
  onContextMenu: (event: MouseEvent<HTMLTextAreaElement>) => void;
}) {
  return (
    <article className="lexicon-text-editor">
      <div className="lexicon-text-editor-head">
        <div>
          <h4>{title}</h4>
          <p>{description}</p>
        </div>
        <button className="secondary compact" onClick={onOpen}>
          打开文件
        </button>
      </div>
      <textarea className="no-drag" value={file?.content ?? ''} placeholder={placeholder} onContextMenu={onContextMenu} onChange={(event) => onChange(event.target.value)} />
      {file?.path ? <small>{file.path}</small> : <small>正在读取文件内容</small>}
    </article>
  );
}

function LexiconTrialResult({ input, lexicon }: { input: string; lexicon: Lexicon }) {
  if (!input.trim()) {
    return <p className="empty">输入 ASR 原文后会显示命中情况。</p>;
  }
  const diagnostics = analyzeLexicon(input, lexicon);
  return (
    <div className="lexicon-trial-result">
      <div>
        <span>替换后</span>
        <strong>{diagnostics.outputText || '空'}</strong>
      </div>
      <div>
        <span>命中</span>
        {diagnostics.hits.length ? (
          <ul>
            {diagnostics.hits.map((hit, index) => (
              <li key={`${hit.kind}-${hit.from}-${index}`}>
                {hit.kind === 'term' ? '专有名词' : hit.kind === 'replacement' ? '固定替换' : '禁用词'}：{hit.from}
                {hit.to ? ` → ${hit.to}` : ''} · {hit.count} 次
              </li>
            ))}
          </ul>
        ) : (
          <p>没有命中。请把 ASR 原文里的错误识别结果添加为该词条别名。</p>
        )}
      </div>
      {diagnostics.missedTerms.length ? <small>未命中词条：{diagnostics.missedTerms.slice(0, 8).join('、')}</small> : null}
    </div>
  );
}

function AsrModelTable({
  rows,
  currentModelId,
  modelStatuses,
  installProgressById,
  probeResultById,
  benchmarkResultById,
  probingModelId,
  benchmarkingModelId,
  installingModelId,
  deletingModelId,
  onInstall,
  onReinstall,
  onCancelInstall,
  onImportArchive,
  onImportDirectory,
  onClearInstall,
  onTestDownload,
  onBenchmark,
  onActivate,
  onDelete,
  onOpenDownloadUrl,
  onCopyDownloadUrl
}: {
  rows: ModelRecommendation[];
  currentModelId?: string;
  modelStatuses: Record<string, ModelStatusRecord>;
  installProgressById: Record<string, ModelStatusRecord>;
  probeResultById: Record<string, ModelDownloadProbeResult>;
  benchmarkResultById: Record<string, ModelBenchmarkResult>;
  probingModelId: string | null;
  benchmarkingModelId: string | null;
  installingModelId: string | null;
  deletingModelId: string | null;
  onInstall(modelId: string): Promise<void>;
  onReinstall(modelId: string): Promise<void>;
  onCancelInstall(modelId: string): Promise<void>;
  onImportArchive(modelId: string): Promise<void>;
  onImportDirectory(modelId: string): Promise<void>;
  onClearInstall(modelId: string): Promise<void>;
  onTestDownload(modelId: string): Promise<void>;
  onBenchmark(modelId: string): Promise<void>;
  onActivate(modelId: string): Promise<void>;
  onDelete(modelId: string): Promise<void>;
  onOpenDownloadUrl(modelId: string): Promise<void>;
  onCopyDownloadUrl(modelId: string): Promise<void>;
}) {
  return (
    <section className="comparison-panel" aria-label="ASR 模型统一管理">
      <h3>ASR 模型统一管理</h3>
      <div className="comparison-table-scroll">
      <div className="comparison-table asr-management-table">
        <div className="comparison-head asr-management-head">
          <span>模型</span>
          <span>公开中文指标</span>
          <span>V2T 适配分</span>
          <span>输出速度</span>
          <span>资源占用</span>
          <span>状态</span>
        </div>
        {rows
          .sort((left, right) => right.score - left.score)
          .map((recommendation) => {
          const model = recommendation.model;
          const statusRecord = installProgressById[model.id] ?? modelStatuses[model.id];
          const status = statusRecord?.status;
          const isCurrent = currentModelId === model.id;
          const displayStatusRecord = statusRecord && !isCurrent && statusRecord.status === 'current' ? { ...statusRecord, status: 'installed' as const } : statusRecord;
          const installed = isCurrent || status === 'installed' || status === 'current';
          const installing = installingModelId === model.id || isInstallInProgress(status);
          const deleting = deletingModelId === model.id;
          const canClearResidue = !isCurrent && Boolean(statusRecord?.isInterrupted || statusRecord?.status === 'failed');
          const chineseMetric = publicChineseMetricLabel(model);
          const probeResult = probeResultById[model.id];
          const benchmarkResult = benchmarkResultById[model.id];
          return (
            <div className="comparison-row asr-management-row" key={model.id}>
              <div className="asr-summary-row">
                <div>
                  <strong>{model.name}</strong>
                  <small>{model.languages.join('/')} · {model.evaluationSources?.chineseBenchmark?.sourceLabel ?? '暂无公开中文评测来源'}</small>
                  <div className="asr-model-tags">
                    {model.qualityTags.filter((tag) => ['自然录入', '高速', '中英混输', '低资源', '高准确'].includes(tag)).map((tag) => (
                      <span key={tag}>{tag}</span>
                    ))}
                  </div>
                </div>
                <ComparisonMetric value={chineseMetric.value} label={chineseMetric.label} lowerIsBetter={chineseMetric.lowerIsBetter} max={chineseMetric.max} />
                <ComparisonMetric value={recommendation.score} label={`${recommendation.score}`} max={100} />
                <ComparisonMetric
                  value={benchmarkResult?.realTimeFactor ?? statusRecord?.benchmarkRealTimeFactor}
                  label={benchmarkResult?.realTimeFactor ?? statusRecord?.benchmarkRealTimeFactor ? `${benchmarkResult?.realTimeFactor ?? statusRecord?.benchmarkRealTimeFactor}x` : '未测速'}
                  max={20}
                />
                <span className="resource-cell">
                  <strong>{model.sizeMb}MB · 最低 {model.hardwareRequirements.minMemoryGb}GB</strong>
                  <small>{model.runtime}{model.sherpaModelType ? ` · ${model.sherpaModelType}` : ''}</small>
                </span>
                <span>{isCurrent ? '当前' : statusLabel(displayStatusRecord)}</span>
              </div>
              <div className="asr-package-row">
                <div className="asr-package-title">
                  <strong>包体管理</strong>
                  <small>{packageStatusSummary(displayStatusRecord, probeResult, benchmarkResult)}</small>
                </div>
                <div className="action-strip table-action-grid asr-package-actions">
                  <button className="secondary compact" onClick={() => void (installed ? onActivate(model.id) : onInstall(model.id))} disabled={installing || isCurrent}>
                    {isCurrent ? '当前' : installing ? '安装中' : installed ? '启用' : statusRecord?.status === 'failed' && statusRecord.canResume ? '继续下载' : '安装'}
                  </button>
                  <button className="secondary compact" onClick={() => void onImportArchive(model.id)} disabled={installing}>导入包</button>
                  <button className="secondary compact" onClick={() => void onImportDirectory(model.id)} disabled={installing}>导入目录</button>
                  <button className="secondary compact" onClick={() => void onOpenDownloadUrl(model.id)}>外部下载</button>
                  <button className="secondary compact" onClick={() => void onCopyDownloadUrl(model.id)}>复制链接</button>
                  <button className="secondary compact" onClick={() => void onTestDownload(model.id)} disabled={probingModelId === model.id || installing}>
                    {probingModelId === model.id ? '测速中' : probeResult ? '重测下载' : '下载测速'}
                  </button>
                  {installed ? (
                    <button className="secondary compact" onClick={() => void onBenchmark(model.id)} disabled={benchmarkingModelId === model.id || installing}>
                      {benchmarkingModelId === model.id ? '测速中' : '输出测速'}
                    </button>
                  ) : null}
                  {installed || statusRecord?.status === 'failed' ? (
                    <button className="secondary compact" onClick={() => void onReinstall(model.id)} disabled={installing}>重装</button>
                  ) : null}
                  {installing ? <button className="secondary compact" onClick={() => void onCancelInstall(model.id)}>取消</button> : null}
                  {canClearResidue ? <button className="secondary compact" onClick={() => void onClearInstall(model.id)}>清残留</button> : null}
                  {installed && !isCurrent ? (
                    <button className="danger compact" onClick={() => void onDelete(model.id)} disabled={deleting}>
                      {deleting ? '删除中' : '删除'}
                    </button>
                  ) : null}
                </div>
                {displayStatusRecord ? <PackageProgress status={displayStatusRecord} /> : null}
              </div>
            </div>
          );
        })}
      </div>
      </div>
    </section>
  );
}

function ReferenceModelTable({ models }: { models: ModelCatalogItem[] }) {
  return (
    <section className="comparison-panel" aria-label="待接入模型">
      <h3>待接入 / 外部服务</h3>
      <p className="hint">这些模型有公开榜单或上游文档参考，但还没有完成 V2T 一键下载、运行配置和打包 smoke test。</p>
      <div className="comparison-table reference-table">
        <div className="comparison-head reference-head">
          <span>模型</span>
          <span>公开参考</span>
          <span>状态</span>
          <span>不能一键安装的原因</span>
        </div>
        {models.map((model) => {
          const eligibility = oneClickEligibility(model);
          const openAsr = model.evaluationSources?.openAsrLeaderboard;
          return (
            <div className="comparison-row reference-row" key={model.id}>
              <div>
                <strong>{model.name}</strong>
                <small>{model.languages.join('/')} · {model.runtime}</small>
              </div>
              <span>{openAsr?.exactModelMatch ? `Open ASR Rank ${openAsr.rank ?? '-'} · WER ${openAsr.avgWer ?? '-'}` : '中文/官方参考'}</span>
              <span>{model.availability === 'manual' ? '可手动配置' : '待接入'}</span>
              <p>{model.unavailableReason ?? eligibility.reasons.join('；') ?? '尚未完成 V2T runtime 验证'}</p>
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
        <button className="secondary" disabled>
          {model.availability === 'manual' ? '手动配置' : '待接入'}
        </button>
      </div>
    </article>
  );
}

function ModelRow({
  recommendation,
  currentModelId,
  statusRecord,
  probeResult,
  benchmarkResult,
  probing,
  benchmarking,
  installingModelId,
  deletingModelId,
  onInstall,
  onReinstall,
  onCancelInstall,
  onImportArchive,
  onImportDirectory,
  onClearInstall,
  onTestDownload,
  onBenchmark,
  onActivate,
  onDelete
}: {
  recommendation: ModelRecommendation;
  currentModelId?: string;
  statusRecord?: ModelStatusRecord;
  probeResult?: ModelDownloadProbeResult;
  benchmarkResult?: ModelBenchmarkResult;
  probing: boolean;
  benchmarking: boolean;
  installingModelId: string | null;
  deletingModelId: string | null;
  onInstall(modelId: string): Promise<void>;
  onReinstall(modelId: string): Promise<void>;
  onCancelInstall(modelId: string): Promise<void>;
  onImportArchive(modelId: string): Promise<void>;
  onImportDirectory(modelId: string): Promise<void>;
  onClearInstall(modelId: string): Promise<void>;
  onTestDownload(modelId: string): Promise<void>;
  onBenchmark(modelId: string): Promise<void>;
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
       <BenchmarkSummary status={statusRecord} result={benchmarkResult} />
         {statusRecord ? <InstallProgress status={statusRecord} /> : null}
       </div>
      <div className="model-row-actions">
        <button
          className="primary"
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
        {installed ? (
          <button className="secondary" onClick={() => void onBenchmark(recommendation.model.id)} disabled={benchmarking || installing}>
            {benchmarking ? '测速中' : '输出测速'}
          </button>
        ) : null}
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

function PackageProgress({ status }: { status: ModelStatusRecord }) {
  if (!isInstallInProgress(status.status) && status.status !== 'failed') {
    return null;
  }
  const progress = status.progress;
  return (
    <div className="package-progress">
      <div className="package-progress-line">
        <strong>{installStatusLabel(status)}</strong>
        <span>
          {[
            progress !== undefined ? `${progress}%` : undefined,
            status.bytesPerSecond ? `${formatBytes(status.bytesPerSecond)}/s` : undefined,
            status.etaSeconds ? `剩余 ${formatDuration(status.etaSeconds)}` : undefined
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
      </div>
      <div className={progress === undefined ? 'progress-track compact indeterminate' : 'progress-track compact'}>
        <span style={progress === undefined ? undefined : { width: `${Math.min(100, Math.max(0, progress))}%` }} />
      </div>
      {status.error ? <p className="progress-error">{status.error}</p> : null}
    </div>
  );
}

function packageStatusSummary(status?: ModelStatusRecord, probe?: ModelDownloadProbeResult, benchmark?: ModelBenchmarkResult): string {
  const parts = [statusLabel(status)];
  if (probe?.bytesPerSecond) {
    parts.push(`下载源 ${formatBytes(probe.bytesPerSecond)}/s`);
  }
  if (benchmark?.realTimeFactor ?? status?.benchmarkRealTimeFactor) {
    parts.push(`输出 ${benchmark?.realTimeFactor ?? status?.benchmarkRealTimeFactor}x`);
  }
  return parts.filter(Boolean).join(' · ');
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

function BenchmarkSummary({ status, result }: { status?: ModelStatusRecord; result?: ModelBenchmarkResult }) {
  const failed = result && !result.ok;
  const realTimeFactor = result?.realTimeFactor ?? status?.benchmarkRealTimeFactor;
  const charsPerSecond = result?.charsPerSecond ?? status?.benchmarkCharsPerSecond;
  const benchmarkedAt = result?.benchmarkedAt ?? status?.benchmarkedAt;

  if (failed) {
    return <p className="progress-error">{result.error}</p>;
  }

  if (!realTimeFactor && !charsPerSecond) {
    return <p className="progress-meta">输出测速会优先用模型自带样例，没有样例时使用 V2T 内置标准音频，显示你的设备真实转写速度。</p>;
  }

  return (
    <p className="progress-meta">
      输出速度 {realTimeFactor ? `${realTimeFactor}x 实时` : '未知'}
      {charsPerSecond ? ` · ${charsPerSecond} 字/秒` : ''}
      {benchmarkedAt ? ` · ${new Date(benchmarkedAt).toLocaleString()}` : ''}
    </p>
  );
}

function historyEntryToLocalItem(entry: HistoryEntry): LocalHistoryItem {
  return {
    id: entry.id,
    rawText: entry.rawText,
    outputText: entry.outputText,
    createdAt: entry.createdAt,
    sourceDeviceId: entry.sourceDeviceId,
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
    postProcessorEngine: entry.postProcessorEngine ?? 'local-rules',
    metrics: {
      audioDurationSeconds: entry.audioDurationSeconds,
      audioBytes: entry.audioBytes,
      rawCharCount: entry.rawCharCount ?? 0,
      outputCharCount: entry.outputCharCount ?? 0,
      asrModelId: entry.asrModelId,
      asrModelName: entry.asrModelName,
      asrProviderKind: entry.asrProviderKind,
      asrDurationMs: entry.asrDurationMs ?? 0,
      postProcessDurationMs: entry.postProcessDurationMs ?? 0,
      injectionDurationMs: entry.injectionDurationMs ?? 0,
      totalDurationMs: entry.totalDurationMs ?? 0,
      llmModel: entry.llmModel
    }
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

function llmEngineBadge(engine: Settings['providers']['llm']['engine']): string {
  if (engine === 'local') {
    return 'LOCAL';
  }
  if (engine === 'cloud') {
    return 'CLOUD';
  }
  if (engine === 'local-with-cloud-fallback') {
    return 'HYBRID';
  }
  return 'RULES';
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
  if (settings.providers.asr.kind === 'cloud-asr') {
    return cloudAsrLabel(settings);
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

function cloudAsrLabel(settings: Settings): string {
  const provider = settings.providers.asr.cloud.provider;
  const providerLabel = provider === 'openai' ? 'OpenAI' : provider === 'groq' ? 'Groq 免费层' : provider === 'doubao' ? '豆包/火山' : '自定义 HTTP';
  return `云端 ASR · ${providerLabel} ${settings.providers.asr.cloud.model || '未选择模型'}`;
}

function asrRuntimeLabel(settings: Settings | null, cpuCores?: number, cudaStatus?: AsrCudaStatus): string {
  if (!settings) {
    return '加载中';
  }
  if (settings.providers.asr.kind === 'cloud-asr') {
    return `云端上传 · ${settings.providers.asr.cloud.provider === 'openai' ? 'OpenAI Transcription' : settings.providers.asr.cloud.provider === 'groq' ? 'Groq Whisper 免费层' : settings.providers.asr.cloud.provider === 'doubao' ? '豆包/火山代理' : '自定义 HTTP ASR'}`;
  }
  if (settings.providers.asr.kind === 'local-sherpa-onnx') {
    return localSherpaRuntimeLabel(
      resolveLocalSherpaRuntime(settings.providers.asr.runtime, {
        cpuCores,
        platform: cudaStatus?.platform,
        cudaRuntimeAvailable: cudaStatus?.canEnable,
        cudaUnavailableReason: cudaStatus?.diagnostic
      })
    );
  }
  if (settings.providers.asr.kind === 'funasr-http') {
    return '外部 HTTP 服务';
  }
  if (settings.providers.asr.kind === 'whisper-cpp') {
    return 'Whisper.cpp runtime';
  }
  return '未知后端';
}

function asrRuntimeDetail(settings: Settings | null, cpuCores?: number, cudaStatus?: AsrCudaStatus): string {
  if (!settings || settings.providers.asr.kind !== 'local-sherpa-onnx') {
    return '';
  }
  const runtime = resolveLocalSherpaRuntime(settings.providers.asr.runtime, {
    cpuCores,
    platform: cudaStatus?.platform,
    cudaRuntimeAvailable: cudaStatus?.canEnable,
    cudaUnavailableReason: cudaStatus?.diagnostic
  });
  if (runtime.backendStatus === 'cuda-experimental-unavailable') {
    return `实验 CUDA 后端不可用：${runtime.unavailableReason}`;
  }
  if (runtime.backendStatus === 'cuda-experimental-active') {
    return '实验 CUDA 后端已启用；请用输出测速确认是否真的更快。';
  }
  return settings.providers.asr.runtime.numThreads === 'auto'
    ? '线程数为自动：按设备核心数保守选择，避免拖垮桌面响应。'
    : '线程数为手动设置；更高线程数不一定线性更快，请用输出测速确认。';
}

function asrCudaStatusLabel(status: AsrCudaStatus): string {
  if (status.backendStatus === 'cuda-experimental-active') {
    return `已启用 CUDA · ${status.gpuName ?? 'NVIDIA GPU'}`;
  }
  if (status.backendStatus === 'cuda-experimental-available') {
    return `可启用 · ${status.gpuName ?? 'NVIDIA GPU'}`;
  }
  return `不可用 · ${status.diagnostic}`;
}

function asrCudaBadge(status: AsrCudaStatus): string {
  if (status.backendStatus === 'cuda-experimental-active') {
    return 'CUDA 已启用';
  }
  if (status.backendStatus === 'cuda-experimental-available') {
    return '可启用';
  }
  return '不可用';
}

function asrCudaRuntimeText(status: AsrCudaStatus): string {
  if (status.runtime.installStatus === 'active') {
    return `已启用 · ${status.runtime.installedVersion ?? status.runtime.catalogItem?.version ?? '未知版本'}`;
  }
  if (status.runtime.smokeTestPassed) {
    return `已安装 · ${status.runtime.installedVersion ?? status.runtime.catalogItem?.version ?? '未知版本'}`;
  }
  if (status.runtime.hasRuntimeFiles) {
    return '已安装，待 smoke test';
  }
  if (status.runtime.installStatus === 'downloading' || status.runtime.installStatus === 'extracting' || status.runtime.installStatus === 'verifying') {
    return '安装中';
  }
  if (status.runtime.installStatus === 'failed') {
    return '安装失败';
  }
  return status.runtime.canInstall ? '可一键安装' : '无兼容包';
}

function cudaProgressLabel(phase: string): string {
  if (phase === 'downloading') {
    return '下载';
  }
  if (phase === 'extracting') {
    return '解压';
  }
  if (phase === 'verifying') {
    return '校验';
  }
  if (phase === 'ready') {
    return '已就绪';
  }
  if (phase === 'failed') {
    return '失败';
  }
  if (phase === 'cancelled') {
    return '已取消';
  }
  return phase;
}

function cudaProgressDetail(progress: {
  downloadedBytes?: number;
  totalBytes?: number;
  bytesPerSecond?: number;
  sourceLabel?: string;
  archivePath?: string;
}): string {
  const parts = [
    progress.sourceLabel,
    progress.downloadedBytes !== undefined
      ? progress.totalBytes
        ? `${formatBytes(progress.downloadedBytes)} / ${formatBytes(progress.totalBytes)}`
        : `已下载 ${formatBytes(progress.downloadedBytes)}（总大小未知）`
      : undefined,
    progress.bytesPerSecond ? `${formatBytes(progress.bytesPerSecond)}/s` : '等待下载数据',
    progress.archivePath ? `保存到 ${progress.archivePath}` : undefined
  ].filter(Boolean);
  return parts.join(' · ');
}

function asrThreadOptions(): Array<{ label: string; value: Settings['providers']['asr']['runtime']['numThreads'] }> {
  return [
    { label: '自动', value: 'auto' },
    { label: '2', value: 2 },
    { label: '4', value: 4 },
    { label: '6', value: 6 },
    { label: '8', value: 8 }
  ];
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

function formatSeconds(seconds?: number): string {
  if (!seconds) {
    return '0 秒';
  }
  return formatDuration(seconds);
}

function formatMs(ms?: number): string {
  if (ms === undefined) {
    return '-';
  }
  if (ms >= 1000) {
    return `${(ms / 1000).toFixed(1)} 秒`;
  }
  return `${Math.round(ms)} ms`;
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

function cloudPriceLabel(model: CloudLlmModelView): string {
  if (model.isFree) {
    return '免费';
  }
  const prompt = model.promptPrice === undefined ? undefined : `$${model.promptPrice}/tok`;
  const completion = model.completionPrice === undefined ? undefined : `$${model.completionPrice}/tok`;
  return [prompt, completion].filter(Boolean).join(' / ') || '未知';
}

function statusLabel(status?: ModelStatusRecord): string {
  if (!status) {
    return '未安装';
  }
  if (status.status === 'current') {
    return '当前';
  }
  if (status.status === 'installed') {
    return '已安装';
  }
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
    return '失败';
  }
  return '未安装';
}

function publicChineseMetricLabel(model: ModelCatalogItem): { value?: number; label: string; max: number; lowerIsBetter: boolean } {
  const cerOrWer = publicChineseMetrics(model)[0];
  if (cerOrWer) {
    return {
      value: cerOrWer.value,
      label: `${cerOrWer.label} ${formatMetric(cerOrWer)}`,
      max: cerOrWer.metric === 'CER' ? 20 : 30,
      lowerIsBetter: true
    };
  }
  return { label: '暂无公开中文评测', max: 1, lowerIsBetter: false };
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

function windowsUpdateStageLabel(state: AppUpdateState): string {
  if (state.windowsUpdateStage === 'metadata') {
    return '获取元数据';
  }
  if (state.windowsUpdateStage === 'differential') {
    return '尝试差分更新';
  }
  if (state.windowsUpdateStage === 'full-package') {
    return '回退完整包 / 下载完整安装包';
  }
  if (state.windowsUpdateStage === 'downloaded') {
    return '更新包已下载';
  }
  return '等待更新';
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
  if (status?.helperNeedsUpgrade) {
    return '监听组件协议版本需要升级。请先点击“重新安装监听组件”，然后只对新的 MacKeyServer 重新授权一次。';
  }
  if (status?.helperVerified || status?.nativeActive) {
    return '监听组件已经收到系统按键事件，不需要重新添加权限。';
  }
  if (status?.nativeHelperPath) {
    return `纯修饰键需要 macOS 辅助功能权限；请给监听组件 ${status.nativeHelperPath} 开启权限。如果已添加权限但仍无效，请先完全退出 V2T 后重新打开。`;
  }
  return '单键或纯修饰键需要 macOS 辅助功能权限。如果已添加权限但仍无效，请先完全退出 V2T 后重新打开。';
}

function hotkeyBackendLabel(backend: HotkeyStatus['backend']): string {
  return backend === 'native-listener' ? '系统监听' : 'Electron 快捷键';
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

function loadCloudTestResults(): Record<string, CloudLlmTestResultView> {
  try {
    return JSON.parse(localStorage.getItem('v2t.cloudLlmTestResults') ?? '{}') as Record<string, CloudLlmTestResultView>;
  } catch {
    return {};
  }
}

function saveCloudTestResults(results: Record<string, CloudLlmTestResultView>): void {
  localStorage.setItem('v2t.cloudLlmTestResults', JSON.stringify(results));
}

function latestCloudResult(results: Record<string, CloudLlmTestResultView>): CloudLlmTestResultView | undefined {
  return Object.values(results).sort((left, right) => right.testedAt.localeCompare(left.testedAt))[0];
}

function cloudTestInlineLabel(result: CloudLlmTestResultView): string {
  if (!result.ok) {
    return '测试失败';
  }
  const elapsed = result.latencyMs ? `${Math.round(result.latencyMs / 100) / 10}s` : '未知耗时';
  return `${elapsed} · 验收 ${result.qualityScore ?? '-'} · ${result.outputChars} 字`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function recordingMaxDurationMs(value: Settings['recording']['maxDurationMinutes'] | undefined): number | null {
  return value === null ? null : (value ?? 10) * 60 * 1000;
}

function recordingLimitLabel(value: Settings['recording']['maxDurationMinutes'] | undefined): string {
  return value === null ? '不限时' : `${value ?? 10} 分钟`;
}

function recordingLimitOptions(): Array<{ label: string; value: Settings['recording']['maxDurationMinutes'] }> {
  return [
    { label: '5分钟', value: 5 },
    { label: '10分钟', value: 10 },
    { label: '20分钟', value: 20 },
    { label: '不限时', value: null }
  ];
}

function naturalAsrRecommendations(catalog: ModelCatalogItem[]): Array<{ id: string; title: string; reason: string }> {
  const byId = new Map(catalog.map((model) => [model.id, model]));
  return [
    {
      id: 'qwen3-asr-0.6b',
      title: byId.get('qwen3-asr-0.6b')?.name ?? 'Qwen3-ASR 0.6B int8',
      reason: '自然口述首选；中文、粤语、方言和中英混输覆盖更均衡。'
    },
    {
      id: 'funasr-nano-int8-2025-12-30',
      title: byId.get('funasr-nano-int8-2025-12-30')?.name ?? 'Fun-ASR-Nano int8',
      reason: '速度和资源占用更友好，适合日常快速输入。'
    },
    {
      id: 'sensevoice-onnx-int8-2025-09-09',
      title: byId.get('sensevoice-onnx-int8-2025-09-09')?.name ?? 'SenseVoice ONNX int8',
      reason: '高速轻量，适合短句和快速试用；自然长句可与上面两个模型对比。'
    }
  ];
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
