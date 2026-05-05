import { EventEmitter } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import type { ChildProcess } from 'node:child_process';
import { AsrCudaRuntimeManager, BUILTIN_CUDA_RUNTIME_CATALOG } from '../src/main/asrCudaRuntimeManager';
import type { Settings } from '../src/core/types';

function baseSettings(): Settings {
  return {
    schemaVersion: 1,
    defaultMode: 'natural',
    appearance: { theme: 'system' },
    recording: { muteSystemAudio: false, maxDurationMinutes: 10 },
    hotkey: {
      accelerator: 'CommandOrControl+Shift+Space',
      longPressMs: 350,
      singleClickMode: 'natural',
      doubleClickMode: 'structured'
    },
    startup: { openAtLogin: false, silentOpenAtLogin: true },
    providers: {
      asr: {
        kind: 'local-sherpa-onnx',
        language: 'zh',
        runtime: { provider: 'cpu', numThreads: 'auto', cudaExperimental: false },
        cloud: {
          provider: 'openai',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-4o-mini-transcribe',
          apiKeyRef: 'system-keychain:v2t/cloud-asr',
          timeoutMs: 60000
        }
      },
      llm: {
        engine: 'off',
        enabled: false,
        kind: 'openai-compatible',
        baseUrl: '',
        model: '',
        apiKeyRef: 'system-keychain:v2t/openai-compatible',
        fastMode: true,
        timeoutMs: 30000,
        fallback: {
          enabled: false,
          baseUrl: '',
          model: '',
          apiKeyRef: 'system-keychain:v2t/llm-fallback',
          timeoutMs: 30000
        }
      }
    },
    sync: { kind: 'local-folder', github: { branch: 'main' } },
    updates: { autoCheck: true, autoDownload: false }
  };
}

describe('AsrCudaRuntimeManager', () => {
  it('does not offer CUDA runtime installation outside Windows x64', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'v2t-cuda-runtime-'));
    const manager = new AsrCudaRuntimeManager({ userDataDir, platform: 'darwin', arch: 'arm64' });

    const status = await manager.getStatus(baseSettings());

    expect(status.canInstall).toBe(false);
    expect(status.installStatus).toBe('not-installed');
  });

  it('marks installed runtime as ready only after smoke test passes', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'v2t-cuda-runtime-'));
    const item = BUILTIN_CUDA_RUNTIME_CATALOG[0];
    const runtimePath = join(userDataDir, 'runtimes', 'sherpa-onnx-cuda', item.id);
    await mkdir(runtimePath, { recursive: true });
    for (const file of item.requiredFiles) {
      await writeFile(join(runtimePath, file), '');
    }

    const manager = new AsrCudaRuntimeManager({
      userDataDir,
      platform: 'win32',
      arch: 'x64',
      spawnProcess: fakeSuccessfulSpawn as never
    });

    expect((await manager.getStatus(baseSettings())).installStatus).toBe('installed-unverified');
    const status = await manager.runSmokeTest();

    expect(status.installStatus).toBe('ready');
    expect(status.smokeTestPassed).toBe(true);
  });

  it('exposes CUDA runtime download URL and local archive path for manual download diagnostics', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'v2t-cuda-runtime-'));
    const item = BUILTIN_CUDA_RUNTIME_CATALOG[0];
    const manager = new AsrCudaRuntimeManager({ userDataDir, platform: 'win32', arch: 'x64' });

    const status = await manager.getStatus(baseSettings());

    expect(status.downloadUrl).toBe(item.sourceUrl);
    expect(status.downloadSourceLabel).toBe(item.sourceLabel);
    expect(status.archivePath).toBe(join(userDataDir, 'runtimes', 'sherpa-onnx-cuda', '.download', `${item.id}.tar.bz2`));
    expect(status.expectedRuntimePath).toBe(join(userDataDir, 'runtimes', 'sherpa-onnx-cuda', item.id));
  });
});

function fakeSuccessfulSpawn(): ChildProcess {
  const child = new EventEmitter() as ChildProcess;
  child.stdout = new EventEmitter() as ChildProcess['stdout'];
  child.stderr = new EventEmitter() as ChildProcess['stderr'];
  child.kill = (() => true) as ChildProcess['kill'];
  queueMicrotask(() => {
    child.stdout?.emit('data', 'Usage: sherpa-onnx-offline');
    child.emit('exit', 0, null);
  });
  return child;
}
