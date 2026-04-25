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
    ],
    benchmarks: {
      sourceLabel: 'sherpa-onnx / Fun-ASR-Nano',
      sourceUrl: 'https://k2-fsa.github.io/sherpa/onnx/funasr-nano/pretrained.html',
      note: '官方评测同源模型参考；V2T 先按中文适配、本机速度和硬件匹配推荐。'
    },
    evaluationSources: {
      openAsrLeaderboard: {
        sourceLabel: 'Open ASR Leaderboard',
        sourceUrl: 'https://github.com/huggingface/open_asr_leaderboard',
        track: '通用 ASR',
        exactModelMatch: false,
        note: '未找到当前 sherpa-onnx ONNX int8 包的 exact match；不硬套公开榜单排名。'
      },
      officialBenchmark: {
        sourceLabel: 'FunAudioLLM/Fun-ASR-Nano-2512 model card',
        sourceUrl: 'https://huggingface.co/FunAudioLLM/Fun-ASR-Nano-2512',
        note: '同源模型参考，不代表当前 ONNX int8 实测。',
        metrics: [
          { label: 'AIShell1', metric: 'WER', value: 1.8, lowerIsBetter: true, dataset: 'Open-source dataset' },
          { label: 'Fleurs-zh', metric: 'WER', value: 2.56, lowerIsBetter: true, dataset: 'Open-source dataset' },
          { label: 'WenetSpeech Meeting', metric: 'WER', value: 6.6, lowerIsBetter: true, dataset: 'Open-source dataset' },
          { label: 'WenetSpeech Net', metric: 'WER', value: 6.01, lowerIsBetter: true, dataset: 'Open-source dataset' },
          { label: 'Dialect', metric: 'WER', value: 28.18, lowerIsBetter: true, dataset: 'Industry dataset' }
        ]
      },
      localRecommendation: {
        note: 'V2T 本机适配分，结合中文适配、速度、硬件匹配、体积和语言覆盖计算。'
      }
    }
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
    requiredFiles: ['encoder.int8.onnx', 'decoder.int8.onnx', 'tokens.txt'],
    benchmarks: {
      sourceLabel: 'sherpa-onnx / FireRed ASR2',
      sourceUrl: 'https://k2-fsa.github.io/sherpa/onnx/FireRedAsr/pretrained.html',
      note: '官方评测同源模型参考；V2T 先按中文适配、本机速度和硬件匹配推荐。'
    },
    evaluationSources: {
      openAsrLeaderboard: {
        sourceLabel: 'Open ASR Leaderboard',
        sourceUrl: 'https://github.com/huggingface/open_asr_leaderboard',
        track: '通用 ASR',
        exactModelMatch: false,
        note: '未找到当前 sherpa-onnx ONNX int8 包的 exact match；不硬套公开榜单排名。'
      },
      officialBenchmark: {
        sourceLabel: 'FireRedASR2S paper / official benchmark',
        sourceUrl: 'https://github.com/FireRedTeam/FireRedASR2S',
        note: '同源模型参考，不代表当前 ONNX int8 实测。',
        metrics: [
          { label: 'Mandarin public avg', metric: 'CER', value: 2.89, lowerIsBetter: true, dataset: '4 public Mandarin benchmarks' },
          { label: 'Dialect public avg', metric: 'CER', value: 11.55, lowerIsBetter: true, dataset: '19 Chinese dialect/accent benchmarks' }
        ]
      },
      localRecommendation: {
        note: 'V2T 本机适配分，结合中文适配、速度、硬件匹配、体积和语言覆盖计算。'
      }
    }
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
    requiredFiles: ['model.int8.onnx', 'tokens.txt'],
    benchmarks: {
      sourceLabel: 'sherpa-onnx / SenseVoice',
      sourceUrl: 'https://k2-fsa.github.io/sherpa/onnx/sense-voice/pretrained.html',
      note: '官方评测同源模型参考；V2T 先按中文适配、本机速度和硬件匹配推荐。'
    },
    evaluationSources: {
      openAsrLeaderboard: {
        sourceLabel: 'Open ASR Leaderboard',
        sourceUrl: 'https://github.com/huggingface/open_asr_leaderboard',
        track: '通用 ASR',
        exactModelMatch: false,
        note: '未找到 exact match；不硬套公开榜单排名。'
      },
      officialBenchmark: {
        sourceLabel: 'SenseVoice / sherpa-onnx model notes',
        sourceUrl: 'https://k2-fsa.github.io/sherpa/onnx/sense-voice/pretrained.html',
        note: '同源模型参考，不代表当前 ONNX int8 实测；官方重点说明多语言和粤语覆盖。',
        metrics: [
          { label: '模型体积', metric: 'Rank', value: 240, lowerIsBetter: true, dataset: 'MB' },
          { label: '覆盖语言', metric: 'Rank', value: 5, lowerIsBetter: false, dataset: 'zh/en/ja/ko/yue' }
        ]
      },
      localRecommendation: {
        note: 'V2T 本机适配分，结合中文适配、速度、硬件匹配、体积和语言覆盖计算。'
      }
    }
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
  let rawScore = 0;
  const reasons: string[] = [];
  const scoreBreakdown = [
    scoreChineseFit(model),
    scoreRuntimeFit(model, hardware),
    scoreHardwareFit(model, hardware),
    scoreSize(model, hardware),
    scoreLanguageCoverage(model)
  ];

  rawScore += scoreBreakdown.reduce((sum, item) => sum + item.value, 0);

  if (model.qualityTags.includes('中文优先')) {
    reasons.push('中文识别优先');
  }

  if (model.qualityTags.includes('方言增强')) {
    reasons.push('方言支持更强');
  }

  if (model.id === 'funasr-nano-int8-2025-12-30') {
    rawScore += 12;
    reasons.push('当前默认精选模型');
  }

  if (hardware.recommendedTier === 'low' && model.sizeMb < 500) {
    reasons.push('适合低内存设备');
  }

  if (hardware.recommendedTier === 'high' && model.hardwareRequirements.recommendedTier === 'high') {
    reasons.push('适合高性能设备');
  }

  if (hardware.platform === 'darwin' && hardware.arch === 'arm64' && model.runtime === 'sherpa-onnx') {
    reasons.push('适合 Apple Silicon 本地运行');
  }

  if (status === 'current') {
    rawScore += 6;
  }

  if (reasons.length === 0) {
    reasons.push('作为跨语言兜底模型');
  }

  return { model, score: clampScore(rawScore), scoreBreakdown, reasons, status };
}

