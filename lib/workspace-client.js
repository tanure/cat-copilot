import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const bridge = fileURLToPath(new URL('./workspace-bridge.js', import.meta.url));

/** Private pipes, a fixed script, and fixed argv replace any shell/HTTP execution API. */
export async function createWorkspaceClient(selector, options = {}) {
  if (!selector) throw new Error('Select a workspace by name or UUID, or set CATPILOT_WORKSPACE.');
  const node = options.node || process.env.CATPILOT_NODE || 'node';
  if (node !== 'node' && !path.isAbsolute(node)) throw new Error('CATPILOT_NODE must be an absolute installed Node executable path.');
  const env = { ...process.env, ...(options.home ? { CATPILOT_HOME: options.home } : {}) };
  delete env.NODE_OPTIONS;
  delete env.ELECTRON_RUN_AS_NODE;
  const invoke = (pinned, request) => new Promise((resolve, reject) => {
    let payload;
    try {
      payload = JSON.stringify(request);
      if (!payload || Buffer.byteLength(payload) > 8_000_000) throw new Error('Bridge request exceeds 8 MB.');
    } catch (error) { reject(error); return; }
    const child = execFile(node, [bridge, '--workspace', pinned], {
      env, windowsHide: true, timeout: 30_000, maxBuffer: 64_000_000,
    }, (failure, stdout, stderr) => {
      let response;
      try { response = JSON.parse(stdout); }
      catch {
        reject(new Error(`Workspace bridge failed. Install CatPilot and Node >=22.13 for SQLite; set CATPILOT_NODE if needed. ${failure?.message || stderr.slice(0, 1000)}`));
        return;
      }
      if (!response.ok || failure) {
        const error = new Error(response.error || failure.message);
        error.name = response.name || 'Error';
        reject(error);
      } else resolve(response.result);
    });
    child.stdin.on('error', () => { /* The execFile callback reports early process failure. */ });
    child.stdin.end(payload);
  });
  const workspace = Object.freeze(await invoke(selector, { action: 'describe' }));
  return Object.freeze({
    workspace,
    request: request => invoke(workspace.id, request),
  });
}
