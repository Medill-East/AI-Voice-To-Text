import type { LlmInstallerTarget, LlmProviderDetection, LlmProviderKind } from './types';
import { detectLocalLlmProviders } from './llmDiscovery';

export const LLM_INSTALLER_URLS = {
  ollama: {
    downloadUrl: 'https://ollama.com/download',
    docsUrl: 'https://docs.ollama.com/windows'
  },
  'lm-studio': {
    downloadUrl: 'https://lmstudio.ai/download',
    docsUrl: 'https://lmstudio.ai/docs/developer/core/server'
  }
} as const;

export async function getLlmInstallerTargets(options: {
  fetchImpl?: typeof fetch;
  detections?: LlmProviderDetection[];
} = {}): Promise<LlmInstallerTarget[]> {
  const detections = options.detections ?? (await detectLocalLlmProviders({ fetchImpl: options.fetchImpl }));
  return [toInstallerTarget('ollama', detections), toInstallerTarget('lm-studio', detections)];
}

export function officialLlmInstallerUrl(kind: LlmProviderKind): string | undefined {
  if (kind === 'ollama' || kind === 'lm-studio') {
    return LLM_INSTALLER_URLS[kind].downloadUrl;
  }
  return undefined;
}

function toInstallerTarget(kind: Exclude<LlmProviderKind, 'openai-compatible'>, detections: LlmProviderDetection[]): LlmInstallerTarget {
  const detection = detections.find((item) => item.kind === kind);
  const urls = LLM_INSTALLER_URLS[kind];
  const label = kind === 'ollama' ? 'Ollama' : 'LM Studio';
  const baseUrl = kind === 'ollama' ? 'http://127.0.0.1:11434/v1' : 'http://127.0.0.1:1234/v1';
  const serviceHint =
    kind === 'ollama'
      ? '安装后打开 Ollama；如果本地服务没有启动，可运行 ollama serve 后重新检测。'
      : '安装后打开 LM Studio，在 Developer / Local Server 中启动服务，或使用 lms server start 后重新检测。';

  if (detection?.ok) {
    return {
      kind,
      label,
      status: 'service-available',
      baseUrl: detection.baseUrl,
      downloadUrl: urls.downloadUrl,
      docsUrl: urls.docsUrl,
      installActionLabel: '打开官方下载',
      serviceHint,
      models: detection.models
    };
  }

  return {
    kind,
    label,
    status: detection ? 'installed-not-running' : 'not-installed',
    baseUrl,
    downloadUrl: urls.downloadUrl,
    docsUrl: urls.docsUrl,
    installActionLabel: '打开官方下载',
    serviceHint,
    models: [],
    error: detection?.error
  };
}
