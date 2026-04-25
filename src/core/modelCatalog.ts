import type { HardwareProfile, ModelCatalogItem, ModelInstallStatus, ModelRecommendation } from './types';

export const DEFAULT_MODEL_CATALOG: ModelCatalogItem[] = [
  {
    id: 'sensevoice-onnx-int8-2025',
    name: 'SenseVoice ONNX int8 2025',
    runtime: 'sherpa-onnx',
    sourceUrl:
      'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09.tar.bz2',
    license: 'Apache-2.0',
    sizeMb: 240,
    languages: ['中文', '粤语', '英文', '日文', '韩文'],
    qualityTags: ['中文优先', '粤语增强', '低延迟', '本地离线'],
    hardwareRequirements: { minMemoryGb: 8, recommendedTier: 'medium' },
    archiveType: 'tar.bz2',
    extractedDir: 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09',
    primaryModelFile: 'model.int8.onnx',
    requiredFiles: ['model.int8.onnx', 'tokens.txt']
  },
  {
    id: 'sensevoice-onnx-int8-2024',
    name: 'SenseVoice ONNX int8 2024',
    runtime: 'sherpa-onnx',
    sourceUrl:
      'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17.tar.bz2',
    license: 'Apache-2.0',
    sizeMb: 240,
    languages: ['中文', '粤语', '英文', '日文', '韩文'],
    qualityTags: ['中文优先', '稳定备用', '低延迟', '本地离线'],
    hardwareRequirements: { minMemoryGb: 8, recommendedTier: 'medium' },
    archiveType: 'tar.bz2',
    extractedDir: 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17',
    primaryModelFile: 'model.int8.onnx',
    requiredFiles: ['model.int8.onnx', 'tokens.txt']
  },
  {
    id: 'whispercpp-large-v3-turbo-q5',
    name: 'Whisper.cpp large-v3-turbo q5',
    runtime: 'whisper-cpp',
    sourceUrl: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin',
    license: 'MIT',
    sizeMb: 574,
    languages: ['多语言', '中文', '英文'],
    qualityTags: ['跨语言兜底', '生态成熟', '体积较大'],
    hardwareRequirements: { minMemoryGb: 16, recommendedTier: 'high' },
    archiveType: 'file',
    extractedDir: 'whispercpp-large-v3-turbo-q5',
    primaryModelFile: 'ggml-large-v3-turbo-q5_0.bin',
    requiredFiles: ['ggml-large-v3-turbo-q5_0.bin']
  }
];

export function recommendModels(
  catalog: ModelCatalogItem[],
  hardware: HardwareProfile,
  statuses: Record<string, ModelInstallStatus> = {}
): ModelRecommendation[] {
  return catalog
    .map((model) => scoreModel(model, hardware, statuses[model.id] ?? 'not-installed'))
    .sort((left, right) => right.score - left.score)
    .slice(0, 3);
}

function scoreModel(model: ModelCatalogItem, hardware: HardwareProfile, status: ModelInstallStatus): ModelRecommendation {
  let score = 0;
  const reasons: string[] = [];

  if (model.qualityTags.includes('中文优先')) {
    score += 45;
    reasons.push('中文识别优先');
  }

  if (model.id === 'sensevoice-onnx-int8-2025') {
    score += 18;
    reasons.push('当前默认精选模型');
  }

  if (hardware.memoryGb >= model.hardwareRequirements.minMemoryGb) {
    score += 15;
  } else {
    score -= 30;
  }

  if (hardware.recommendedTier === 'low' && model.sizeMb < 500) {
    score += 24;
    reasons.push('适合低内存设备');
  }

  if (hardware.recommendedTier === 'high' && model.hardwareRequirements.recommendedTier === 'high') {
    score += 10;
    reasons.push('适合高性能设备');
  }

  if (hardware.platform === 'darwin' && hardware.arch === 'arm64' && model.runtime === 'sherpa-onnx') {
    score += 12;
    reasons.push('适合 Apple Silicon 本地运行');
  }

  if (model.sizeMb > 800) {
    score -= 12;
  }

  if (status === 'current') {
    score += 8;
  }

  if (reasons.length === 0) {
    reasons.push('作为跨语言兜底模型');
  }

  return { model, score, reasons, status };
}
