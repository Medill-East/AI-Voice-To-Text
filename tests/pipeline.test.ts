import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createVoiceInputPipeline } from '../src/core/pipeline';
import { UserDataStore } from '../src/core/userDataStore';

describe('voice input pipeline', () => {
  it('transcribes, post-processes, injects, and stores a text-only history record', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'v2t-pipeline-'));
    const store = await UserDataStore.create(dir, { deviceId: 'device-a' });
    await store.saveLexicon({
      version: 1,
      terms: [{ phrase: 'V2T', aliases: ['v to t'] }],
      replacements: [],
      blocked: []
    });

    const pipeline = createVoiceInputPipeline({
      store,
      asr: { transcribe: vi.fn().mockResolvedValue({ text: '记录 v to t 的目标' }) },
      injector: { injectText: vi.fn().mockResolvedValue({ method: 'cursor' }) },
      now: () => new Date('2026-04-25T11:00:00.000Z'),
      idFactory: () => 'history-1'
    });

    const result = await pipeline.handleAudio(Buffer.from('fake audio'), {
      mode: 'natural',
      targetApp: 'Obsidian'
    });

    expect(result.outputText).toBe('记录 V2T 的目标');
    expect(result.injection.method).toBe('cursor');
    expect(result.postProcessorEngine).toBe('local-rules');

    const entries = await store.readHistoryMonth('device-a', '2026-04');
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      id: 'history-1',
      mode: 'natural',
      rawText: '记录 v to t 的目标',
      outputText: '记录 V2T 的目标',
      targetApp: 'Obsidian',
      injectionMethod: 'cursor',
      postProcessorEngine: 'local-rules'
    });
    expect(JSON.stringify(entries[0])).not.toContain('audio');
  });

  it('skips injection and history when no effective text is detected', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'v2t-pipeline-'));
    const store = await UserDataStore.create(dir, { deviceId: 'device-a' });
    const injector = { injectText: vi.fn().mockResolvedValue({ method: 'cursor' }) };
    const pipeline = createVoiceInputPipeline({
      store,
      asr: { transcribe: vi.fn().mockResolvedValue({ text: '，。  ' }) },
      injector,
      now: () => new Date('2026-04-25T11:00:00.000Z'),
      idFactory: () => 'empty-1'
    });

    await expect(pipeline.handleAudio(Buffer.from('fake audio'), { mode: 'natural' })).rejects.toThrow('未检测到有效语音输入');
    expect(injector.injectText).not.toHaveBeenCalled();
    await expect(store.readHistoryMonth('device-a', '2026-04')).resolves.toEqual([]);
  });

  it('passes the mode prompt into post-processing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'v2t-pipeline-'));
    const store = await UserDataStore.create(dir, { deviceId: 'device-a' });
    const process = vi.fn().mockResolvedValue({ text: '整理后文本', usedLlm: true, engine: 'llm-local' });
    const pipeline = createVoiceInputPipeline({
      store,
      asr: { transcribe: vi.fn().mockResolvedValue({ text: '原文' }) },
      injector: { injectText: vi.fn().mockResolvedValue({ method: 'clipboard' }) },
      postProcessor: { process },
      now: () => new Date('2026-04-25T11:00:00.000Z'),
      idFactory: () => 'prompt-1'
    });

    const result = await pipeline.handleAudio(Buffer.from('fake audio'), {
      mode: 'structured',
      prompt: '自定义结构输入 Prompt'
    });

    expect(process).toHaveBeenCalledWith('原文', expect.objectContaining({ mode: 'structured', prompt: '自定义结构输入 Prompt' }));
    expect(result.postProcessorEngine).toBe('llm-local');
  });
});
