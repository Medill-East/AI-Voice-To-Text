import type { CloudLlmModelView, CloudLlmSortKey } from './types';

export type CloudLlmSortDirection = 'asc' | 'desc';

export function sortCloudLlmModels(
  models: CloudLlmModelView[],
  sortKey: CloudLlmSortKey,
  direction: CloudLlmSortDirection = 'desc'
): CloudLlmModelView[] {
  const sorted = [...models];
  if (sortKey === 'name') {
    return sorted.sort((left, right) => left.name.localeCompare(right.name));
  }
  if (sortKey === 'releasedAt') {
    return sorted.sort((left, right) => directionMultiplier(direction) * ((Date.parse(left.createdAt ?? '') || 0) - (Date.parse(right.createdAt ?? '') || 0)));
  }
  if (sortKey === 'price') {
    return sorted.sort((left, right) => totalPrice(left) - totalPrice(right) || right.recommendationScore - left.recommendationScore);
  }
  if (sortKey === 'performance') {
    return sorted.sort((left, right) => right.performanceScore - left.performanceScore || right.recommendationScore - left.recommendationScore);
  }
  return sorted.sort((left, right) => right.recommendationScore - left.recommendationScore || right.performanceScore - left.performanceScore);
}

export function cloudLlmTags(model: CloudLlmModelView, now = Date.now()): string[] {
  const tags = new Set<string>();
  const searchable = `${model.id} ${model.name} ${model.description ?? ''} ${model.note ?? ''}`.toLowerCase();
  const price = totalPrice(model);

  if (model.isFree) tags.add('免费');
  if (model.recommended) tags.add('推荐');
  if (/(qwen|deepseek|glm|doubao|moonshot|yi-|chinese|中文|通义|千问|豆包|智谱)/i.test(searchable)) tags.add('中文友好');
  if (!/(reasoning|thinking|r1|思考|推理)/i.test(searchable)) tags.add('低推理风险');
  if ((model.contextLength ?? 0) >= 32000) tags.add('长上下文');
  if (model.isFree || price <= 0.5) tags.add('低价');
  if (isRecent(model.createdAt, now)) tags.add('新模型');
  if (model.performanceScore >= 70 || model.recommendationScore >= 70) tags.add('适合整理');

  return [...tags].slice(0, 7);
}

function totalPrice(model: CloudLlmModelView): number {
  return (model.promptPrice ?? Number.MAX_SAFE_INTEGER / 2) + (model.completionPrice ?? Number.MAX_SAFE_INTEGER / 2);
}

function directionMultiplier(direction: CloudLlmSortDirection): number {
  return direction === 'asc' ? 1 : -1;
}

function isRecent(createdAt: string | undefined, now: number): boolean {
  const timestamp = Date.parse(createdAt ?? '');
  if (!timestamp) {
    return false;
  }
  return now - timestamp <= 180 * 24 * 60 * 60 * 1000;
}
