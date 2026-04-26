import type { CloudLlmModelView, CloudLlmSortKey } from './types';

export function sortCloudLlmModels(models: CloudLlmModelView[], sortKey: CloudLlmSortKey): CloudLlmModelView[] {
  const sorted = [...models];
  if (sortKey === 'name') {
    return sorted.sort((left, right) => left.name.localeCompare(right.name));
  }
  if (sortKey === 'releasedAt') {
    return sorted.sort((left, right) => (Date.parse(right.createdAt ?? '') || 0) - (Date.parse(left.createdAt ?? '') || 0));
  }
  if (sortKey === 'price') {
    return sorted.sort((left, right) => totalPrice(left) - totalPrice(right) || right.recommendationScore - left.recommendationScore);
  }
  if (sortKey === 'performance') {
    return sorted.sort((left, right) => right.performanceScore - left.performanceScore || right.recommendationScore - left.recommendationScore);
  }
  return sorted.sort((left, right) => right.recommendationScore - left.recommendationScore || right.performanceScore - left.performanceScore);
}

function totalPrice(model: CloudLlmModelView): number {
  return (model.promptPrice ?? Number.MAX_SAFE_INTEGER / 2) + (model.completionPrice ?? Number.MAX_SAFE_INTEGER / 2);
}
