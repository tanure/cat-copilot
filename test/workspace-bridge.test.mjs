import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { chromium, _electron as electron } from '@playwright/test';
import { WorkspaceRegistry } from '../dist/core/index.js';
import { createWorkspaceClient } from '../lib/workspace-client.js';
import { WorkspaceTerminal } from '../lib/workspace-tui.js';
import { openWorkspaceCanvas, WorkspaceCanvasPanels } from '../.github/extensions/catpilot-canvas/workspace-canvas.mjs';

async function fixture(t) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'catpilot-pinned-bridge-'));
  const registry = new WorkspaceRegistry(home);
  const workspace = await registry.create('Selected SQLite', 'sqlite');
  const other = await registry.create('Other SQLite', 'sqlite');
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  return { home, workspace, other, options: { home, node: process.execPath } };
}
test('pinned child bridge performs shared SQLite CRUD and rejects retargeting or executable requests', async t => {
  const { workspace, other, options } = await fixture(t);
  const client = await createWorkspaceClient(workspace.name, options);
  assert.equal(client.workspace.id, workspace.id);
  const record = await client.request({ action: 'put', input: { domain: 'tasks', title: 'Through bridge', fields: { opaque: { keep: true } } } });
  assert.equal((await client.request({ action: 'snapshot' })).records[0].id, record.id);
  const updated = await client.request({ action: 'put', id: record.id, expectedRevision: record.revision, input: { ...record, title: 'Updated bridge' } });
  assert.equal(updated.title, 'Updated bridge');
  await assert.rejects(() => client.request({ action: 'put', id: record.id, expectedRevision: record.revision, input: record }), /changed/);
  await assert.rejects(() => client.request({ action: 'snapshot', workspaceId: other.id }), /pinned|retarget/i);
  await assert.rejects(() => client.request({ action: 'exec', command: 'arbitrary shell' }), /not allowed|unsupported/i);
  const isolated = await createWorkspaceClient(other.id, options);
  assert.equal((await isolated.request({ action: 'snapshot' })).records.length, 0);
});

test('selected terminal model and actual CLI create/read/update SQLite using observed revisions', async t => {
  const { workspace, options } = await fixture(t);
  const terminal = await WorkspaceTerminal.open(workspace.id, options);
  const created = await terminal.create('tasks', 'Terminal create');
  await terminal.refresh();
  const updated = await terminal.update(created.id, { title: 'Terminal update', fields: { opaque: true } });
  assert.equal(updated.title, 'Terminal update');
  assert.equal(updated.fields.opaque, true);
  const whitespace = await terminal.command(`update ${created.id} {"body":"keep  double    spaces"}`);
  assert.equal(whitespace.body, 'keep  double    spaces', 'terminal JSON patches must not normalize user content');
  const output = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['bin/cat-tui.js', '--workspace', workspace.id], {
      env: { ...process.env, CATPILOT_HOME: options.home, CATPILOT_NODE: process.execPath },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(stdout) : reject(new Error(stderr)));
    child.stdin.end(`add tasks Actual terminal task\nupdate ${created.id} {"title":"Actual terminal edit"}\nlist tasks\nquit\n`);
  });
  assert.match(output, /Actual terminal task/);
  await terminal.refresh();
  assert.equal(terminal.records.find(record => record.id === created.id).title, 'Actual terminal edit');
});

test('selected Canvas HTTP UI performs authenticated SQLite CRUD with immutable workspace context', async t => {
  const { workspace, other, options } = await fixture(t);
  const canvas = await openWorkspaceCanvas(workspace.id, options);
  t.after(() => canvas.close());
  const url = new URL(canvas.url);
  const token = url.pathname.split('/')[1];
  const api = async (request, headers = {}) => {
    const response = await fetch(new URL('api/request', canvas.url), {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-catpilot-token': token, ...headers },
      body: JSON.stringify(request),
    });

    return { status: response.status, data: await response.json() };
  };
  assert.match(await (await fetch(canvas.url)).text(), /CatPilot workspace/);
  const created = await api({ action: 'put', input: { domain: 'tasks', title: 'Canvas create', fields: { opaque: { nested: true } } } });
  assert.equal(created.status, 200);
  const record = created.data;
  assert.match(record.id, /^[0-9a-f-]{36}$/);
  const snapshot = await api({ action: 'snapshot' });
  assert.equal(snapshot.data.records[0].id, record.id);
  const update = await api({ action: 'put', id: record.id, expectedRevision: record.revision, input: { ...record, title: 'Canvas update' } });
  assert.equal(update.data.title, 'Canvas update');
  assert.deepEqual(update.data.fields.opaque, { nested: true });
  assert.equal((await api({ action: 'put', id: record.id, expectedRevision: record.revision, input: record })).status, 409);
  assert.equal((await api({ action: 'snapshot', workspaceId: other.id })).status, 400);
  assert.equal((await api({ action: 'exec', command: 'anything' })).status, 400);
  assert.equal((await api({ action: 'snapshot' }, { origin: 'https://untrusted.example' })).status, 403);
  assert.equal((await api({ action: 'snapshot' }, { 'x-catpilot-token': 'wrong' })).status, 403);
  const client = await createWorkspaceClient(workspace.id, options);
  assert.equal((await client.request({ action: 'snapshot' })).records[0].title, 'Canvas update');
});

