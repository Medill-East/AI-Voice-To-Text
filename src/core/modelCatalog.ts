import type { HardwareProfile, ModelCatalogItem, ModelInstallStatus, ModelRecommendation } from './types';

export const DEFAULT_MODEL_CATALOG: ModelCatalogItem[] = [
  {
    id: 'funasr-nano-int8-2025-12-30',
    name: 'Fun-ASR-Nano int8 2025-12-30',
    family: 'funasr-nano',
    releasedAt: '2025-12-30',
    installable: true,
    availability: 'installable',
    runtimeVerified: true,
    runtime: 'sherpa-onnx',
    sherpaModelType: 'funasrNano',
    sourceUrl:
      'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-funasr-nano-int8-2025-12-30.tar.bz2',
    downloadSources: [
      {
        label: 'GitHub Release',
        url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-funasr-nano-int8-2025-12-30.tar.bz2',
        priority: 10
      }
    ],
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
      chineseBenchmark: {
        sourceLabel: 'FunAudioLLM/Fun-ASR-Nano-2512 model card',
        sourceUrl: 'https://huggingface.co/FunAudioLLM/Fun-ASR-Nano-2512',
        note: '中文优先刷新数据；同源模型参考，不代表当前 ONNX int8 实测。',
        metrics: [
          { label: 'AIShell1', metric: 'WER', value: 1.8, lowerIsBetter: true, dataset: 'Open-source Mandarin dataset' },
          { label: 'Fleurs-zh', metric: 'WER', value: 2.56, lowerIsBetter: true, dataset: 'Open-source Mandarin dataset' },
          { label: 'Dialect', metric: 'WER', value: 28.18, lowerIsBetter: true, dataset: 'Industry Chinese dialect dataset' }
        ]
      },
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
    availability: 'installable',
    runtimeVerified: true,
    runtime: 'sherpa-onnx',
    sherpaModelType: 'fireRedAsr',
    sourceUrl:
      'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-fire-red-asr2-zh_en-int8-2026-02-26.tar.bz2',
    downloadSources: [
      {
        label: 'GitHub Release',
        url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-fire-red-asr2-zh_en-int8-2026-02-26.tar.bz2',
        priority: 10
      }
    ],
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
      chineseBenchmark: {
        sourceLabel: 'FireRedASR2S official Chinese benchmark',
        sourceUrl: 'https://github.com/FireRedTeam/FireRedASR2S',
        note: '中文优先刷新数据；同源模型参考，不代表当前 ONNX int8 实测。',
        metrics: [
          { label: 'Mandarin public avg', metric: 'CER', value: 2.89, lowerIsBetter: true, dataset: '4 public Mandarin benchmarks' },
          { label: 'Dialect public avg', metric: 'CER', value: 11.55, lowerIsBetter: true, dataset: '19 Chinese dialect/accent benchmarks' }
        ]
      },
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
    availability: 'installable',
    runtimeVerified: true,
    runtime: 'sherpa-onnx',
    sherpaModelType: 'senseVoice',
    sourceUrl:
      'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09.tar.bz2',
    downloadSources: [
      {
        label: 'GitHub Release',
        url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09.tar.bz2',
        priority: 10
      }
    ],
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
      chineseBenchmark: {
        sourceLabel: 'SenseVoice / sherpa-onnx Chinese coverage',
        sourceUrl: 'https://k2-fsa.github.io/sherpa/onnx/sense-voice/pretrained.html',
        note: '中文优先刷新数据；官方重点说明中文、英文、日文、韩文和粤语覆盖。',
        metrics: [
          { label: '模型体积', metric: 'Rank', value: 240, lowerIsBetter: true, dataset: 'MB' },
          { label: '覆盖语言', metric: 'Rank', value: 5, lowerIsBetter: false, dataset: 'zh/en/ja/ko/yue' },
          { label: '粤语覆盖', metric: 'Rank', value: 1, lowerIsBetter: false, dataset: 'yue support' }
        ]
      },
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
  },
  {
    id: 'cohere-transcribe-03-2026',
    name: 'Cohere Transcribe 03-2026',
    family: 'cohere-transcribe',
    releasedAt: '2026-03-26',
    installable: false,
    availability: 'reference',
    unavailableReason: 'Open ASR Leaderboard 高分模型，但 V2T 当前没有可验证的一键下载包、sherpa-onnx Node 配置和打包 smoke test。',
    manualSetup: '可通过外部 ASR 服务封装为 HTTP endpoint，再在高级设置里接入；V2T 暂不自动安装该模型。',
    runtime: 'external',
    sourceUrl: 'https://huggingface.co/CohereLabs/cohere-transcribe-03-2026',
    license: 'Open',
    sizeMb: 2000,
    languages: ['多语言', '英文优先'],
    qualityTags: ['公开榜单高分', '待接入'],
    hardwareRequirements: { minMemoryGb: 24, recommendedTier: 'high' },
    archiveType: 'file',
    extractedDir: '',
    primaryModelFile: '',
    requiredFiles: [],
    evaluationSources: {
      openAsrLeaderboard: {
        sourceLabel: 'Open ASR Leaderboard scripts/data/en_shortform.csv',
        sourceUrl: 'https://raw.githubusercontent.com/huggingface/open_asr_leaderboard/main/scripts/data/en_shortform.csv',
        track: 'English short-form',
        rank: 1,
        avgWer: 5.42,
        rtfx: 524.88,
        exactModelMatch: true
      },
      localRecommendation: {
        note: '参考榜模型，不计入 V2T 一键安装推荐分。'
      }
    }
  },
  {
    id: 'zoom-scribe-v1',
    name: 'Zoom Scribe v1',
    family: 'zoom-scribe',
    releasedAt: '2026-01-01',
    installable: false,
    availability: 'reference',
    unavailableReason: 'Open ASR Leaderboard 排名很高，但这是专有/外部服务模型，不是可下载的本地开源模型，V2T 无法直接一键安装到本机。',
    manualSetup: '如果后续能通过 Zoom 或第三方服务拿到转写 API，可封装成 HTTP ASR endpoint 后在高级设置接入。',
    runtime: 'external',
    sourceUrl: 'https://raw.githubusercontent.com/huggingface/open_asr_leaderboard/main/scripts/data/en_shortform.csv',
    license: 'Proprietary',
    sizeMb: 0,
    languages: ['英文榜单', '中文能力需服务商确认'],
    qualityTags: ['公开榜单高分', '专有服务', '待接入'],
    hardwareRequirements: { minMemoryGb: 0, recommendedTier: 'low' },
    archiveType: 'file',
    extractedDir: '',
    primaryModelFile: '',
    requiredFiles: [],
    evaluationSources: {
      openAsrLeaderboard: {
        sourceLabel: 'Open ASR Leaderboard scripts/data/en_shortform.csv',
        sourceUrl: 'https://raw.githubusercontent.com/huggingface/open_asr_leaderboard/main/scripts/data/en_shortform.csv',
        track: 'English short-form',
        rank: 2,
        avgWer: 5.47,
        exactModelMatch: true,
        note: '榜单数据来自英文短音频 track；专有服务不代表本地中文/中英混输体验。'
      }
    }
  },
  {
    id: 'ibm-granite-4.0-1b-speech',
    name: 'IBM Granite 4.0 1B Speech',
    family: 'ibm-granite-speech',
    releasedAt: '2026-01-01',
    installable: false,
    availability: 'reference',
    unavailableReason: '榜单表现强，但当前 V2T 没有本地 Node runtime 接入和跨平台一键安装验证。',
    manualSetup: '可先用外部服务方式暴露为 HTTP ASR endpoint，再从高级设置接入。',
    runtime: 'external',
    sourceUrl: 'https://huggingface.co/ibm-granite/granite-4.0-1b-speech',
    license: 'Open',
    sizeMb: 2000,
    languages: ['英文优先'],
    qualityTags: ['公开榜单高分', '待接入'],
    hardwareRequirements: { minMemoryGb: 24, recommendedTier: 'high' },
    archiveType: 'file',
    extractedDir: '',
    primaryModelFile: '',
    requiredFiles: [],
    evaluationSources: {
      openAsrLeaderboard: {
        sourceLabel: 'Open ASR Leaderboard scripts/data/en_shortform.csv',
        sourceUrl: 'https://raw.githubusercontent.com/huggingface/open_asr_leaderboard/main/scripts/data/en_shortform.csv',
        track: 'English short-form',
        rank: 3,
        avgWer: 5.52,
        rtfx: 280.02,
        exactModelMatch: true
      }
    }
  },
  {
    id: 'nvidia-canary-qwen-2.5b',
    name: 'NVIDIA Canary-Qwen 2.5B',
    family: 'nvidia-canary-qwen',
    releasedAt: '2025-12-15',
    installable: false,
    availability: 'reference',
    unavailableReason: '榜单高分，但 V2T 当前没有 NeMo/Canary 本地 Node 转写 adapter 和打包验证。',
    manualSetup: '可用 NeMo/Transformers 自行部署服务后，通过高级 HTTP ASR endpoint 接入。',
    runtime: 'external',
    sourceUrl: 'https://huggingface.co/nvidia/canary-qwen-2.5b',
    license: 'Open',
    sizeMb: 2500,
    languages: ['多语言', '英文优先'],
    qualityTags: ['公开榜单高分', '待接入'],
    hardwareRequirements: { minMemoryGb: 24, recommendedTier: 'high' },
    archiveType: 'file',
    extractedDir: '',
    primaryModelFile: '',
    requiredFiles: [],
    evaluationSources: {
      openAsrLeaderboard: {
        sourceLabel: 'Open ASR Leaderboard scripts/data/en_shortform.csv',
        sourceUrl: 'https://raw.githubusercontent.com/huggingface/open_asr_leaderboard/main/scripts/data/en_shortform.csv',
        track: 'English short-form',
        rank: 4,
        avgWer: 5.63,
        rtfx: 418.28,
        exactModelMatch: true
      }
    }
  },
  {
    id: 'qwen3-asr-1.7b',
    name: 'Qwen3-ASR 1.7B',
    family: 'qwen3-asr',
    releasedAt: '2026-03-01',
    installable: false,
    availability: 'manual',
    unavailableReason: '榜单模型是 HF/PyTorch 版本；V2T 尚未实现 Qwen3-ASR 的 sherpa-onnx recognizer config 和一键 smoke test。',
    manualSetup: 'sherpa-onnx 已提供 Qwen3-ASR 0.6B ONNX 文档；后续接入该 model type 后可升级为一键安装。',
    runtime: 'sherpa-onnx',
    sourceUrl: 'https://huggingface.co/Qwen/Qwen3-ASR-1.7B',
    license: 'Open',
    sizeMb: 1700,
    languages: ['中文', '英文', '粤语', '多语言', '中文方言'],
    qualityTags: ['公开榜单高分', '中文方言', '待接入'],
    hardwareRequirements: { minMemoryGb: 24, recommendedTier: 'high' },
    archiveType: 'file',
    extractedDir: '',
    primaryModelFile: '',
    requiredFiles: [],
    evaluationSources: {
      chineseBenchmark: {
        sourceLabel: 'Qwen3-ASR Chinese and dialect coverage',
        sourceUrl: 'https://k2-fsa.github.io/sherpa/onnx/qwen3-asr/index.html',
        note: 'Qwen3-ASR 覆盖中文、英文、粤语和多种中文方言；V2T 尚未完成一键运行验证。',
        metrics: [
          { label: '中文/英文/粤语覆盖', metric: 'Rank', value: 3, lowerIsBetter: false, dataset: 'language coverage' },
          { label: '中文方言覆盖', metric: 'Rank', value: 1, lowerIsBetter: false, dataset: 'dialect coverage' }
        ]
      },
      openAsrLeaderboard: {
        sourceLabel: 'Open ASR Leaderboard scripts/data/en_shortform.csv',
        sourceUrl: 'https://raw.githubusercontent.com/huggingface/open_asr_leaderboard/main/scripts/data/en_shortform.csv',
        track: 'English short-form',
        rank: 6,
        avgWer: 5.76,
        rtfx: 147.93,
        exactModelMatch: true
      },
      officialBenchmark: {
        sourceLabel: 'sherpa-onnx Qwen3-ASR documentation',
        sourceUrl: 'https://k2-fsa.github.io/sherpa/onnx/qwen3-asr/index.html',
        note: 'sherpa-onnx 文档列出 Qwen3-ASR-0.6B ONNX 预训练模型和多语言/中文方言覆盖；V2T 尚未接入该 recognizer 类型。',
        metrics: []
      }
    }
  },
  {
    id: 'elevenlabs-scribe-v2',
    name: 'ElevenLabs Scribe v2',
    family: 'elevenlabs-scribe',
    releasedAt: '2026-01-01',
    installable: false,
    availability: 'reference',
    unavailableReason: '榜单排名靠前，但这是专有云服务，不是本地开源模型；V2T 第一版不保存/管理第三方 token。',
    manualSetup: '如果你有 ElevenLabs API 或兼容代理，可后续通过 OpenAI/FunASR 类 HTTP adapter 接入；当前不做一键本地安装。',
    runtime: 'external',
    sourceUrl: 'https://raw.githubusercontent.com/huggingface/open_asr_leaderboard/main/scripts/data/en_shortform.csv',
    license: 'Proprietary',
    sizeMb: 0,
    languages: ['英文榜单', '多语言能力需服务商确认'],
    qualityTags: ['公开榜单高分', '专有服务', '待接入'],
    hardwareRequirements: { minMemoryGb: 0, recommendedTier: 'low' },
    archiveType: 'file',
    extractedDir: '',
    primaryModelFile: '',
    requiredFiles: [],
    evaluationSources: {
      openAsrLeaderboard: {
        sourceLabel: 'Open ASR Leaderboard scripts/data/en_shortform.csv',
        sourceUrl: 'https://raw.githubusercontent.com/huggingface/open_asr_leaderboard/main/scripts/data/en_shortform.csv',
        track: 'English short-form',
        rank: 7,
        avgWer: 5.83,
        exactModelMatch: true,
        note: '榜单数据来自英文短音频 track；中文/中英混输需要单独验证。'
      }
    }
  },
  {
    id: 'nvidia-parakeet-tdt-0.6b-v3',
    name: 'NVIDIA Parakeet TDT 0.6B v3',
    family: 'nvidia-parakeet',
    releasedAt: '2025-11-27',
    installable: false,
    availability: 'manual',
    unavailableReason: 'sherpa-onnx 有 NeMo/Parakeet 预训练模型，但 V2T 当前 LocalSherpaAsrProvider 尚未实现 NeMo transducer 配置。',
    manualSetup: '可参考 sherpa-onnx NeMo 文档手动运行；V2T 接入 NeMo model type 后可进入一键安装区。',
    runtime: 'sherpa-onnx',
    sourceUrl: 'https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3',
    license: 'Open',
    sizeMb: 600,
    languages: ['英文', '欧洲多语言'],
    qualityTags: ['公开榜单高分', '速度极快', '待接入'],
    hardwareRequirements: { minMemoryGb: 16, recommendedTier: 'high' },
    archiveType: 'file',
    extractedDir: '',
    primaryModelFile: '',
    requiredFiles: [],
    evaluationSources: {
      openAsrLeaderboard: {
        sourceLabel: 'Open ASR Leaderboard scripts/data/en_shortform.csv',
        sourceUrl: 'https://raw.githubusercontent.com/huggingface/open_asr_leaderboard/main/scripts/data/en_shortform.csv',
        track: 'English short-form',
        rank: 13,
        avgWer: 6.32,
        rtfx: 3332.74,
        exactModelMatch: true
      },
      officialBenchmark: {
        sourceLabel: 'sherpa-onnx NeMo documentation',
        sourceUrl: 'https://k2-fsa.github.io/sherpa/onnx/nemo/index.html',
        note: 'sherpa-onnx 文档已列出 Parakeet TDT 0.6B v3 int8 模型；V2T 还未实现 NeMo transducer adapter。',
        metrics: []
      }
    }
  },
  {
    id: 'qwen3-asr-0.6b',
    name: 'Qwen3-ASR 0.6B',
    family: 'qwen3-asr',
    releasedAt: '2026-03-01',
    installable: false,
    availability: 'manual',
    unavailableReason: 'sherpa-onnx 已有 Qwen3-ASR 0.6B ONNX 文档，但 V2T 还没有实现对应 recognizer config 和安装后 smoke test。',
    manualSetup: '可参考 sherpa-onnx Qwen3-ASR 文档手动运行；完成 V2T adapter 后可进入一键安装区。',
    runtime: 'sherpa-onnx',
    sourceUrl: 'https://k2-fsa.github.io/sherpa/onnx/qwen3-asr/index.html',
    license: 'Open',
    sizeMb: 600,
    languages: ['中文', '英文', '粤语', '多语言', '中文方言'],
    qualityTags: ['公开榜单高分', '中文方言', '中英混输', '待接入'],
    hardwareRequirements: { minMemoryGb: 16, recommendedTier: 'high' },
    archiveType: 'file',
    extractedDir: '',
    primaryModelFile: '',
    requiredFiles: [],
    evaluationSources: {
      chineseBenchmark: {
        sourceLabel: 'Qwen3-ASR sherpa-onnx documentation',
        sourceUrl: 'https://k2-fsa.github.io/sherpa/onnx/qwen3-asr/index.html',
        note: 'Qwen3-ASR 0.6B ONNX 文档说明支持中文、英文、粤语和多种中文方言；V2T 尚未完成一键运行验证。',
        metrics: [
          { label: '中文/英文/粤语覆盖', metric: 'Rank', value: 3, lowerIsBetter: false, dataset: 'language coverage' },
          { label: '中文方言覆盖', metric: 'Rank', value: 1, lowerIsBetter: false, dataset: 'dialect coverage' }
        ]
      },
      openAsrLeaderboard: {
        sourceLabel: 'Open ASR Leaderboard scripts/data/en_shortform.csv',
        sourceUrl: 'https://raw.githubusercontent.com/huggingface/open_asr_leaderboard/main/scripts/data/en_shortform.csv',
        track: 'English short-form',
        rank: 17,
        avgWer: 6.42,
        rtfx: 166.23,
        exactModelMatch: true
      },
      officialBenchmark: {
        sourceLabel: 'sherpa-onnx Qwen3-ASR documentation',
        sourceUrl: 'https://k2-fsa.github.io/sherpa/onnx/qwen3-asr/index.html',
        note: 'sherpa-onnx 文档说明 Qwen3-ASR 支持中文、英文、粤语和多种中文方言。',
        metrics: []
      }
    }
  },
  {
    id: 'google-chirp-2',
    name: 'Google Chirp 2',
    family: 'google-chirp',
    releasedAt: '2026-01-01',
    installable: false,
    availability: 'reference',
    unavailableReason: '榜单排名靠前，但这是专有云服务，不是可下载本地模型，也不属于当前本地 sherpa-onnx runtime。',
    manualSetup: '如果要使用，需要单独接 Google Cloud Speech API 或自建 HTTP adapter；当前 V2T 不在应用内保存云服务密钥。',
    runtime: 'external',
    sourceUrl: 'https://raw.githubusercontent.com/huggingface/open_asr_leaderboard/main/scripts/data/en_shortform.csv',
    license: 'Proprietary',
    sizeMb: 0,
    languages: ['多语言云服务', '中文能力需服务商确认'],
    qualityTags: ['公开榜单高分', '专有服务', '待接入'],
    hardwareRequirements: { minMemoryGb: 0, recommendedTier: 'low' },
    archiveType: 'file',
    extractedDir: '',
    primaryModelFile: '',
    requiredFiles: [],
    evaluationSources: {
      openAsrLeaderboard: {
        sourceLabel: 'Open ASR Leaderboard scripts/data/en_shortform.csv',
        sourceUrl: 'https://raw.githubusercontent.com/huggingface/open_asr_leaderboard/main/scripts/data/en_shortform.csv',
        track: 'English short-form',
        rank: 16,
        avgWer: 6.42,
        exactModelMatch: true,
        note: '榜单数据来自英文短音频 track；云服务中文/中英混输需要单独验证。'
      }
    }
  },
  {
    id: 'zai-glm-asr-nano-2512',
    name: 'GLM-ASR-Nano 2512',
    family: 'glm-asr-nano',
    releasedAt: '2025-12-01',
    installable: false,
    availability: 'reference',
    unavailableReason: 'Open ASR Leaderboard 有记录，但 V2T 当前没有可验证的一键下载包、本地 Node runtime adapter 和安装后 smoke test。',
    manualSetup: '如果上游提供 ONNX/sherpa 或 HTTP 服务，可先通过高级 ASR endpoint 接入；完成 adapter 后再进入一键安装区。',
    runtime: 'external',
    sourceUrl: 'https://raw.githubusercontent.com/huggingface/open_asr_leaderboard/main/scripts/data/en_shortform.csv',
    license: 'Open',
    sizeMb: 2000,
    languages: ['中文候选', '英文榜单'],
    qualityTags: ['公开榜单高分', '中文候选', '待接入'],
    hardwareRequirements: { minMemoryGb: 16, recommendedTier: 'high' },
    archiveType: 'file',
    extractedDir: '',
    primaryModelFile: '',
    requiredFiles: [],
    evaluationSources: {
      openAsrLeaderboard: {
        sourceLabel: 'Open ASR Leaderboard scripts/data/en_shortform.csv',
        sourceUrl: 'https://raw.githubusercontent.com/huggingface/open_asr_leaderboard/main/scripts/data/en_shortform.csv',
        track: 'English short-form',
        rank: 26,
        avgWer: 7.03,
        rtfx: 145.28,
        exactModelMatch: true
      }
    }
  },
  {
    id: 'openai-whisper-large-v3',
    name: 'Whisper large-v3',
    family: 'whisper',
    releasedAt: '2024-08-12',
    installable: false,
    availability: 'reference',
    unavailableReason: 'V2T 当前 whisper-cpp provider 仍是占位实现，尚未完成一键下载、量化包选择和打包 smoke test。',
    manualSetup: '可先自行运行 whisper.cpp 或兼容 HTTP 服务，再通过高级 HTTP ASR endpoint 接入。',
    runtime: 'whisper-cpp',
    sourceUrl: 'https://huggingface.co/openai/whisper-large-v3',
    license: 'Open',
    sizeMb: 2000,
    languages: ['多语言'],
    qualityTags: ['生态成熟', '待接入'],
    hardwareRequirements: { minMemoryGb: 16, recommendedTier: 'high' },
    archiveType: 'file',
    extractedDir: '',
    primaryModelFile: '',
    requiredFiles: [],
    evaluationSources: {
      openAsrLeaderboard: {
        sourceLabel: 'Open ASR Leaderboard scripts/data/en_shortform.csv',
        sourceUrl: 'https://raw.githubusercontent.com/huggingface/open_asr_leaderboard/main/scripts/data/en_shortform.csv',
        track: 'English short-form',
        rank: 37,
        avgWer: 7.44,
        rtfx: 145.51,
        exactModelMatch: true
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

export function referenceModels(catalog: ModelCatalogItem[]): ModelCatalogItem[] {
  return catalog
    .filter((model) => (model.availability ?? (model.installable ? 'installable' : 'reference')) !== 'installable')
    .sort((left, right) => {
      const chineseDelta = scoreChineseReference(right) - scoreChineseReference(left);
      if (chineseDelta !== 0) {
        return chineseDelta;
      }
      return (left.evaluationSources?.openAsrLeaderboard?.rank ?? 9999) - (right.evaluationSources?.openAsrLeaderboard?.rank ?? 9999);
    });
}

function latestInstallableByFamily(catalog: ModelCatalogItem[]): ModelCatalogItem[] {
  const latest = new Map<string, ModelCatalogItem>();
  for (const model of catalog) {
    if (!isOneClickInstallable(model)) {
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
    scoreMandarinFit(model),
    scoreDialectFit(model),
    scoreCodeSwitchFit(model),
    scoreEnglishReferenceFit(model),
    scoreRuntimeFit(model, hardware),
    scoreHardwareFit(model, hardware),
    scoreSize(model, hardware)
  ];

  rawScore += scoreBreakdown.reduce((sum, item) => sum + item.value, 0);

  if (model.qualityTags.includes('中文优先')) {
    reasons.push('中文识别优先');
  }

  if (model.qualityTags.includes('方言增强')) {
    reasons.push('方言支持更强');
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

export function isOneClickInstallable(model: ModelCatalogItem): boolean {
  if (!model.installable || (model.availability ?? 'installable') !== 'installable') {
    return false;
  }
  if (model.runtimeVerified === false) {
    return false;
  }
  if (model.runtime === 'sherpa-onnx' && !model.sherpaModelType) {
    return false;
  }
  return model.requiredFiles.length > 0 && Boolean(model.sourceUrl);
}

function scoreMandarinFit(model: ModelCatalogItem) {
  const best = bestMetricValue(model, (metric) => /mandarin|aishell|fleurs-zh|wenetspeech|普通话|中文/i.test(metric.label));
  let value = model.languages.includes('中文') ? 8 : 0;
  value += model.qualityTags.includes('中文优先') ? 5 : 0;
  value += metricScore(best, 13, 5);
  return { label: '普通话', value: Math.round(value), reason: best ? `公开中文指标 ${best.value}% ${best.metric}` : '按中文覆盖和模型说明估算' };
}

function scoreDialectFit(model: ModelCatalogItem) {
  const best = bestMetricValue(model, (metric) => /dialect|方言|粤语|cantonese|yue/i.test(metric.label));
  let value = model.languages.some((language) => /方言|粤语|yue/i.test(language)) ? 6 : 0;
  value += model.qualityTags.includes('方言增强') ? 5 : 0;
  value += model.qualityTags.includes('粤语增强') ? 4 : 0;
  value += metricScore(best, 9, 3);
  return { label: '方言/粤语', value: Math.round(value), reason: best ? `方言/粤语指标 ${best.value}% ${best.metric}` : '按方言/粤语覆盖估算' };
}

function scoreCodeSwitchFit(model: ModelCatalogItem) {
  const hasChinese = model.languages.includes('中文') || model.languages.some((language) => language.includes('中文'));
  const hasEnglish = model.languages.includes('英文') || model.languages.some((language) => language.includes('English'));
  let value = hasChinese && hasEnglish ? 10 : hasChinese ? 6 : 0;
  if (model.qualityTags.includes('中英混输') || model.name.toLowerCase().includes('zh_en')) {
    value += 6;
  }
  if (model.languages.includes('多语言')) {
    value += 2;
  }
  return { label: '中英混输', value, reason: hasChinese && hasEnglish ? '覆盖中文和英文' : '语言覆盖有限' };
}

function scoreEnglishReferenceFit(model: ModelCatalogItem) {
  const rank = model.evaluationSources?.openAsrLeaderboard?.rank;
  if (!model.evaluationSources?.openAsrLeaderboard?.exactModelMatch || !rank) {
    return { label: '英文参考', value: 0, reason: '无 exact Open ASR 英文榜匹配' };
  }
  const value = Math.max(0, Math.round(55 - rank * 1.6));
  return { label: '英文参考', value, reason: `Open ASR 英文短音频 Rank ${rank}` };
}

function scoreRuntimeFit(model: ModelCatalogItem, hardware: HardwareProfile) {
  let value = model.runtime === 'sherpa-onnx' ? 10 : 4;
  if (model.runtimeVerified) {
    value += 4;
  }
  if (hardware.platform === 'darwin' && hardware.arch === 'arm64' && model.runtime === 'sherpa-onnx') {
    value += 2;
  }
  return { label: '本机运行', value, reason: model.runtimeVerified ? 'V2T 已验证一键运行链路' : '本地 runtime 待验证' };
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

function bestMetricValue(model: ModelCatalogItem, predicate: (metric: { label: string }) => boolean) {
  const metrics = [
    ...(model.evaluationSources?.chineseBenchmark?.metrics ?? []),
    ...(model.evaluationSources?.officialBenchmark?.metrics ?? [])
  ].filter((metric) => (metric.metric === 'CER' || metric.metric === 'WER') && predicate(metric));
  return metrics.sort((left, right) => left.value - right.value)[0];
}

function metricScore(metric: ReturnType<typeof bestMetricValue>, maxScore: number, fallbackScore: number): number {
  if (!metric) {
    return fallbackScore;
  }
  if (metric.value <= 3) {
    return maxScore;
  }
  if (metric.value <= 6) {
    return maxScore - 3;
  }
  if (metric.value <= 12) {
    return maxScore - 4;
  }
  if (metric.value <= 25) {
    return Math.max(4, maxScore - 11);
  }
  return Math.max(0, maxScore - 14);
}

function scoreChineseReference(model: ModelCatalogItem): number {
  let score = 0;
  if (model.languages.some((language) => /中文|粤语|方言/i.test(language))) {
    score += 40;
  }
  if (model.qualityTags.some((tag) => /中文|方言|粤语|中英/i.test(tag))) {
    score += 35;
  }
  if (model.evaluationSources?.chineseBenchmark) {
    score += 30;
  }
  if (model.runtime === 'sherpa-onnx') {
    score += 10;
  }
  if (model.availability === 'manual') {
    score += 8;
  }
  const rank = model.evaluationSources?.openAsrLeaderboard?.rank;
  if (rank) {
    score += Math.max(0, 12 - rank / 4);
  }
  return score;
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}
