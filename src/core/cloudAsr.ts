import type { CloudAsrProviderKind, CloudAsrSettings } from './types';

export function cloudAsrProviderLabel(provider: CloudAsrProviderKind): string {
  if (provider === 'openai') {
    return 'OpenAI';
  }
  if (provider === 'groq') {
    return 'Groq 免费层';
  }
  if (provider === 'doubao') {
    return '豆包/火山';
  }
  return '自定义 HTTP';
}

export function cloudAsrUsageLabel(cloud: Pick<CloudAsrSettings, 'provider' | 'model'>): string {
  return `云端 ASR · ${cloudAsrProviderLabel(cloud.provider)} · ${cloud.model || '未选择模型'}`;
}