test('Canvas panel focus retains its UUID and queued explicit switches close displaced contexts', async t => {
  const { workspace, other, options } = await fixture(t);
  const panels = new WorkspaceCanvasPanels(options);
  t.after(() => panels.close('panel'));
  const first = await panels.open('panel', workspace.id);
  assert.equal((await panels.open('panel')).url, first.url, 'focusing a selected instance without input must not fall back to legacy');
  const switched = await panels.open('panel', other.id);
  assert.equal(switched.workspace.id, other.id);
  await assert.rejects(() => fetch(first.url));
  const [displaced, current] = await Promise.all([panels.open('panel', workspace.id), panels.open('panel', other.id)]);
  assert.equal(panels.get('panel').url, current.url);
  await assert.rejects(() => fetch(displaced.url));
});

test('real Canvas browser form saves SQLite records and retains drafts after invalid JSON and stale CAS', async t => {
  const browserOptions = process.env.CATPILOT_TEST_BROWSER ? { executablePath: process.env.CATPILOT_TEST_BROWSER } :
    existsSync(chromium.executablePath()) ? {} : null;
  const { workspace, options } = await fixture(t);
  const canvas = await openWorkspaceCanvas(workspace.id, options);
  t.after(() => canvas.close());
  let page;
  if (browserOptions) {
    const browser = await chromium.launch({ ...browserOptions, headless: true });
    t.after(() => browser.close());
    page = await browser.newPage();
  } else {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'catpilot-canvas-electron-'));
    let app;
    t.after(async () => {
      try {
        if (app) {
          // The conflict assertion deliberately leaves a draft; destroy bypasses its unload confirmation.
          await app.evaluate(({ BrowserWindow }) => { for (const window of BrowserWindow.getAllWindows()) window.destroy(); });
          await app.close();
        }
      }
      finally { await fs.rm(directory, { recursive: true, force: true }); }
    });
    const entry = path.join(directory, 'main.cjs');
    await fs.writeFile(entry, `const { app, BrowserWindow } = require('electron');
app.setPath('userData', ${JSON.stringify(path.join(directory, 'profile'))});
app.disableHardwareAcceleration();
let window;
app.whenReady().then(() => {
  window = new BrowserWindow({ show: false, width: 1500, height: 1100,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  void window.loadURL('about:blank');
});
`);
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    app = await electron.launch({ args: [entry], env, timeout: 60_000 });
    page = await app.firstWindow();
    await page.waitForLoadState();
    t.diagnostic('Canvas UI exercised through installed Electron; no browser download or Edge required.');
  }
  page.setDefaultTimeout(10_000);
  await page.goto(canvas.url);
  await page.waitForFunction(() => document.getElementById('context').textContent.includes('Selected SQLite') && !document.getElementById('title').disabled);
  await page.getByLabel('Title', { exact: true }).fill('Browser-created SQLite task');
  await page.getByText('Structured fields (JSON; unknown metadata is retained)', { exact: true }).click();
  await page.getByLabel('Fields', { exact: true }).fill('{"opaque":{"keep":true}}');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForFunction(() => document.getElementById('message').textContent === 'Saved to the selected workspace.' && !document.getElementById('title').disabled);
  const client = await createWorkspaceClient(workspace.id, options);
  const created = (await client.request({ action: 'snapshot' })).records[0];
  assert.equal(created.title, 'Browser-created SQLite task');
  assert.deepEqual(created.fields.opaque, { keep: true });
  const originalBody = '# Exact source\r\n\r\nKeep CRLF bytes.\r\n';
  await client.request({ action: 'put', id: created.id, expectedRevision: created.revision, input: { ...created, body: originalBody } });
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await page.waitForFunction(() => document.getElementById('body').value.includes('Keep CRLF bytes.') && !document.getElementById('title').disabled);
  await page.getByLabel('Title', { exact: true }).fill('Browser-updated task');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForFunction(() => !document.getElementById('title').disabled);
  const updated = (await client.request({ action: 'snapshot' })).records[0];
  assert.equal(updated.title, 'Browser-updated task');
  assert.deepEqual(updated.fields.opaque, { keep: true });
  assert.equal(updated.body, originalBody, 'title-only browser edits must preserve untouched Markdown bytes');
  await page.getByLabel('Fields', { exact: true }).fill('{invalid JSON');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  assert.match(await page.getByRole('status').textContent(), /valid JSON/);
  assert.equal(await page.getByLabel('Fields', { exact: true }).inputValue(), '{invalid JSON');
  await page.getByLabel('Fields', { exact: true }).fill(JSON.stringify(updated.fields));
  await page.getByLabel('Title', { exact: true }).fill('Keep my conflicting draft');
  await client.request({ action: 'put', id: updated.id, expectedRevision: updated.revision, input: { ...updated, title: 'External edit' } });
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForFunction(() => document.getElementById('message').textContent.includes('changed in another'));
  assert.equal(await page.getByLabel('Title', { exact: true }).inputValue(), 'Keep my conflicting draft');
  assert.equal((await client.request({ action: 'snapshot' })).records[0].title, 'External edit');
});
