import { ModelManager } from '../core/modelManager';
import type { ModelCatalogItem } from '../core/types';
import { UserDataStore } from '../core/userDataStore';

interface BenchmarkWorkerRequest {
  modelId: string;
  modelRoot: string;
  dataDir: string;
  deviceId: string;
  catalog: ModelCatalogItem[];
}

process.on('message', (message) => {
  void runBenchmark(message as BenchmarkWorkerRequest);
});

async function runBenchmark(request: BenchmarkWorkerRequest): Promise<void> {
  try {
    const store = await UserDataStore.create(request.dataDir, { deviceId: request.deviceId });
    const manager = new ModelManager({
      modelRoot: request.modelRoot,
      store,
      catalog: request.catalog
    });
    const result = await manager.benchmarkInstalledModel(request.modelId);
    process.send?.(result);
  } catch (error) {
    process.send?.({
      modelId: request.modelId,
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
  } finally {
    setTimeout(() => process.exit(0), 10).unref();
  }
}
