import { useCallback, useEffect, useRef, useState } from 'react';
import { normalizeAccelerator, shortcutFromRecordedKeys } from '../core/hotkeyRecorder';
import type { InputMode, InstalledModelView, ModelRecommendation, ModelStatusRecord, Settings, VoiceInputPipelineResult } from '../core/types';
import type { HotkeyStatus } from '../main/hotkeyService';
import type { RecordingCommand, SetupPayload } from '../preload';

type RecordingState = 'idle' | 'recording' | 'processing' | 'error';

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
  const [showAdvanced, setShowAdvanced] = useState(false);
  const recorderRef = useRef<PcmRecorder | null>(null);
  const modeRef = useRef<InputMode>('natural');
  const recordingStateRef = useRef<RecordingState>('idle');
  const recordingStartedAtRef = useRef<number | undefined>(undefined);
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

  useEffect(() => {
    void window.v2t.getSetup().then(applySetup);
    return window.v2t.onHotkeyStatus(setHotkeyStatus);
  }, [applySetup]);

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

    const wav = encodeWav(recorder.chunks, recorder.inputSampleRate, 16000);
    void processRecording(wav, modeRef.current);
  }, []);

  const startRecording = useCallback(async () => {
    if (recordingStateRef.current === 'recording' || recordingStateRef.current === 'processing') {
      return;
    }

    setError(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const context = new AudioContext();
      const source = context.createMediaStreamSource(stream);
      const processor = context.createScriptProcessor(4096, 1, 1);
      const chunks: Float32Array[] = [];

      processor.onaudioprocess = (event) => {
        chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
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
      setState('error');
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }, []);

  const processRecording = useCallback(async (bytes: Uint8Array, activeMode: InputMode) => {
    setState('processing');
    try {
      const result = await window.v2t.processAudio({ bytes, mode: activeMode });
      setHistory((items) => [{ ...result, createdAt: new Date().toISOString(), mode: activeMode }, ...items].slice(0, 30));
      recordingStartedAtRef.current = undefined;
      setState('idle');
    } catch (caught) {
      recordingStartedAtRef.current = undefined;
      setState('error');
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }, []);

  useEffect(() => {
    const syncOverlay = () => {
      void window.v2t
        .setRecordingOverlayState({
          state,
          mode,
          startedAt: recordingStartedAtRef.current,
          now: Date.now()
        })
        .catch(() => undefined);
    };
    syncOverlay();
    if (state !== 'recording' && state !== 'processing') {
      return;
    }
    const timer = window.setInterval(syncOverlay, 500);
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
    applySetup(await window.v2t.refreshHotkeyPermissions());
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

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">V2T</p>
          <h1>语音输入</h1>
          {setup ? (
            <p className="build-info">
              v{setup.appInfo.version} · {setup.appInfo.buildCommit}
            </p>
          ) : null}
        </div>
        <div className="status-row">
          <span className={`status-dot ${state}`} />
          <span>{stateLabel(state)}</span>
        </div>
      </header>

      <section className="workspace">
        <section className="primary">
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

          {error ? <p className="error">{error}</p> : null}

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

        <aside className="side">
          <section>
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

          <section>
            <h2>触发按键</h2>
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
              {hotkeyStatus?.needsAccessibilityPermission ? (
                <div>
                  <dt>权限</dt>
                  <dd>单键或纯修饰键需要 macOS 辅助功能权限；未开启时会使用备用快捷键。</dd>
                </div>
              ) : null}
              {settings?.hotkey.fallbackAccelerator ? (
                <div>
                  <dt>备用</dt>
                  <dd>{hotkeyLabel(settings.hotkey.fallbackAccelerator)}</dd>
                </div>
              ) : null}
            </dl>
            {hotkeyStatus?.needsAccessibilityPermission ? (
              <div className="button-row">
                <button className="secondary" onClick={() => void openAccessibilitySettings()}>
                  打开权限设置
                </button>
                <button className="secondary" onClick={() => void refreshHotkeyPermissions()}>
                  重新检测
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
            {capturingHotkey ? <p className="hint">单个修饰键可以保存，但更容易误触；普通字母和数字单键仍会被拒绝。</p> : null}
          </section>

          {settings ? (
            <section>
              <h2>GitHub 同步</h2>
              <p className="hint">只同步设置、词库和提示词，不同步历史和模型。</p>
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
            </section>
          ) : null}

          {settings ? (
            <section>
              <button className="section-toggle" onClick={() => setShowAdvanced((value) => !value)}>
                {showAdvanced ? '收起高级设置' : '高级设置'}
              </button>
              {showAdvanced ? (
                <div className="advanced">
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
                </div>
              ) : null}
            </section>
          ) : null}
        </aside>
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
  if (status.fallbackRegistered) {
    return `备用快捷键已启用：${hotkeyLabel(status.activeAccelerator ?? '')}`;
  }
  if (!status.registered) {
    return `${hotkeyBackendLabel(status.backend)} 未注册`;
  }
  return `${hotkeyBackendLabel(status.backend)} 已注册`;
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
