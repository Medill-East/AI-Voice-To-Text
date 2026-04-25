export type InputMode = 'natural' | 'structured';
export type AsrProviderKind = 'local-sherpa-onnx' | 'funasr-http' | 'whisper-cpp';
export type ModelRuntime = 'sherpa-onnx' | 'whisper-cpp';
export type SherpaModelType = 'senseVoice' | 'funasrNano' | 'fireRedAsr' | 'fireRedAsrCtc' | 'paraformer' | 'zipformerCtc';
export type ModelInstallStatus = 'not-installed' | 'downloading' | 'installed' | 'current' | 'failed';
export type RecommendedTier = 'low' | 'medium' | 'high';

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
  hotkey: {
    accelerator: string;
    longPressMs: number;
    fallbackAccelerator?: string;
  };
  dataDir?: string;
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
      enabled: boolean;
      kind: 'openai-compatible';
      baseUrl: string;
      model: string;
      apiKeyRef: string;
    };
  };
  sync: {
    kind: 'local-folder' | 'github';
    github: {
      repoUrl?: string;
      localPath?: string;
      branch: string;
      lastSyncAt?: string;
    };
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
  runtime: ModelRuntime;
  sherpaModelType?: SherpaModelType;
  sourceUrl: string;
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
}

export interface ModelRecommendation {
  model: ModelCatalogItem;
  score: number;
  reasons: string[];
  status: ModelInstallStatus;
}

export interface ModelStatusRecord {
  modelId: string;
  status: ModelInstallStatus;
  progress?: number;
  modelPath?: string;
  error?: string;
  updatedAt: string;
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
}

export interface GitHubSyncStatus {
  configured: boolean;
  repoUrl?: string;
  localPath: string;
  branch: string;
  dirty: boolean;
  lastSyncAt?: string;
  message?: string;
}

export interface HistoryEntry {
  id: string;
  createdAt: string;
  mode: InputMode;
  rawText: string;
  outputText: string;
  targetApp?: string;
  injectionMethod: 'cursor' | 'clipboard';
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
}
