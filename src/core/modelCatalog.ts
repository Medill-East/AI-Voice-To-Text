import type { HardwareProfile, ModelCatalogItem, ModelInstallStatus, ModelRecommendation } from './types';

export const DEFAULT_MODEL_CATALOG: ModelCatalogItem[] = [
  {
    id: 'funasr-nano-int8-2025-12-30',
    name: 'Fun-ASR-Nano int8 2025-12-30',
    family: 'funasr-nano',
    releasedAt: '2025-12-30',
    installable: true,
    runtime: 'sherpa-onnx',
    sherpaModelType: 'funasrNano',
    sourceUrl:
      'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-funasr-nano-int8-2025-12-30.tar.bz2',
    license: 'Apache-2.0',
    sizeMb: 948,
    languages: ['中文', '英文', '日文', '中文方言'],
    qualityTags: ['中文优先', '方言增强', '最新精选', '本地离线'],
    hardwareRequirements: { minMemoryGb: 16, recommendedTier: 'high' },
    archiveType: 'tar.bz2',
    extractedDir: 'sherpa-onnx-funasr-nano-int8-2025-12-30',
    primaryModelFile: 'encoder_adaptor.int8.onnx',
    requiredFiles: [
      'encoder_adaptor.int8.onnx',
      'llm.int8.onnx',
      'embedding.int8.onnx',
      'Qwen3-0.6B/tokenizer.json',
      'Qwen3-0.6B/vocab.json',
      'Qwen3-0.6B/merges.txt'
    ]
  },
  {
    id: 'firered-asr2-zh-en-int8-2026-02-26',
    name: 'FireRed ASR2 zh_en int8 2026-02-26',
    family: 'firered-asr2',
    releasedAt: '2026-02-26',
    installable: true,
    runtime: 'sherpa-onnx',
    sherpaModelType: 'fireRedAsr',
    sourceUrl:
      'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-fire-red-asr2-zh_en-int8-2026-02-26.tar.bz2',
    license: 'Apache-2.0',
    sizeMb: 1185,
    languages: ['中文', '英文', '中文方言'],
    qualityTags: ['中文优先', '方言增强', '大模型候选', '本地离线'],
    hardwareRequirements: { minMemoryGb: 16, recommendedTier: 'high' },
    archiveType: 'tar.bz2',
    extractedDir: 'sherpa-onnx-fire-red-asr2-zh_en-int8-2026-02-26',
    primaryModelFile: 'encoder.int8.onnx',
    requiredFiles: ['encoder.int8.onnx', 'decoder.int8.onnx', 'tokens.txt']
  },
  {
    id: 'sensevoice-onnx-int8-2025-09-09',
    name: 'SenseVoice ONNX int8 2025-09-09',
    family: 'sensevoice',
    releasedAt: '2025-09-09',
    installable: true,
    runtime: 'sherpa-onnx',
    sherpaModelType: 'senseVoice',
    sourceUrl:
      'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09.tar.bz2',
    license: 'Apache-2.0',
    sizeMb: 240,
    languages: ['中文', '粤语', '英文', '日文', '韩文'],
    qualityTags: ['中文优先', '粤语增强', '轻量', '本地离线'],
    hardwareRequirements: { minMemoryGb: 8, recommendedTier: 'medium' },
    archiveType: 'tar.bz2',
    extractedDir: 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09',
    primaryModelFile: 'model.int8.onnx',
    requiredFiles: ['model.int8.onnx', 'tokens.txt']
  }
];

export function recommendModels(
  catalog: ModelCatalogItem[],
  hardware: HardwareProfile,
  statuses: Record<string, ModelInstallStatus> = {}
): ModelRecommendation[] {
  return latestInstallableByFamily(catalog)
    .map((model) => scoreModel(model, hardware, statuses[model.id] ?? 'not-installed'))
    .sort((left, right) => right.score - left.score)
    .slice(0, 3);
}

function latestInstallableByFamily(catalog: ModelCatalogItem[]): ModelCatalogItem[] {
  const latest = new Map<string, ModelCatalogItem>();
  for (const model of catalog) {
    if (!model.installable) {
      continue;
    }
    const current = latest.get(model.family);
    if (!current || model.releasedAt > current.releasedAt) {
      latest.set(model.family, model);
    }
  }
  return [...latest.values()];
}

function scoreModel(model: ModelCatalogItem, hardware: HardwareProfile, status: ModelInstallStatus): ModelRecommendation {
  let score = 0;
  const reasons: string[] = [];

  if (model.qualityTags.includes('中文优先')) {
    score += 45;
    reasons.push('中文识别优先');
  }

  if (model.qualityTags.includes('方言增强')) {
    score += 12;
    reasons.push('方言支持更强');
  }

  if (model.id === 'funasr-nano-int8-2025-12-30') {
    score += 20;
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

  if (hardware.recommendedTier === 'low' && model.sizeMb > 700) {
    score -= 18;
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
    score -= 8;
  }

  if (model.sizeMb > 1000) {
    score -= 18;
  }

  if (model.qualityTags.includes('轻量')) {
    score += 8;
  }

  if (status === 'current') {
    score += 8;
  }

  if (reasons.length === 0) {
    reasons.push('作为跨语言兜底模型');
  }

  return { model, score, reasons, status };
}
