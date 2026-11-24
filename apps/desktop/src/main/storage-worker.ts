import { parentPort, workerData } from 'node:worker_threads';
import { WorkspaceService } from '../../../../dist/core/index.js';

const service = new WorkspaceService(workerData.home);
let queue = Promise.resolve();
parentPort!.on('message', ({ id, request }) => {
  queue = queue.then(async () => {
    try { parentPort!.postMessage({ id, ok: true, value: await service.execute(request) }); }
    catch (error) { parentPort!.postMessage({ id, ok: false, error: error instanceof Error ? error.message : String(error) }); }
  });
});
