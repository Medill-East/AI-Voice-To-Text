export type InputMode = 'natural' | 'structured';
export type AsrProviderKind = 'local-sherpa-onnx' | 'funasr-http' | 'whisper-cpp';
export type ModelRuntime = 'sherpa-onnx' | 'whisper-cpp' | 'external';
export type ModelAvailability = 'installable' | 'manual' | 'reference';
export type SherpaModelType = 'senseVoice' | 'funasrNano' | 'fireRedAsr' | 'fireRedAsrCtc' | 'paraformer' | 'zipformerCtc';
export type ModelInstallStatus =
  | 'not-installed'
  | 'downloading'
  | 'extracting'
  | 'verifying'
  | 'activating'
  | 'installed'
	  | 'current'
	  | 'failed';
export type RecommendedTier = 'low' | 'medium' | 'high';
export type AppUpdateStatus = 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'installing' | 'error';
export type PostProcessorEngine = 'local-rules' | 'llm' | 'llm-local' | 'llm-cloud' | 'llm-fallback';
export type LlmProviderKind = 'openai-compatible' | 'ollama' | 'lm-studio';
export type LlmEngineMode = 'off' | 'local' | 'cloud' | 'local-with-cloud-fallback';
export type LlmInstallStatus = 'not-installed' | 'installed-not-running' | 'service-available' | 'checking' | 'error';

export interface LexiconTerm {
  phrase: string;
  aliases?: string[];
  tags?: string[];
  caseSensitive?: boolean;
}

export interface ReplacementRule {
  from: string;
  to: string;
  caseSensitive?: boolean;
  enabled?: boolean;
}

export interface Lexicon {
  version: number;
  terms: LexiconTerm[];
  replacements: ReplacementRule[];
  blocked: string[];
}

export interface Settings {
  schemaVersion: 1;
  defaultMode: InputMode;
  appearance: {
    theme: 'system' | 'light' | 'dark';
  };
  hotkey: {
    accelerator: string;
    longPressMs: number;
    fallbackAccelerator?: string;
    singleClickMode: InputMode;
    doubleClickMode: InputMode;
  };
  dataDir?: string;
  paths?: {
    modelDir?: string;
  };
  providers: {
    asr: {
      kind: AsrProviderKind;
      endpoint?: string;
      modelId?: string;
      modelPath?: string;
      sherpaModelType?: SherpaModelType;
      language: 'zh' | 'auto' | 'en' | 'yue' | 'ja' | 'ko';
    };
    llm: {
      engine: LlmEngineMode;
      enabled: boolean;
      kind: LlmProviderKind;
      baseUrl: string;
      model: string;
      apiKeyRef: string;
      fastMode: boolean;
      timeoutMs: number;
      fallback: {
        enabled: boolean;
        baseUrl: string;
        model: string;
        apiKeyRef: string;
        timeoutMs: number;
      };
    };
  };
  sync: {
    kind: 'local-folder' | 'github';
    github: {
      repoUrl?: string;
      localPath?: string;
      branch: string;
      lastSyncAt?: string;
      includeHistory?: boolean;
      autoSync?: boolean;
      lastAutoSyncAt?: string;
      lastAutoSyncError?: string;
    };
  };
  updates: {
    autoCheck: boolean;
    autoDownload: boolean;
    lastCheckAt?: string;
    lastError?: string;
  };
}

export interface HardwareProfile {
  platform: NodeJS.Platform;
  arch: NodeJS.Architecture;
  cpuName: string;
  cpuCores: number;
  memoryGb: number;
  gpuName?: string;
  metalSupport?: boolean;
  recommendedTier: RecommendedTier;
}

