import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../', import.meta.url));
const dist = path.join(root, 'apps', 'pwa', 'dist');
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'catpilot-pwa-'));
const prefix = '/catpilot/';
let workerBuild = 0;
const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((request, response) => {
  void (async () => {
    const url = new URL(request.url, 'http://localhost');
    if (!url.pathname.startsWith(prefix)) { response.writeHead(404).end(); return; }
    const file = path.resolve(dist, decodeURIComponent(url.pathname.slice(prefix.length)) || 'index.html');
    if (!file.startsWith(dist + path.sep)) { response.writeHead(403).end(); return; }
    const original = await fs.readFile(file);
    const body = file.endsWith(path.sep + 'sw.js') ? Buffer.concat([original, Buffer.from(`\n// Acceptance build ${workerBuild}\n`)]) : original;
    response.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' }).end(body);
  })().catch(error => { response.writeHead(error.code === 'ENOENT' ? 404 : 500).end(String(error)); });
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}${prefix}`;
let context;
const errors = [];
const options = {
  headless: true, acceptDownloads: true, viewport: { width: 1440, height: 1000 },
  ...(process.env.CATPILOT_BROWSER_EXE ? { executablePath: process.env.CATPILOT_BROWSER_EXE } : {}),
  ...(process.env.CATPILOT_BROWSER_CHANNEL ? { channel: process.env.CATPILOT_BROWSER_CHANNEL } : {}),
};
async function open() {
  context = await chromium.launchPersistentContext(path.join(temp, 'profile'), options);
  context.on('page', watch);
  const page = context.pages()[0] || await context.newPage();
  watch(page);
  await page.goto(url);
  await ready(page);
  return page;
}
function watch(page) { page.on('pageerror', error => errors.push(error.message)); }
async function ready(page) {
  await page.waitForFunction(() => !!window.catpilot);
  await page.waitForFunction(() => document.getElementById('platform-bar').innerText.includes('Offline ready'));
  await page.evaluate(() => navigator.serviceWorker.ready);
}
const request = (page, value) => page.evaluate(value => window.catpilot.request(value), value);
try {
  let page = await open();
  const manifest = await page.evaluate(async () => (await fetch('manifest.webmanifest')).json());
  assert.equal(manifest.display, 'standalone');
  assert.deepEqual(manifest.icons.map(icon => icon.sizes), ['192x192', '512x512']);
  const cached = await page.evaluate(async () => (await Promise.all((await caches.keys()).map(async key => (await (await caches.open(key)).keys()).map(request => request.url)))).flat());
  assert.ok(cached.some(file => file.endsWith('.wasm')), 'SQLite WASM must be precached for a cold offline launch');
  assert.ok(cached.some(file => file.endsWith('/index.html')), 'The production HTML must be precached');
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
  assert.equal(await page.evaluate(() => window.catpilot.platform), 'web');
  await assert.rejects(page.evaluate(() => window.catpilot.aiDraft('', 'test', 'test')), /desktop|browser|unavailable|server/i);

  const workspace = await request(page, { action: 'createWorkspace', name: 'Chromebook work', backend: 'sqlite' });
  let record = await request(page, { action: 'put', workspaceId: workspace.id, input: { domain: 'knowledge', title: 'Persistent note', body: 'Exact Markdown.\r\n', fields: { custom: { preserve: true } } } });
  await page.reload();
  await ready(page);
  const second = await context.newPage();
  await second.goto(url);
  await ready(second);
  const updates = await Promise.allSettled([page, second].map((tab, index) => request(tab, {
    action: 'put', workspaceId: workspace.id, id: record.id, expectedRevision: record.revision,
    input: { ...record, title: `Concurrent winner ${index}` },
  })));
  assert.equal(updates.filter(result => result.status === 'fulfilled').length, 1, 'Only one cross-tab writer may win CAS');
  assert.match(updates.find(result => result.status === 'rejected').reason.message, /changed/i);
  await second.close();
  record = (await request(page, { action: 'snapshot', workspaceId: workspace.id })).records[0];
  assert.deepEqual(record.fields.custom, { preserve: true });

  await context.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => !!window.catpilot && document.getElementById('platform-bar').innerText.includes('Offline'));
  assert.equal((await request(page, { action: 'snapshot', workspaceId: workspace.id })).records[0].body, 'Exact Markdown.\r\n');
  await page.getByRole('navigation').getByRole('button', { name: 'Tasks', exact: true }).click();
  await page.getByRole('button', { name: 'New item', exact: true }).click();
  await page.getByLabel('Document title', { exact: true }).fill('Created while offline');
  await page.getByLabel('Rich document editor', { exact: true }).fill('Offline rich editor content.');
  assert.equal(await page.getByRole('button', { name: 'Preview Markdown', exact: true }).count(), 0, 'Rich writing needs no primary Preview mode');
  await page.getByRole('button', { name: 'Create task', exact: true }).click();
  await page.waitForFunction(async id => (await window.catpilot.request({ action: 'snapshot', workspaceId: id })).records.some(record => record.title === 'Created while offline'), workspace.id);
  await page.getByRole('tab', { name: 'Activity', exact: true }).click();
  const comment = page.getByLabel('Task comment or log', { exact: true });
  await comment.fill('Formatted comment');
  await comment.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a');
  await page.getByRole('group', { name: 'Task comment or log editor', exact: true }).getByRole('button', { name: 'Bold', exact: true }).click();
  await page.getByRole('button', { name: 'Add comment', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[aria-label="Task comment or log"]').textContent === '');
  const saved = (await request(page, { action: 'snapshot', workspaceId: workspace.id })).records.find(record => record.title === 'Created while offline');
  assert.match(saved.fields.comments[0].text, /\*\*Formatted comment\*\*/);
  await page.getByRole('button', { name: 'Edit comment 1', exact: true }).click();
  await page.getByLabel('Edit comment 1', { exact: true }).fill('Updated rich comment');
  await page.getByRole('button', { name: 'Save comment 1', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('[aria-label="Edit comment 1"]'));

  const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6f7kAAAAASUVORK5CYII=', 'base64');
  const asset = { path: 'attachments/offline.png', data: image.toString('base64'), sha256: createHash('sha256').update(image).digest('hex') };
  await request(page, { action: 'addAsset', workspaceId: workspace.id, asset });
  await assert.rejects(request(page, { action: 'addAsset', workspaceId: workspace.id, asset: { ...asset, path: '../escape.png' } }), /path|unsafe|invalid/i);
  const bytes = await page.evaluate(async ({ id, path }) => {
    const asset = await window.catpilot.readAsset(id, path);
    return { data: Array.from(asset.data), mime: asset.mime };
  }, { id: workspace.id, path: asset.path });
  assert.equal(bytes.mime, 'image/png');
  assert.deepEqual(Buffer.from(bytes.data), image);
  const backup = await request(page, { action: 'export', workspaceId: workspace.id });
  assert.equal(backup.assets.length, 1);
  const target = await request(page, { action: 'createWorkspace', name: 'Restored SQLite', backend: 'sqlite' });
  const chooserPromise = page.waitForEvent('filechooser');
  const previewPromise = page.evaluate(id => window.catpilot.importBackup(id, true), target.id);
  const chooser = await chooserPromise;
  await chooser.setFiles({ name: 'catpilot-backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
  await previewPromise;
  await page.evaluate(id => window.catpilot.importBackup(id, false), target.id);
  assert.deepEqual((await request(page, { action: 'snapshot', workspaceId: target.id })).records, backup.records);
  const downloadPromise = page.waitForEvent('download');
  const exportPromise = page.evaluate(id => window.catpilot.exportBackup(id), target.id);
  const download = await downloadPromise;
  const downloadPath = path.join(temp, 'export.json');
  await download.saveAs(downloadPath);
  assert.equal(await exportPromise, true);
  assert.deepEqual(JSON.parse(await fs.readFile(downloadPath, 'utf8')).records, backup.records);
  const empty = await request(page, { action: 'createWorkspace', name: 'Invalid import target', backend: 'sqlite' });
  await assert.rejects(request(page, { action: 'import', workspaceId: empty.id, approved: true, backup: { ...backup, records: [...backup.records, backup.records[0]] } }), /duplicate|collision/i);
  assert.equal((await request(page, { action: 'snapshot', workspaceId: empty.id })).records.length, 0);

  await page.evaluate(async () => {
    const directory = await navigator.storage.getDirectory();
    const folder = await directory.getDirectoryHandle('picked-markdown', { create: true });
    window.showDirectoryPicker = async () => folder;
  });
  const location = await page.evaluate(() => window.catpilot.chooseDirectory());
  const markdown = await request(page, { action: 'createWorkspace', name: 'Personal Markdown', backend: 'markdown', location });
  const exactBody = '\uFEFF---\r\ncustom: unchanged\r\n---\r\n# Offline Markdown\r\n\r\n[[Keep wiki syntax]]  \r\n';
  const note = await request(page, { action: 'put', workspaceId: markdown.id, input: { domain: 'journal', title: 'Folder backed', body: exactBody } });
  const markdownNote = await request(page, { action: 'put', workspaceId: markdown.id, input: { domain: 'knowledge', title: 'Markdown concept', body: exactBody, fields: { folder: 'Research/Notes' } } });
  const changeDirectory = async command => {
    const records = (await request(page, { action: 'snapshot', workspaceId: markdown.id })).records;
    const scope = records.filter(record => ['knowledge', 'concept-folders'].includes(record.domain))
      .map(record => `${record.id}:${record.revision}`).sort().join('\n');
    const expected = await page.evaluate(async data => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data))), byte => byte.toString(16).padStart(2, '0')).join(''), scope);
    return request(page, { action: 'conceptFolder', workspaceId: markdown.id, command, expected });
  };
  await changeDirectory({ type: 'create', parent: '', name: 'Archive' });
  const moved = await changeDirectory({ type: 'move', path: 'Research', parent: 'Archive' });
  assert.equal(moved.records.find(record => record.id === markdownNote.id).fields.folder, 'Archive/Research/Notes');
  const kept = await changeDirectory({ type: 'delete', path: 'Archive/Research', contents: 'keep' });
  assert.equal(kept.records.find(record => record.id === markdownNote.id).fields.folder, 'Archive/Notes');
  assert.equal(kept.records.find(record => record.id === markdownNote.id).body, exactBody);
  const raw = await page.evaluate(async id => {
    const directory = await navigator.storage.getDirectory();
    const folder = await directory.getDirectoryHandle('picked-markdown');
    const catpilot = await folder.getDirectoryHandle('CatPilot');
    return (await (await catpilot.getFileHandle(id + '.md')).getFile()).text();
  }, note.id);
  assert.ok(raw.endsWith(exactBody), 'Actual Markdown files must preserve exact body bytes');
  await request(page, { action: 'import', workspaceId: markdown.id, approved: true, backup }).then(
    () => assert.fail('Import into a nonempty Markdown workspace must fail'),
    error => assert.match(error.message, /empty/i),
  );
  await page.reload();
  await page.waitForFunction(() => !!window.catpilot);
  assert.equal((await request(page, { action: 'snapshot', workspaceId: markdown.id })).records.find(record => record.id === note.id).body, exactBody);
  await request(page, { action: 'unregisterWorkspace', workspaceId: markdown.id });
  assert.equal(await page.evaluate(async id => {
    const folder = await (await navigator.storage.getDirectory()).getDirectoryHandle('picked-markdown');
    return (await (await (await folder.getDirectoryHandle('CatPilot')).getFileHandle(id + '.md')).getFile()).size > 0;
  }, note.id), true, 'Unregister must not delete user Markdown files');

  await context.setOffline(false);
  await page.reload();
  await ready(page);
  await page.getByRole('navigation').getByRole('button', { name: 'Settings', exact: true }).count().then(async count => {
    if (count) await page.getByRole('navigation').getByRole('button', { name: 'Settings', exact: true }).click();
    else await page.getByRole('button', { name: 'Settings', exact: true }).click();
  });
  await page.getByRole('complementary', { name: 'Context and records' }).getByRole('button', { name: 'Agents', exact: true }).click();
  assert.match(await page.getByRole('main').innerText(), /AI requires the desktop app/);
  assert.equal(await page.getByRole('button', { name: 'Sign in with GitHub', exact: true }).count(), 0);
  await page.getByRole('navigation').getByRole('button', { name: 'Tasks', exact: true }).click();
  workerBuild++;
  await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
  await page.getByRole('button', { name: 'Update available', exact: true }).waitFor();
  await page.getByRole('button', { name: 'New item', exact: true }).click();
  await page.getByLabel('Document title', { exact: true }).fill('Save before updating');
  await page.getByRole('button', { name: 'Update available', exact: true }).click();
  assert.match(await page.locator('#platform-bar').innerText(), /Save or discard your draft/);
  assert.equal(await page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration()).waiting), true);
  await page.getByRole('button', { name: 'Create task', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[aria-label="Document save status"]').textContent.includes('Saved locally'));
  await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: 'Update available', exact: true }).click()]);
  await ready(page);
  assert.ok((await request(page, { action: 'snapshot', workspaceId: workspace.id })).records.some(record => record.title === 'Save before updating'));
  await page.getByRole('navigation').getByRole('button', { name: 'Tasks', exact: true }).click();
  const screenshots = process.env.CATPILOT_PWA_SCREENSHOTS;
  if (screenshots) { await fs.mkdir(screenshots, { recursive: true }); await page.screenshot({ path: path.join(screenshots, 'pwa-desktop.png'), fullPage: true }); }
  await page.setViewportSize({ width: 600, height: 900 });
  assert.equal(await page.getByRole('complementary', { name: 'Main navigation' }).evaluate(element => Math.round(element.getBoundingClientRect().width)), 66);
  assert.equal(await page.getByRole('combobox', { name: 'Switch workspace', exact: true }).count(), 1);
  await page.getByRole('combobox', { name: 'Switch workspace', exact: true }).selectOption(target.id);
  await page.waitForFunction(() => !document.body.innerText.includes('Opening your workspace'));
  assert.equal(await page.getByRole('button', { name: 'New item', exact: true }).isEnabled(), true);
  assert.equal(await page.getByRole('main').getByRole('button', { name: 'Board', exact: true }).isVisible(), true);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Narrow layouts must not overflow the viewport');
  if (screenshots) await page.screenshot({ path: path.join(screenshots, 'pwa-narrow.png'), fullPage: true });
  await page.getByRole('navigation').getByRole('button', { name: 'Concepts', exact: true }).click();
  await page.getByText('Folders and kinds', { exact: true }).click();
  const narrowKinds = page.getByRole('group', { name: 'Concept kinds' });
  await narrowKinds.getByRole('button', { name: 'Learning', exact: true }).click();
  await page.getByRole('region', { name: 'Concept items' }).getByRole('heading', { name: 'Learning', exact: true }).waitFor();
  const narrowFolders = page.getByRole('group', { name: 'Concept folders' });
  await narrowFolders.getByRole('button', { name: 'New folder', exact: true }).click();
  const folderDialog = page.getByRole('dialog', { name: 'New folder', exact: true });
  await folderDialog.getByLabel('Folder name', { exact: true }).fill('Study');
  if (screenshots) await page.screenshot({ path: path.join(screenshots, 'pwa-folder-dialog.png') });
  await folderDialog.getByRole('button', { name: 'Create folder', exact: true }).click();
  const study = narrowFolders.getByRole('button', { name: 'Study', exact: true });
  await study.waitFor();
  await narrowFolders.getByRole('button', { name: 'Actions for Study', exact: true }).click();
  await page.getByRole('button', { name: 'New subfolder', exact: true }).click();
  const subfolder = page.getByRole('dialog', { name: 'New subfolder', exact: true });
  await subfolder.getByLabel('Folder name', { exact: true }).fill('Research');
  await subfolder.getByRole('button', { name: 'Create folder', exact: true }).click();
  await narrowFolders.getByRole('button', { name: 'Research', exact: true }).waitFor();
  await page.getByRole('navigation').getByRole('button', { name: 'Focus', exact: true }).click();
  assert.equal(await page.getByRole('complementary', { name: 'Context and records' }).count(), 0);
  const timer = page.getByRole('region', { name: 'Persisted Focus timer' });
  await timer.getByLabel('Planned time', { exact: true }).waitFor();
  assert.ok(await timer.evaluate(element => element.scrollWidth <= element.clientWidth), 'Narrow timer must fit its pane');
  if (screenshots) await page.screenshot({ path: path.join(screenshots, 'pwa-focus-narrow.png') });
  await context.close();
  context = undefined;

  page = await open();
  assert.equal((await request(page, { action: 'snapshot', workspaceId: workspace.id })).records.find(record => record.title === 'Created while offline').fields.comments[0].text, '**Updated rich comment**');
  const persisted = await request(page, { action: 'export', workspaceId: workspace.id });
  assert.deepEqual(persisted.assets, backup.assets, 'SQLite assets must survive a complete browser process restart');
  assert.ok((await request(page, { action: 'snapshot', workspaceId: target.id })).records.some(record => record.domain === 'concept-folders' && record.fields.folder === 'Study/Research'));
  assert.deepEqual(errors, [], 'Browser runtime must not throw');
  console.log('PWA acceptance passed: install manifest; subpath service-worker/WASM offline launch; offline rich CRUD/history; real SQLite browser restart and cross-tab CAS; portable backup uploads/downloads and assets; actual folder-backed Markdown persistence; AI boundaries; responsive navigation.');
} finally {
  await context?.close();
  await new Promise(resolve => server.close(resolve));
  await fs.rm(temp, { recursive: true, force: true });
}
