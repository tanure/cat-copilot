import assert from 'node:assert/strict';
import { rm, mkdir, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const profile = path.join(root, 'apps', 'pwa', 'src', `.storage-test-profile-${process.pid}`);
const html = `<!doctype html><button id="choose">Choose directory</button><script type="module">
  import { BrowserStorage } from '/apps/pwa/src/storage.ts';
  import { createBrowserBridge } from '/apps/pwa/src/bridge.ts';
  import * as codecs from '/apps/pwa/src/storage-codecs.ts';
  window.storage = await BrowserStorage.open();
  window.bridge = await createBrowserBridge();
  window.BrowserStorage = BrowserStorage;
  window.createBrowserBridge = createBrowserBridge;
  window.codecs = codecs;
  window.ready = true;
</script>`;

test('offline browser storage adapter', { timeout: 120_000 }, async t => {
  let context;
  const server = await createServer({
    configFile: false, root, logLevel: 'error',
    server: { host: '127.0.0.1', port: 0, watch: null, hmr: false },
    plugins: [{
      name: 'storage-test-page',
      configureServer(server) {
        server.middlewares.use('/__storage-tests', (_request, response) => {
          response.setHeader('Content-Type', 'text/html');
          response.end(html);
        });
      },
    }],
  });
  try {
    await mkdir(profile, { recursive: true });
    await server.listen();
    const address = server.httpServer.address();
    const url = `http://127.0.0.1:${address.port}/__storage-tests`;
    let executablePath = process.env.CATPILOT_BROWSER_EXE;
    if (!executablePath) {
      try { await access(chromium.executablePath()); }
      catch {
        const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
        await access(edge);
        executablePath = edge;
      }
    }
    context = await chromium.launchPersistentContext(profile, {
      headless: true, acceptDownloads: true, ...(executablePath ? { executablePath } : {}),
      downloadsPath: path.join(profile, 'downloads'),
    });
    const page = await context.newPage();
    const wasmRequests = [];
    page.on('request', request => {
      if (request.resourceType() === 'fetch' && /\.wasm(?:\?|$)/.test(request.url())) wasmRequests.push(request.url());
    });
    const open = async page => { await page.goto(url); await page.waitForFunction(() => window.ready); };
    await open(page);
    assert.equal(wasmRequests.length, 0, 'Startup and registry access must not initialize SQLite WASM');
    const request = value => page.evaluate(value => window.bridge.request(value), value);
    const create = (name, backend = 'sqlite', location) => request({ action: 'createWorkspace', name, backend, ...(location ? { location } : {}) });
    const record = {
      domain: 'tasks', title: 'Offline task', body: '## Exact body\r\n\r\n- [ ] Keep trailing spaces  \n',
      fields: { tags: ['offline'], custom: { nested: ['preserved', { enabled: true }] } },
    };
    const workspace = await create('SQLite source');
    let current;
    let backup;

    await t.test('real SQLite, persistence, no-op and revision CAS across tabs', async () => {
      current = await request({ action: 'put', workspaceId: workspace.id, input: record });
      assert.deepEqual(current.fields.custom, record.fields.custom);
      assert.equal(current.body, record.body);
      const noop = await request({ action: 'put', workspaceId: workspace.id, input: record, id: current.id, expectedRevision: current.revision });
      assert.deepEqual(noop, current);
      const signature = await page.evaluate(async id => {
        const db = await new Promise((resolve, reject) => {
          const request = indexedDB.open('catpilot-offline-v1');
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        const state = await new Promise((resolve, reject) => {
          const request = db.transaction('workspaces').objectStore('workspaces').get(id);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        db.close();
        return new TextDecoder().decode(state.database.slice(0, 16));
      }, workspace.id);
      assert.equal(signature, 'SQLite format 3\0');
      const other = await context.newPage();
      await open(other);
      const update = { action: 'put', workspaceId: workspace.id, id: current.id, expectedRevision: current.revision };
      const outcomes = await Promise.allSettled([
        request({ ...update, input: { ...record, title: 'Writer one' } }),
        other.evaluate(value => window.storage.execute(value), { ...update, input: { ...record, title: 'Writer two' } }),
      ]);
      assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1);
      assert.match(outcomes.find(result => result.status === 'rejected').reason.message, /changed in another/);
      await page.reload();
      await page.waitForFunction(() => window.ready);
      current = (await request({ action: 'snapshot', workspaceId: workspace.id })).records[0];
      assert.match(current.title, /^Writer /);
      await other.close();
    });

    await t.test('shared management logic and portable assets round-trip', async () => {
      current = await request({
        action: 'management', workspaceId: workspace.id,
        request: { action: 'comment', id: current.id, expectedRevision: current.revision, text: 'Stored offline' },
      });
      assert.deepEqual(current.fields.custom, record.fields.custom);
      const asset = await page.evaluate(async () => ({
        path: 'attachments/example.bin', data: btoa('offline\0asset'),
        sha256: await window.codecs.digest(new TextEncoder().encode('offline\0asset')),
      }));
      assert.equal(await request({ action: 'addAsset', workspaceId: workspace.id, asset }), 'catpilot-asset:attachments/example.bin');
      await assert.rejects(request({ action: 'addAsset', workspaceId: workspace.id, asset }), /collision/);
      backup = await request({ action: 'export', workspaceId: workspace.id });
      const target = await create('Restored SQLite');
      await request({ action: 'import', workspaceId: target.id, backup, approved: true });
      assert.deepEqual((await request({ action: 'export', workspaceId: target.id })).records, backup.records);
      const loaded = await request({ action: 'readAsset', workspaceId: target.id, path: asset.path });
      assert.equal(Object.values(loaded.data).length, 13);
      await assert.rejects(request({ action: 'import', workspaceId: target.id, backup, approved: true }), /empty/);
      await assert.rejects(request({ action: 'readAsset', workspaceId: target.id, path: '../escape' }), /unsafe/);
    });

    await t.test('invalid backup paths, checksums, duplicate IDs and prefix/case collisions fail before mutation', async () => {
      const target = await create('Validation target');
      const badBackups = [
        { ...backup, records: [backup.records[0], backup.records[0]] },
        { ...backup, assets: [{ ...backup.assets[0], sha256: '0'.repeat(64) }] },
        { ...backup, assets: [{ ...backup.assets[0], path: 'x/../../outside' }] },
        { ...backup, assets: [{ ...backup.assets[0], path: 'CON.txt' }] },
        { ...backup, assets: [{ ...backup.assets[0], data: backup.assets[0].data.replace(/=+$/, '') }] },
        { ...backup, assets: [{ ...backup.assets[0], path: 'A/x' }, { ...backup.assets[0], path: 'a/y' }] },
        { ...backup, assets: [{ ...backup.assets[0], path: 'a' }, { ...backup.assets[0], path: 'a/b' }] },
        { ...backup, records: [{ ...backup.records[0], fields: { ...backup.records[0].fields, progress: 999 } }] },
      ];
      // Use a definitely noncanonical encoding independently of the payload length.
      badBackups[4].assets[0].data += '\n';
      for (const bad of badBackups) {
        await assert.rejects(request({ action: 'import', workspaceId: target.id, backup: bad, approved: true }));
      }
      assert.equal((await request({ action: 'snapshot', workspaceId: target.id })).records.length, 0);
    });

    await t.test('failed IndexedDB commits leave both SQLite records and assets untouched', async () => {
      const target = await create('Atomic target');
      const message = await page.evaluate(async ({ id, backup }) => {
        const original = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function (...args) {
          if (this.name === 'workspaces') throw new DOMException('Injected quota failure', 'QuotaExceededError');
          return original.apply(this, args);
        };
        try {
          await window.storage.execute({ action: 'import', workspaceId: id, backup, approved: true });
          return 'unexpected success';
        } catch (error) { return error.message; }
        finally { IDBObjectStore.prototype.put = original; }
      }, { id: target.id, backup });
      assert.match(message, /quota/);
      const empty = await request({ action: 'export', workspaceId: target.id });
      assert.equal(empty.records.length, 0);
      assert.equal(empty.assets.length, 0);
    });

    let markdown;
    await t.test('directory choice requires a gesture and actual handles survive registry persistence', async () => {
      await assert.rejects(create('No chosen folder', 'markdown'), /Choose folder/);
      await page.evaluate(async () => {
        window.testDirectory = await (await navigator.storage.getDirectory()).getDirectoryHandle('markdown-fixture', { create: true });
        window.showDirectoryPicker = async () => {
          if (!navigator.userActivation.isActive) throw new Error('Picker lost its user gesture');
          return window.testDirectory;
        };
        document.querySelector('#choose').onclick = () => {
          window.choice = window.bridge.chooseDirectory();
        };
      });
      await page.click('#choose');
      const location = await page.evaluate(() => window.choice);
      markdown = await create('Markdown fixture', 'markdown', location);
      assert.equal(markdown.location, 'markdown-fixture');
      const created = await request({ action: 'put', workspaceId: markdown.id, input: record });
      await page.reload();
      await page.waitForFunction(() => window.ready);
      assert.equal((await request({ action: 'snapshot', workspaceId: markdown.id })).records[0].id, created.id);
    });

    await t.test('Markdown frontmatter and bodies remain byte-identical on no-op, unknown metadata survives edits', async () => {
      const result = await page.evaluate(async ({ id }) => {
        const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle('markdown-fixture');
        const root = await directory.getDirectoryHandle('CatPilot');
        const before = (await window.storage.execute({ action: 'snapshot', workspaceId: id })).records[0];
        const handle = await root.getFileHandle(`${before.id}.md`);
        const { body, revision, ...metadata } = before;
        const raw = `---\r\ncatpilot: ${JSON.stringify({ ...metadata, futureMetadata: { nested: [1, { enabled: true }] } })}\r\n---\r\n${body}`;
        const writer = await handle.createWritable();
        await writer.write(raw);
        await writer.close();
        const existing = (await window.storage.execute({ action: 'snapshot', workspaceId: id })).records[0];
        const input = { domain: existing.domain, title: existing.title, body: existing.body, fields: existing.fields };
        const noop = await window.storage.execute({ action: 'put', workspaceId: id, id: existing.id, expectedRevision: existing.revision, input });
        const unchanged = await (await handle.getFile()).text();
        await window.storage.execute({ action: 'put', workspaceId: id, id: existing.id, expectedRevision: noop.revision, input: { ...input, title: 'Edited' } });
        const updated = await (await handle.getFile()).text();
        return { raw, unchanged, updated, body };
      }, { id: markdown.id });
      assert.equal(result.unchanged, result.raw);
      assert.ok(result.updated.endsWith(result.body));
      assert.match(result.updated, /"futureMetadata":\{"nested":\[1,\{"enabled":true\}\]\}/);
    });

    await t.test('malformed Markdown fails visibly without dropping or overwriting files', async () => {
      const invalid = '00000000-0000-4000-8000-000000000001.md';
      await page.evaluate(async name => {
        const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle('markdown-fixture');
        const root = await directory.getDirectoryHandle('CatPilot');
        const writer = await (await root.getFileHandle(name, { create: true })).createWritable();
        await writer.write('not CatPilot metadata');
        await writer.close();
      }, invalid);
      await assert.rejects(request({ action: 'snapshot', workspaceId: markdown.id }), /Invalid CatPilot metadata/);
      const raw = await page.evaluate(async name => {
        const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle('markdown-fixture');
        const root = await directory.getDirectoryHandle('CatPilot');
        const raw = await (await (await root.getFileHandle(name)).getFile()).text();
        await root.removeEntry(name);
        return raw;
      }, invalid);
      assert.equal(raw, 'not CatPilot metadata');
    });

    await t.test('permission loss never breaks startup or returns an empty workspace; explicit reconnect works', async () => {
      const result = await page.evaluate(async id => {
        const prototype = FileSystemDirectoryHandle.prototype;
        const query = prototype.queryPermission;
        const permission = prototype.requestPermission;
        prototype.queryPermission = async () => 'denied';
        prototype.requestPermission = async () => {
          prototype.queryPermission = async () => 'granted';
          return 'granted';
        };
        try {
          const bridge = await window.createBrowserBridge();
          const list = await bridge.request({ action: 'listWorkspaces' });
          let error;
          try { await bridge.request({ action: 'snapshot', workspaceId: id }); } catch (failure) { error = failure.message; }
          await bridge.restoreWorkspaceAccess(id);
          const snapshot = await bridge.request({ action: 'snapshot', workspaceId: id });
          return { count: list.length, error, records: snapshot.records.length };
        } finally { prototype.queryPermission = query; prototype.requestPermission = permission; }
      }, markdown.id);
      assert.ok(result.count > 0);
      assert.match(result.error, /Restore folder access/);
      assert.equal(result.records, 1);
    });

    await t.test('choosing the same folder reconnects its saved registration rather than creating an alias', async () => {
      await page.evaluate(async () => {
        window.testDirectory = await (await navigator.storage.getDirectory()).getDirectoryHandle('markdown-fixture');
        window.showDirectoryPicker = async () => {
          if (!navigator.userActivation.isActive) throw new Error('Picker lost its user gesture');
          return window.testDirectory;
        };
        document.querySelector('#choose').onclick = () => { window.choice = window.bridge.chooseDirectory(); };
      });
      await page.click('#choose');
      const location = await page.evaluate(() => window.choice);
      await assert.rejects(create('Duplicate folder', 'markdown', location), /already registered/);
      assert.equal((await request({ action: 'snapshot', workspaceId: markdown.id })).records.length, 1);
      const before = await request({ action: 'export', workspaceId: markdown.id });
      await assert.rejects(request({ action: 'import', workspaceId: markdown.id, backup, approved: true }), /empty/);
      const after = await request({ action: 'export', workspaceId: markdown.id });
      assert.deepEqual(after.records, before.records);
    });

    await t.test('interrupted Markdown restore is journaled, blocked across reloads, and resumes only the original payload', async () => {
      await page.evaluate(async () => {
        window.testDirectory = await (await navigator.storage.getDirectory()).getDirectoryHandle('recovery-fixture', { create: true });
        window.showDirectoryPicker = async () => window.testDirectory;
        document.querySelector('#choose').onclick = () => { window.choice = window.bridge.chooseDirectory(); };
      });
      await page.click('#choose');
      const location = await page.evaluate(() => window.choice);
      const target = await create('Recovery target', 'markdown', location);
      const copy = { ...backup.records[0], id: '00000000-0000-4000-8000-000000000002', title: 'Second record' };
      const source = { ...backup, records: [backup.records[0], copy] };
      const message = await page.evaluate(async ({ id, backup, failName }) => {
        const original = FileSystemDirectoryHandle.prototype.getFileHandle;
        FileSystemDirectoryHandle.prototype.getFileHandle = async function (name, options) {
          if (name === failName && options?.create) throw new Error('Injected disk interruption');
          return original.call(this, name, options);
        };
        try {
          await window.storage.execute({ action: 'import', workspaceId: id, backup, approved: true });
          return 'unexpected success';
        } catch (error) { return error.message; }
        finally { FileSystemDirectoryHandle.prototype.getFileHandle = original; }
      }, { id: target.id, backup: source, failName: `${copy.id}.md` });
      assert.match(message, /interrupted Markdown import/);
      await page.reload();
      await page.waitForFunction(() => window.ready);
      await assert.rejects(request({ action: 'snapshot', workspaceId: target.id }), /recovery/i);
      await assert.rejects(request({ action: 'put', workspaceId: target.id, input: record }), /recovery/i);
      await assert.rejects(request({ action: 'import', workspaceId: target.id, backup, approved: true }), /recovery/i);
      const written = await page.evaluate(async id => {
        const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle('recovery-fixture');
        const handle = await (await directory.getDirectoryHandle('CatPilot')).getFileHandle(`${id}.md`);
        const original = await (await handle.getFile()).text();
        const writer = await handle.createWritable();
        await writer.write('external edit: preserve me');
        await writer.close();
        return original;
      }, backup.records[0].id);
      await assert.rejects(request({ action: 'import', workspaceId: target.id, backup: source, approved: true }), /differs/);
      assert.equal(await page.evaluate(async ({ id, raw }) => {
        const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle('recovery-fixture');
        const handle = await (await directory.getDirectoryHandle('CatPilot')).getFileHandle(`${id}.md`);
        const retained = await (await handle.getFile()).text();
        const writer = await handle.createWritable();
        await writer.write(raw);
        await writer.close();
        return retained;
      }, { id: backup.records[0].id, raw: written }), 'external edit: preserve me');
      await request({ action: 'import', workspaceId: target.id, backup: source, approved: true });
      const restored = await request({ action: 'export', workspaceId: target.id });
      assert.equal(restored.records.length, 2);
      assert.deepEqual(restored.assets, backup.assets);
      const before = restored.records.map(({ revision, ...entry }) => entry).sort((a, b) => a.id.localeCompare(b.id));
      const expected = source.records.map(({ revision, ...entry }) => entry).sort((a, b) => a.id.localeCompare(b.id));
      assert.deepEqual(before, expected);
      await request({ action: 'unregisterWorkspace', workspaceId: target.id });
      const retained = await page.evaluate(async () => {
        const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle('recovery-fixture');
        const files = [];
        for await (const entry of (await directory.getDirectoryHandle('CatPilot')).values()) files.push(entry.name);
        return files;
      });
      assert.equal(retained.length, 2);
    });

    await t.test('binary attachment chooser sanitizes portable names and reads stored bytes offline', async () => {
      const chooser = page.waitForEvent('filechooser');
      const pending = page.evaluate(id => window.bridge.importAsset(id), workspace.id);
      const bytes = Buffer.from([0, 1, 2, 255, 254, 0]);
      await (await chooser).setFiles({ name: 'CON.txt', mimeType: 'application/octet-stream', buffer: bytes });
      const reference = await pending;
      assert.match(reference, /^catpilot-asset:attachments\/[0-9a-f-]{36}\/_CON\.txt$/);
      await context.setOffline(true);
      try {
        const read = await page.evaluate(async ({ id, path }) => {
          const asset = await window.bridge.readAsset(id, path);
          return [...asset.data];
        }, { id: workspace.id, path: reference.slice('catpilot-asset:'.length) });
        assert.deepEqual(read, [...bytes]);
      } finally { await context.setOffline(false); }
    });

    await t.test('backup approval uses the cached preview, never a second file picker; AI cannot run', async () => {
      const target = await create('Picker restore');
      const chooser = page.waitForEvent('filechooser');
      const preview = page.evaluate(id => window.bridge.importBackup(id, true), target.id);
      await (await chooser).setFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
      assert.equal((await preview).count, backup.records.length);
      await page.evaluate(id => window.bridge.importBackup(id, false), target.id);
      const restored = await request({ action: 'export', workspaceId: target.id });
      assert.deepEqual(restored.records, backup.records);
      await assert.rejects(page.evaluate(id => window.bridge.importBackup(id, false), target.id), /Preview/);
      const status = await page.evaluate(() => window.bridge.aiStatus());
      assert.equal(status.authenticated, false);
      assert.match(status.message, /trusted backend/);
      await assert.rejects(page.evaluate(() => window.bridge.aiDraft('unused', 'prompt', 'context')), /unavailable/);
      await assert.rejects(page.evaluate(() => window.bridge.importLegacy('unused', true)), /desktop/);
    });

    await t.test('offline export bypasses document link interception and rejects canceled activation', async () => {
      await page.evaluate(() => {
        window.externalLinks = event => {
          if (event.target.closest?.('a')) event.preventDefault();
        };
        document.addEventListener('click', window.externalLinks);
      });
      await context.setOffline(true);
      try {
        const [download, accepted] = await Promise.all([
          page.waitForEvent('download'),
          page.evaluate(id => window.bridge.exportBackup(id), workspace.id),
        ]);
        assert.equal(accepted, true);
        const stream = await download.createReadStream();
        const chunks = [];
        for await (const chunk of stream) chunks.push(chunk);
        assert.equal(JSON.parse(Buffer.concat(chunks).toString('utf8')).workspace.id, workspace.id);
        const error = await page.evaluate(async id => {
          const block = event => {
            if (event.target.closest?.('a[download]')) event.preventDefault();
          };
          document.addEventListener('click', block, { capture: true });
          try { await window.bridge.exportBackup(id); return 'unexpected success'; }
          catch (error) { return error.message; }
          finally { document.removeEventListener('click', block, { capture: true }); }
        }, workspace.id);
        assert.match(error, /download was canceled/);
      } finally {
        await context.setOffline(false);
        await page.evaluate(() => document.removeEventListener('click', window.externalLinks));
      }
    });
  } finally {
    await context?.close();
    await server.close();
    await rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
});