export interface ModelCatalogItem {
  id: string;
  name: string;
  family: string;
  releasedAt: string;
  installable: boolean;
  availability?: ModelAvailability;
  unavailableReason?: string;
  manualSetup?: string;
  runtimeVerified?: boolean;
  runtime: ModelRuntime;
  sherpaModelType?: SherpaModelType;
  sourceUrl: string;
  downloadSources?: ModelDownloadSource[];
  license: string;
  sizeMb: number;
  languages: string[];
  qualityTags: string[];
  hardwareRequirements: {
    minMemoryGb: number;
    recommendedTier: RecommendedTier;
  };
  checksum?: string;
  archiveType: 'tar.bz2' | 'file';
  extractedDir: string;
  primaryModelFile: string;
  requiredFiles: string[];
  benchmarks?: {
    wer?: number;
    cer?: number;
    rtfx?: number;
    sourceLabel: string;
    sourceUrl?: string;
    note?: string;
  };
  evaluationSources?: ModelEvaluationSources;
}

export interface ModelDownloadSource {
  label: string;
  url: string;
  priority?: number;
  region?: string;
}

export interface ModelEvaluationMetric {
  label: string;
  metric: 'WER' | 'CER' | 'RTFx' | 'Rank';
  value: number;
  lowerIsBetter?: boolean;
  dataset?: string;
}

export interface OpenAsrLeaderboardEvaluation {
  sourceLabel: string;
  sourceUrl: string;
  track: string;
  rank?: number;
  avgWer?: number;
  rtfx?: number;
  exactModelMatch: boolean;
  note?: string;
}

export interface OfficialBenchmarkEvaluation {
  sourceLabel: string;
  sourceUrl: string;
  metrics: ModelEvaluationMetric[];
  note?: string;
}

export interface ChineseBenchmarkEvaluation {
  sourceLabel: string;
  sourceUrl: string;
  metrics: ModelEvaluationMetric[];
  note?: string;
}

export interface ModelEvaluationSources {
  chineseBenchmark?: ChineseBenchmarkEvaluation;
  openAsrLeaderboard?: OpenAsrLeaderboardEvaluation;
  officialBenchmark?: OfficialBenchmarkEvaluation;
  localRecommendation?: {
    note: string;
  };
}

export type ModelCatalogRefreshStatus = 'idle' | 'refreshing' | 'success' | 'failed';

export interface ModelCatalogRefreshAttempt {
  method: 'raw' | 'github-api';
  url: string;
  ok: boolean;
  status?: number;
  error?: string;
  elapsedMs?: number;
}

export interface ModelCatalogRefreshState {
  status: ModelCatalogRefreshStatus;
  catalogVersion?: string;
  sourceUrl?: string;
  updatedAt?: string;
  lastRefreshAt?: string;
  cacheUsed?: boolean;
  cacheUpdatedAt?: string;
  attempts?: ModelCatalogRefreshAttempt[];
  addedModelIds?: string[];
  error?: string;
  message?: string;
}

export interface ModelScoreItem {
  label: string;
  value: number;
  reason: string;
}

export interface ModelRecommendation {
  model: ModelCatalogItem;
  score: number;
  scoreBreakdown: ModelScoreItem[];
  reasons: string[];
  status: ModelInstallStatus;
}

export type AutoSyncStatus = 'idle' | 'queued' | 'syncing' | 'success' | 'failed';

export interface AutoSyncState {
  status: AutoSyncStatus;
  reason?: string;
  message?: string;
  error?: string;
  updatedAt: string;
}

export interface AppUpdateState {
  status: AppUpdateStatus;
  currentVersion: string;
  latestVersion?: string;
  releaseName?: string;
  releaseNotes?: string;
  releaseUrl?: string;
  downloadUrl?: string;
  percent?: number;
  bytesPerSecond?: number;
  transferred?: number;
  total?: number;
  error?: string;
  errorCode?: 'mac-signature-mismatch' | 'update-error';
  updatedAt: string;
}

export interface ModelStatusRecord {
  modelId: string;
  status: ModelInstallStatus;
  progress?: number;
  downloadedBytes?: number;
  totalBytes?: number;
  bytesPerSecond?: number;
  etaSeconds?: number;
  sourceLabel?: string;
  attempt?: number;
  canResume?: boolean;
  isInterrupted?: boolean;
  startedAt?: string;
  lastProgressAt?: string;
  modelPath?: string;
  error?: string;
  updatedAt: string;
}

