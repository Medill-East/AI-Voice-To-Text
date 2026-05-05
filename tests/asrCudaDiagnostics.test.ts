import { describe, expect, it } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Settings } from '../src/core/types';
import { detectAsrCudaStatus } from '../src/main/asrCudaDiagnostics';

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

describe('ASR CUDA diagnostics', () => {
  it('keeps CUDA unavailable on non-Windows platforms', () => {
    const status = detectAsrCudaStatus(baseSettings(), { platform: 'darwin' });

    expect(status.backendStatus).toBe('cuda-experimental-unavailable');
    expect(status.canEnable).toBe(false);
    expect(status.recommendedAction).toContain('CPU');
  });

  it('reports missing sherpa CUDA runtime even when NVIDIA is present', () => {
    const spawn = () => ({
      status: 0,
      stdout: 'NVIDIA RTX 4090, 560.10\n',
      stderr: ''
    });
    const status = detectAsrCudaStatus(baseSettings(), {
      platform: 'win32',
      spawn: spawn as never,
      env: {
        PATH: '',
        CUDA_PATH: 'C:\\missing'
      }
    });

    expect(status.nvidiaGpuDetected).toBe(true);
    expect(status.canEnable).toBe(false);
    expect(status.diagnostic).toContain('sherpa-onnx CUDA runtime');
  });

  it('can mark CUDA available when GPU, CUDA files, and runtime are present', async () => {
    const settings = baseSettings();
    const spawn = () => ({
      status: 0,
      stdout: 'NVIDIA RTX 4090, 560.10\n',
      stderr: ''
    });
    const cudaDir = await mkdtemp(join(tmpdir(), 'v2t-cuda-'));
    await writeFile(join(cudaDir, 'cudart64_12.dll'), '');
    const status = detectAsrCudaStatus(settings, {
      platform: 'win32',
      spawn: spawn as never,
      env: { PATH: cudaDir },
      sherpaCudaRuntimeAvailable: true
    });

    expect(status.canEnable).toBe(true);
    expect(status.backendStatus).toBe('cuda-experimental-available');
  });

  it('keeps CUDA unavailable when runtime files exist but smoke test has not passed', async () => {
    const spawn = () => ({
      status: 0,
      stdout: 'NVIDIA RTX 4090, 560.10\n',
      stderr: ''
    });
    const cudaDir = await mkdtemp(join(tmpdir(), 'v2t-cuda-'));
    await writeFile(join(cudaDir, 'cudart64_12.dll'), '');
    const status = detectAsrCudaStatus(baseSettings(), {
      platform: 'win32',
      spawn: spawn as never,
      env: { PATH: cudaDir },
      runtimeStatus: {
        installStatus: 'installed-unverified',
        runtimeRoot: 'C:\\Users\\test\\AppData\\Roaming\\V2T\\runtimes\\sherpa-onnx-cuda',
        runtimePath: 'C:\\Users\\test\\AppData\\Roaming\\V2T\\runtimes\\sherpa-onnx-cuda\\runtime',
        hasRuntimeFiles: true,
        missingFiles: [],
        smokeTestPassed: false,
        canInstall: true,
        canCancel: false,
        canClear: true,
        canSmokeTest: true
      }
    });

    expect(status.canEnable).toBe(false);
    expect(status.diagnostic).toContain('尚未通过 smoke test');
    expect(status.recommendedAction).toContain('smoke test');
  });
});
