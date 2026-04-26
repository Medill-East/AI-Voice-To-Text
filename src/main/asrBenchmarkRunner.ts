import { fork, type ChildProcess } from 'node:child_process';
import type { ModelBenchmarkResult, ModelCatalogItem } from '../core/types';

interface BenchmarkWorkerRequest {
  modelId: string;
  modelRoot: string;
  dataDir: string;
  deviceId: string;
  catalog: ModelCatalogItem[];
}

interface AsrBenchmarkRunnerOptions {
  workerPath: string;
  modelRoot: string;
  dataDir: string;
  deviceId: string;
  catalog: ModelCatalogItem[];
  timeoutMs?: number;
  forkProcess?: typeof fork;
}

export class AsrBenchmarkRunner {
  private readonly options: AsrBenchmarkRunnerOptions;
  private activeChild: ChildProcess | undefined;

  constructor(options: AsrBenchmarkRunnerOptions) {
    this.options = options;
  }

  runModel(modelId: string): Promise<ModelBenchmarkResult> {
    const forkProcess = this.options.forkProcess ?? fork;
    const child = forkProcess(this.options.workerPath, [], {
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1'
      },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc']
    });
    this.activeChild = child;

    const request: BenchmarkWorkerRequest = {
      modelId,
      modelRoot: this.options.modelRoot,
      dataDir: this.options.dataDir,
      deviceId: this.options.deviceId,
      catalog: this.options.catalog
    };

    return new Promise((resolve) => {
      let settled = false;
      let stderr = '';
      const timeout = setTimeout(() => {
        finish({
          modelId,
          ok: false,
          error: `输出测速超时：${Math.round((this.options.timeoutMs ?? 120_000) / 1000)} 秒内没有完成。`
        });
        child.kill();
      }, this.options.timeoutMs ?? 120_000);

      const finish = (result: ModelBenchmarkResult) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        if (this.activeChild === child) {
          this.activeChild = undefined;
        }
        resolve(result);
      };

      child.stderr?.on('data', (chunk) => {
        stderr += String(chunk);
      });
      child.stdout?.on('data', (chunk) => {
        stderr += String(chunk);
      });
      child.on('message', (message) => {
        const result = message as Partial<ModelBenchmarkResult>;
        if (result && result.modelId === modelId && typeof result.ok === 'boolean') {
          finish(result as ModelBenchmarkResult);
        }
      });
      child.on('error', (error) => {
        finish({ modelId, ok: false, error: `输出测速 worker 启动失败：${error.message}` });
      });
      child.on('exit', (code, signal) => {
        if (!settled) {
          const detail = stderr.trim() || `exit=${code ?? 'none'} signal=${signal ?? 'none'}`;
          finish({ modelId, ok: false, error: `输出测速 worker 异常退出：${detail}` });
        }
      });

      child.send?.(request);
    });
  }

  cancel(): void {
    this.activeChild?.kill();
  }
}
