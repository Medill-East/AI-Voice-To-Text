import { useCallback, useEffect, useRef, useState } from 'react';
import { normalizeAccelerator, shortcutFromRecordedKeys } from '../core/hotkeyRecorder';
import type { InputMode, InstalledModelView, Lexicon, ModelRecommendation, ModelStatusRecord, Settings, VoiceInputPipelineResult } from '../core/types';
import type { HotkeyStatus } from '../main/hotkeyService';
import type { RecordingCommand, SetupPayload } from '../preload';

type RecordingState = 'idle' | 'recording' | 'processing' | 'error';
type AppPage = 'voice' | 'models' | 'hotkey' | 'lexicon' | 'sync' | 'advanced' | 'app';

const APP_PAGES: Array<{ id: AppPage; label: string }> = [
  { id: 'voice', label: '语音输入' },
  { id: 'models', label: '模型' },
  { id: 'hotkey', label: '快捷键' },
  { id: 'lexicon', label: '词库' },
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
  const [hotkeyStatus, setHotkeyStatus] = useState<HotkeyStatus | undefined>();
  const [capturingHotkey, setCapturingHotkey] = useState(false);
  const [installingModelId, setInstallingModelId] = useState<string | null>(null);
  const [installProgressById, setInstallProgressById] = useState<Record<string, ModelStatusRecord>>({});
  const [activatingModelId, setActivatingModelId] = useState<string | null>(null);
  const [deletingModelId, setDeletingModelId] = useState<string | null>(null);
  const [syncRepoUrl, setSyncRepoUrl] = useState('');
  const [syncBusy, setSyncBusy] = useState<string | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [testingHotkey, setTestingHotkey] = useState(false);
  const [hotkeyTestMessage, setHotkeyTestMessage] = useState<string | null>(null);
  const [lexicon, setLexicon] = useState<Lexicon | null>(null);
  const [lexiconDirty, setLexiconDirty] = useState(false);
  const [lexiconMessage, setLexiconMessage] = useState<string | null>(null);
  const recorderRef = useRef<PcmRecorder | null>(null);
  const modeRef = useRef<InputMode>('natural');
  const recordingStateRef = useRef<RecordingState>('idle');
  const recordingStartedAtRef = useRef<number | undefined>(undefined);
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
    setSyncRepoUrl(nextSetup.settings.sync.github.repoUrl ?? '');
    setInstallProgressById(nextSetup.modelStatuses);
  }, []);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    recordingStateRef.current = state;
  }, [state]);

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
    void window.v2t
      .getLexicon()
      .then(setLexicon)
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

  const stopRecording = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder) {
      return;
    }

    recorder.processor.disconnect();
    recorder.source.disconnect();
    recorder.stream.getTracks().forEach((track) => track.stop());
    void recorder.context.close();
    recorderRef.current = null;
    resetInputMeter();

    const wav = encodeWav(recorder.chunks, recorder.inputSampleRate, 16000);
    void processRecording(wav, modeRef.current);
  }, [resetInputMeter]);

  const startRecording = useCallback(async () => {
    if (recordingStateRef.current === 'recording' || recordingStateRef.current === 'processing') {
      return;
    }

    setError(null);
    resetInputMeter();

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
      recordingStartedAtRef.current = Date.now();
      setState('recording');
    } catch (caught) {
      recordingStartedAtRef.current = undefined;
      resetInputMeter();
      setState('error');
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }, [resetInputMeter, updateInputMeter]);

  const processRecording = useCallback(async (bytes: Uint8Array, activeMode: InputMode) => {
    setState('processing');
    try {
      const result = await window.v2t.processAudio({ bytes, mode: activeMode });
      setHistory((items) => [{ ...result, createdAt: new Date().toISOString(), mode: activeMode }, ...items].slice(0, 30));
      recordingStartedAtRef.current = undefined;
      resetInputMeter();
      setState('idle');
    } catch (caught) {
      recordingStartedAtRef.current = undefined;
      resetInputMeter();
      setState('error');
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }, [resetInputMeter]);

  useEffect(() => {
    const syncOverlay = () => {
      void window.v2t
        .setRecordingOverlayState({
          state,
          mode,
          startedAt: recordingStartedAtRef.current,
          now: Date.now(),
          level: inputLevelRef.current,
          inputActive: inputActiveRef.current,
          silenceMs: silenceMsRef.current
        })
        .catch(() => undefined);
    };
    syncOverlay();
    if (state !== 'recording' && state !== 'processing') {
      return;
    }
    const timer = window.setInterval(syncOverlay, state === 'recording' ? 120 : 500);
    return () => window.clearInterval(timer);
  }, [mode, state]);

  useEffect(() => {
    return window.v2t.onRecordingCommand((command: RecordingCommand) => {
      if (command.type === 'start') {
        void startRecording();
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

          <div className="mode-switch" role="tablist" aria-label="输入模式">
            <button className={mode === 'natural' ? 'active' : ''} onClick={() => setMode('natural')}>
              自然输入
            </button>
            <button className={mode === 'structured' ? 'active' : ''} onClick={() => setMode('structured')}>
              结构输入
            </button>
          </div>

          <button
            className={`record-button ${state === 'recording' ? 'recording' : ''}`}
            onClick={() => {
              if (state === 'recording') {
                stopRecording();
              } else {
                void startRecording();
              }
            }}
            disabled={state === 'processing'}
          >
            <span />
            {state === 'recording' ? '停止' : state === 'processing' ? '整理中' : '录音'}
          </button>

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
            {hotkeyStatus?.appAccessibilityTrusted !== undefined ? (
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
          </dl>
          <div className="button-row three">
            <button className="secondary" onClick={() => void openAccessibilitySettings()}>
              打开权限
            </button>
            <button className="secondary" onClick={() => void showNativeHelper()}>
              显示组件
            </button>
            <button className="secondary" onClick={() => void refreshHotkeyPermissions()}>
              重新检测
            </button>
          </div>
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
              <p className="hint">同步包含设置、词库和提示词；词库内容请在“词库”页编辑。历史、模型和密钥不会同步。</p>
              <label>
                仓库 URL
                <input
                  value={syncRepoUrl}
                  placeholder="git@github.com:you/v2t-sync.git"
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

function ModelRow({
  recommendation,
  currentModelId,
  statusRecord,
  installingModelId,
  deletingModelId,
  onInstall,
  onDelete
}: {
  recommendation: ModelRecommendation;
  currentModelId?: string;
  statusRecord?: ModelStatusRecord;
  installingModelId: string | null;
  deletingModelId: string | null;
  onInstall(modelId: string): Promise<void>;
  onDelete(modelId: string): Promise<void>;
}) {
  const isCurrent = currentModelId === recommendation.model.id;
  const status = statusRecord?.status;
  const installing = installingModelId === recommendation.model.id || isInstallInProgress(status);
  const deleting = deletingModelId === recommendation.model.id;
  const canDelete = !isCurrent && (status === 'installed' || status === 'current');

  return (
    <article className={`model-row ${isCurrent ? 'current' : ''}`}>
      <div>
        <h3>{recommendation.model.name}</h3>
        <p>{recommendation.reasons.join(' · ')}</p>
        <small>
          {recommendation.model.sizeMb}MB · {recommendation.model.languages.join('/')}
        </small>
        {statusRecord ? <InstallProgress status={statusRecord} /> : null}
      </div>
      <button onClick={() => void onInstall(recommendation.model.id)} disabled={installing || isCurrent}>
        {isCurrent ? '当前' : installing ? '安装中' : '安装'}
      </button>
      {canDelete ? (
        <button className="danger" onClick={() => void onDelete(recommendation.model.id)} disabled={deleting}>
          {deleting ? '删除中' : '删除'}
        </button>
      ) : null}
    </article>
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

function stateLabel(state: RecordingState): string {
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
  return accelerator
    .replaceAll('RightAlt', '右 Option')
    .replaceAll('LeftAlt', '左 Option')
    .replaceAll('Alt', '任意 Option')
    .replaceAll('RightCommand', '右 Command')
    .replaceAll('LeftCommand', '左 Command')
    .replaceAll('CommandOrControl', 'Command/Ctrl')
    .replaceAll('Command', '任意 Command')
    .replaceAll('RightControl', '右 Control')
    .replaceAll('LeftControl', '左 Control')
    .replaceAll('Control', '任意 Control')
    .replaceAll('RightShift', '右 Shift')
    .replaceAll('LeftShift', '左 Shift')
    .replaceAll('Shift', '任意 Shift');
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
