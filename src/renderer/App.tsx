import { useCallback, useEffect, useRef, useState } from 'react';
import { normalizeAccelerator, shortcutFromRecordedKeys } from '../core/hotkeyRecorder';
import type { InputMode, ModelRecommendation, Settings, VoiceInputPipelineResult } from '../core/types';
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
  const [showAdvanced, setShowAdvanced] = useState(false);
  const recorderRef = useRef<PcmRecorder | null>(null);
  const modeRef = useRef<InputMode>('natural');
  const recordingStateRef = useRef<RecordingState>('idle');

  const applySetup = useCallback((nextSetup: SetupPayload) => {
    setSetup(nextSetup);
    setSettings(nextSetup.settings);
    setMode(nextSetup.settings.defaultMode);
    setHotkeyStatus(nextSetup.hotkeyStatus);
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
      setState('recording');
    } catch (caught) {
      setState('error');
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }, []);

  const processRecording = useCallback(async (bytes: Uint8Array, activeMode: InputMode) => {
    setState('processing');
    try {
      const result = await window.v2t.processAudio({ bytes, mode: activeMode });
      setHistory((items) => [{ ...result, createdAt: new Date().toISOString(), mode: activeMode }, ...items].slice(0, 30));
      setState('idle');
    } catch (caught) {
      setState('error');
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }, []);

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

  const handleHotkeyCapture = async (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!capturingHotkey) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const mainKey = isModifierKey(event.key) ? null : event.key;
    if (!mainKey) {
      return;
    }

    try {
      const keys = [
        event.metaKey || event.ctrlKey ? 'Meta' : '',
        event.altKey ? 'Alt' : '',
        event.shiftKey ? 'Shift' : '',
        mainKey
      ].filter(Boolean);
      await updateHotkey(shortcutFromRecordedKeys(keys, hotkeyPlatform()));
    } catch (caught) {
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
            <h2>模型推荐</h2>
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
                      installingModelId={installingModelId}
                      onInstall={installModel}
                    />
                  ))}
                </div>
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
                <dd>{settings?.hotkey.accelerator ?? '加载中'}</dd>
              </div>
              <div>
                <dt>监听</dt>
                <dd>{hotkeyStatus ? `${hotkeyStatus.backend}${hotkeyStatus.registered ? '' : ' 未注册'}` : '初始化'}</dd>
              </div>
            </dl>
            <div className="button-row">
              <button
                className={`secondary ${capturingHotkey ? 'listening' : ''}`}
                onClick={() => setCapturingHotkey(true)}
                onKeyDown={(event) => void handleHotkeyCapture(event)}
              >
                {capturingHotkey ? '按下组合键' : '录制快捷键'}
              </button>
              <button className="secondary" onClick={() => void updateHotkey('CommandOrControl+Shift+Space')}>
                恢复默认
              </button>
            </div>
          </section>

          {settings ? (
            <section>
              <button className="section-toggle" onClick={() => setShowAdvanced((value) => !value)}>
                {showAdvanced ? '收起高级设置' : '高级设置'}
              </button>
              {showAdvanced ? (
                <div className="advanced">
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

function ModelRow({
  recommendation,
  currentModelId,
  installingModelId,
  onInstall
}: {
  recommendation: ModelRecommendation;
  currentModelId?: string;
  installingModelId: string | null;
  onInstall(modelId: string): Promise<void>;
}) {
  const isCurrent = currentModelId === recommendation.model.id;
  const installing = installingModelId === recommendation.model.id;
  const unsupported = recommendation.model.runtime === 'whisper-cpp';

  return (
    <article className={`model-row ${isCurrent ? 'current' : ''}`}>
      <div>
        <h3>{recommendation.model.name}</h3>
        <p>{recommendation.reasons.join(' · ')}</p>
        <small>
          {recommendation.model.sizeMb}MB · {recommendation.model.languages.join('/')}
        </small>
      </div>
      <button onClick={() => void onInstall(recommendation.model.id)} disabled={installing || isCurrent || unsupported}>
        {isCurrent ? '当前' : unsupported ? '待接入' : installing ? '安装中' : '安装'}
      </button>
    </article>
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

function isModifierKey(key: string): boolean {
  return ['Meta', 'Control', 'Shift', 'Alt'].includes(key);
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
