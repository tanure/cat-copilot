import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
function installedRoot() {
  const candidates = process.env.CATPILOT_PACKAGE_ROOT ? [process.env.CATPILOT_PACKAGE_ROOT] : [path.resolve(here, '../../..')];
  if (!process.env.CATPILOT_PACKAGE_ROOT) {
    try { candidates.push(path.dirname(createRequire(import.meta.url).resolve('@alberttanure/catpilot-cli/package.json'))); } catch { /* Try standard global installation prefixes. */ }
    for (const prefix of (process.env.PATH || '').split(path.delimiter)) {
      candidates.push(path.join(prefix, 'node_modules/@alberttanure/catpilot-cli'), path.resolve(prefix, '../lib/node_modules/@alberttanure/catpilot-cli'));
    }
  }
  for (const candidate of candidates) {
    try {
      if (JSON.parse(fs.readFileSync(path.join(candidate, 'package.json'), 'utf8')).name === '@alberttanure/catpilot-cli') return fs.realpathSync(candidate);
    } catch { /* A candidate is not an installed CatPilot package. */ }
  }
  throw new Error('Install @alberttanure/catpilot-cli and Node >=22.13 for SQLite. Set CATPILOT_PACKAGE_ROOT to the package directory and CATPILOT_NODE to the installed Node executable if not found automatically.');
}
const send = (res, code, data) => {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(JSON.stringify(data));
};

/** Serialize lifecycle changes so focus preserves drafts and switches cannot leak old contexts. */
export class WorkspaceCanvasPanels {
  constructor(options = {}) { this.options = options; this.instances = new Map(); this.pending = new Map(); }
  has(id) { return this.instances.has(id) || this.pending.has(id); }
  get(id) { return this.instances.get(id); }
  enqueue(id, run) {
    const operation = (this.pending.get(id) || Promise.resolve()).catch(() => {}).then(run);
    this.pending.set(id, operation);
    return operation.finally(() => { if (this.pending.get(id) === operation) this.pending.delete(id); });
  }
  open(id, selector) {
    return this.enqueue(id, async () => {
      const previous = this.instances.get(id);
      if (previous && (selector === undefined || selector === previous.workspace.id)) return previous;
      if (typeof selector !== 'string' || !selector.trim()) throw new Error('Select a non-empty workspace name or UUID.');
      const selected = await openWorkspaceCanvas(selector, this.options);
      if (previous && selected.workspace.id === previous.workspace.id) { await selected.close(); return previous; }
      this.instances.set(id, selected);
      if (previous) await previous.close();
      return selected;
    });
  }
  close(id) {
    return this.enqueue(id, async () => {
      const selected = this.instances.get(id);
      this.instances.delete(id);
      if (selected) await selected.close();
    });
  }
}

/** One server/capability per instance; requests can never choose another UUID. */
export async function openWorkspaceCanvas(selector, options = {}) {
  const { createWorkspaceClient } = await import(pathToFileURL(path.join(installedRoot(), 'lib/workspace-client.js')).href);
  const client = await createWorkspaceClient(selector, options);
  const token = randomBytes(32).toString('hex');
  const prefix = `/${token}/`;
  let origin;
  const server = createServer(async (req, res) => {
    try {
      if (req.headers.host !== new URL(origin).host) return send(res, 403, { error: 'Invalid workspace host.' });
      const url = new URL(req.url, origin);
      if (!url.pathname.startsWith(prefix)) return send(res, 404, { error: 'Unknown canvas capability.' });
      const route = url.pathname.slice(prefix.length);
      if (route.startsWith('api/')) {
        if ((req.headers.origin && req.headers.origin !== origin) ||
            (req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(req.headers['sec-fetch-site']))) {
          return send(res, 403, { error: 'Cross-origin workspace access denied.' });
        }
        if (req.headers['x-catpilot-token'] !== token) return send(res, 403, { error: 'Workspace capability token required.' });
        if (route === 'api/context' && req.method === 'GET') return send(res, 200, client.workspace);
        if (route !== 'api/request' || req.method !== 'POST') return send(res, 405, { error: 'Use POST api/request.' });
        if (!String(req.headers['content-type'] || '').startsWith('application/json')) return send(res, 415, { error: 'JSON requests are required.' });
        let size = 0;
        const chunks = [];
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 8_000_000) return send(res, 413, { error: 'Workspace request exceeds 8 MB.' });
          chunks.push(chunk);
        }
        return send(res, 200, await client.request(JSON.parse(Buffer.concat(chunks).toString('utf8'))));
      }
      const assets = {
        '': ['workspace.html', 'text/html; charset=utf-8'],
        'workspace.js': ['workspace.js', 'text/javascript; charset=utf-8'],
        'workspace.css': ['workspace.css', 'text/css; charset=utf-8'],
      };
      const asset = assets[route];
      if (!asset || req.method !== 'GET') return send(res, 404, { error: 'Not found.' });
      let content = await readFile(path.join(here, 'ui', asset[0]), 'utf8');
      if (!route) content = content.replace('__CATPILOT_TOKEN__', token);
      res.writeHead(200, {
        'content-type': asset[1], 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
        'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'",
      });
      res.end(content);
    } catch (error) {
      send(res, error.name === 'ConflictError' ? 409 : 400, { error: error.message, name: error.name });
    }
  });
  server.requestTimeout = 35_000;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  origin = `http://127.0.0.1:${server.address().port}`;
  return Object.freeze({
    workspace: client.workspace,
    url: `${origin}${prefix}`,
    request: client.request,
    close: () => new Promise((resolve, reject) => { server.closeAllConnections?.(); server.close(error => error ? reject(error) : resolve()); }),
  });
}
