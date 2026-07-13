import { describe, expect, it } from 'vitest';
import { cloudAsrProviderLabel, cloudAsrUsageLabel } from '../src/core/cloudAsr';

describe('cloud ASR labels', () => {
  it('identifies Groq separately from custom HTTP providers', () => {
    expect(cloudAsrProviderLabel('groq')).toBe('Groq 免费层');
    expect(cloudAsrUsageLabel({ provider: 'groq', model: 'whisper-large-v3-turbo' })).toBe(
      '云端 ASR · Groq 免费层 · whisper-large-v3-turbo'
    );
  });
});