export interface ModelDownloadProbeResult {
  modelId: string;
  sourceLabel: string;
  url: string;
  ok: boolean;
  supportsRange: boolean;
  status?: number;
  downloadedBytes?: number;
  totalBytes?: number;
  bytesPerSecond?: number;
  durationMs: number;
  error?: string;
}

export interface InstalledModelView {
  modelId: string;
  name: string;
  status: ModelInstallStatus;
  modelPath?: string;
  current: boolean;
  legacy: boolean;
  canActivate: boolean;
  canDelete: boolean;
  canReinstall: boolean;
}

export interface GitHubSyncStatus {
  configured: boolean;
  repoUrl?: string;
  localPath: string;
  branch: string;
  dirty: boolean;
  lastSyncAt?: string;
  message?: string;
  needsImportDecision?: boolean;
  remoteFiles?: string[];
  conflictFiles?: string[];
  defaultRepoPath?: string;
  usingDefaultRepoPath?: boolean;
}

export type SyncImportStrategy = 'none' | 'remote-over-local' | 'local-over-remote' | 'smart-merge';

export interface ProcessingDiagnostic {
  id: string;
  createdAt: string;
  stage: 'queued' | 'processing' | 'asr' | 'post-processing' | 'injecting' | 'done' | 'failed';
  mode: InputMode;
  modelId?: string;
  modelKind?: string;
  sherpaModelType?: SherpaModelType;
  audioBytes: number;
  audioDurationSeconds?: number;
  chunkCount?: number;
  error?: string;
}

export interface PromptFiles {
  natural: string;
  structured: string;
  paths: {
    natural: string;
    structured: string;
  };
}

export interface HistoryEntry {
  id: string;
  createdAt: string;
  mode: InputMode;
  rawText: string;
  outputText: string;
  targetApp?: string;
  injectionMethod: 'cursor' | 'clipboard';
  postProcessorEngine?: PostProcessorEngine;
  error?: string;
}

export interface ProcessTextOptions {
  mode: InputMode;
  lexicon: Lexicon;
  prompt?: string;
}

export interface ProcessedText {
  text: string;
  usedLlm: boolean;
  engine: PostProcessorEngine;
  llmError?: string;
}

export interface LlmCompletionRequest {
  mode: InputMode;
  input: string;
  systemPrompt: string;
}

export interface LlmClient {
  complete(request: LlmCompletionRequest): Promise<string>;
}

export interface AsrTranscription {
  text: string;
  language?: string;
  durationMs?: number;
}

export interface AsrProvider {
  transcribe(audio: Buffer | Uint8Array, options?: { language?: string }): Promise<AsrTranscription>;
}

export interface TextInjectionResult {
  method: 'cursor' | 'clipboard';
  error?: string;
}

export interface TextInjector {
  injectText(text: string): Promise<TextInjectionResult>;
}

export interface VoiceInputPipelineResult {
  id: string;
  rawText: string;
  outputText: string;
  injection: TextInjectionResult;
  usedLlm: boolean;
  postProcessorEngine: PostProcessorEngine;
}

export interface LlmProviderDetection {
  kind: LlmProviderKind;
  label: string;
  baseUrl: string;
  ok: boolean;
  models: string[];
  error?: string;
}

export interface LlmInstallerTarget {
  kind: Exclude<LlmProviderKind, 'openai-compatible'>;
  label: string;
  status: LlmInstallStatus;
  baseUrl: string;
  downloadUrl: string;
  docsUrl: string;
  installActionLabel: string;
  serviceHint: string;
  models: string[];
  error?: string;
}

export interface LlmInstallerActionResult {
  ok: boolean;
  target?: LlmInstallerTarget;
  error?: string;
}

export interface LlmTestResult {
  ok: boolean;
  provider?: LlmProviderKind;
  model?: string;
  output?: string;
  elapsedMs?: number;
  engine?: PostProcessorEngine;
  finishReason?: string;
  reasoningOnly?: boolean;
  error?: string;
}
