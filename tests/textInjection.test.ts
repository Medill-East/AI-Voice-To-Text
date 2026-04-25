import { describe, expect, it, vi } from 'vitest';
import { TextInjectionService } from '../src/core/textInjection';

describe('TextInjectionService', () => {
  it('writes text to clipboard before sending paste to the focused app', async () => {
    const clipboard = { writeText: vi.fn() };
    const keySender = { paste: vi.fn().mockResolvedValue(undefined) };
    const service = new TextInjectionService({ clipboard, keySender });

    const result = await service.injectText('hello');

    expect(clipboard.writeText).toHaveBeenCalledWith('hello');
    expect(keySender.paste).toHaveBeenCalled();
    expect(result).toEqual({ method: 'cursor' });
  });

  it('falls back to clipboard when paste injection fails', async () => {
    const clipboard = { writeText: vi.fn() };
    const keySender = { paste: vi.fn().mockRejectedValue(new Error('accessibility denied')) };
    const service = new TextInjectionService({ clipboard, keySender });

    const result = await service.injectText('hello');

    expect(clipboard.writeText).toHaveBeenCalledWith('hello');
    expect(result.method).toBe('clipboard');
    expect(result.error).toContain('accessibility denied');
  });
});
