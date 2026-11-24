#!/usr/bin/env node
import { workspaceCore } from './workspaces.js';

try {
  const [flag, selector, ...extra] = process.argv.slice(2);
  if (flag !== '--workspace' || !selector || extra.length) throw new Error('Bridge requires one pinned workspace selector.');
  const chunks = [];
  let length = 0;
  for await (const chunk of process.stdin) {
    length += chunk.length;
    if (length > 8_000_000) throw new Error('Bridge request exceeds 8 MB.');
    chunks.push(chunk);
  }
  const request = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!request || typeof request !== 'object' || Array.isArray(request)) throw new Error('Expected a request object.');
  if ('workspaceId' in request || 'workspace' in request) throw new Error('Workspace context is pinned; retargeting is not allowed.');
  const { isDocument, WorkspaceRegistry, WorkspaceService } = await workspaceCore();
  const workspace = await new WorkspaceRegistry().get(selector);
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (workspace.backend === 'sqlite' && (major < 22 || (major === 22 && minor < 13))) {
    throw new Error('SQLite workspace bridge requires installed Node >=22.13. Set CATPILOT_NODE to its absolute executable path. Legacy Markdown remains available on Node 18.');
  }
  let result;
  if (request.action === 'describe') {
    const { id, name, backend, created } = workspace;
    result = { id, name, backend, created };
  } else {
    if (!['snapshot', 'put', 'remove', 'management'].includes(request.action)) throw new Error('Unsupported bridge action. Only snapshot, put, remove and management are allowed.');
    result = await new WorkspaceService().execute({ ...request, workspaceId: workspace.id });
    if (request.action === 'snapshot') result = { ...result, records: result.records.filter(isDocument) };
  }
  process.stdout.write(JSON.stringify({ ok: true, result: result ?? null }));
} catch (error) {
  process.stdout.write(JSON.stringify({ ok: false, error: error.message, name: error.name }));
  process.exitCode = 1;
}