function scoreChineseFit(model: ModelCatalogItem) {
  const value = 10 + (model.qualityTags.includes('中文优先') ? 24 : 0) + (model.qualityTags.includes('方言增强') ? 6 : 0);
  return { label: '中文适配', value, reason: model.qualityTags.includes('中文优先') ? '中文优先模型' : '通用识别' };
}

function scoreRuntimeFit(model: ModelCatalogItem, hardware: HardwareProfile) {
  const value = hardware.platform === 'darwin' && hardware.arch === 'arm64' && model.runtime === 'sherpa-onnx' ? 18 : 12;
  return { label: '本机速度', value, reason: model.runtime === 'sherpa-onnx' ? '本地 sherpa-onnx 可运行' : '本地 runtime 待验证' };
}

function scoreHardwareFit(model: ModelCatalogItem, hardware: HardwareProfile) {
  let value = hardware.memoryGb >= model.hardwareRequirements.minMemoryGb ? 18 : 0;
  if (hardware.recommendedTier === model.hardwareRequirements.recommendedTier) {
    value += 7;
  }
  return { label: '硬件匹配', value, reason: hardware.memoryGb >= model.hardwareRequirements.minMemoryGb ? '内存满足要求' : '内存低于建议' };
}

function scoreSize(model: ModelCatalogItem, hardware: HardwareProfile) {
  let value = model.sizeMb < 500 ? 16 : model.sizeMb < 1000 ? 9 : 3;
  if (hardware.recommendedTier === 'low' && model.sizeMb < 500) {
    value += 8;
  }
  return { label: '体积', value, reason: `${model.sizeMb}MB` };
}

function scoreLanguageCoverage(model: ModelCatalogItem) {
  const value = Math.min(16, model.languages.length * 3 + (model.qualityTags.includes('粤语增强') ? 4 : 0));
  return { label: '语言覆盖', value, reason: model.languages.join('/') };
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}
