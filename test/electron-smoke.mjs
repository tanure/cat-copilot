import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeSync } from 'node:fs';
import fs from 'node:fs/promises';
import { createServer } from 'node:http';
import { once } from 'node:events';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { openRepository, recordInputSchema } from '../dist/core/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'catpilot-electron-'));
const appPath = process.env.CATPILOT_TEST_APP || path.join(root, 'apps', 'desktop');
const launchOptions = {
  ...(process.env.CATPILOT_TEST_EXE ? { executablePath: process.env.CATPILOT_TEST_EXE } : {}),
  args: process.env.CATPILOT_TEST_EXE ? [] : [appPath],
  env: { ...process.env, CATPILOT_HOME: path.join(temp, 'registry'), CATPILOT_USER_DATA: path.join(temp, 'user-data') },
  timeout: 60_000,
};
let app;
let appProcess;
let largeWorkspace;
let succeeded = false;
const errors = [];
const stderr = new WeakMap();
async function launch(options = launchOptions) {
  const instance = await electron.launch(options);
  const child = instance.process();
  child.stderr?.setEncoding('utf8').on('data', chunk => {
    stderr.set(child, ((stderr.get(child) ?? '') + chunk).slice(-4096));
  });
  return instance;
}

async function closeGracefully(app, child, label) {
  assert.ok(child.exitCode === null && child.signalCode === null, `${label} Electron process exited before graceful shutdown`);
  const stopped = new Promise(resolve => child.once('close', resolve));
  let stage = 'Playwright app.close()';
  // Rejecting a promise alone would leave Playwright and its child keeping CI alive.
  const timer = setTimeout(() => {
    writeSync(2, `[quit test pid=${process.pid} child=${child.pid}] ${label} timed out in ${stage}; exitCode=${child.exitCode} signalCode=${child.signalCode}\n`);
    if (stderr.has(child)) writeSync(2, `[quit test] Electron stderr:\n${stderr.get(child)}\n`);
    if (process.env.GITHUB_ACTIONS === 'true' && process.platform === 'darwin' && child.pid) {
      const ps = spawnSync('/bin/ps', ['-axo', 'pid=,ppid=,pgid=,stat=,comm='], { encoding: 'utf8', timeout: 3_000, killSignal: 'SIGKILL' });
      const group = ps.stdout?.split('\n').filter(line => line.trim().split(/\s+/)[2] === String(child.pid));
      writeSync(2, `[quit test] exact process group (pid ppid pgid stat executable):\n${group?.join('\n') || '(none)'}\n`);
      if (group?.some(line => line.trim().split(/\s+/)[0] === String(child.pid)) && child.exitCode === null && child.signalCode === null) {
        const sample = spawnSync('/usr/bin/sample', [String(child.pid), '2', '10', '-file', '/dev/stdout'], {
          encoding: 'utf8', timeout: 8_000, killSignal: 'SIGKILL', maxBuffer: 8 * 1024 * 1024,
        });
        writeSync(2, `[quit test] sample status=${sample.status} error=${sample.error ?? ''}\n${sample.stderr ?? ''}\n${sample.stdout?.split('\n').slice(0, 170).join('\n') ?? ''}\n`);
      }
    }
    process.exit(1);
  }, 30_000);
  try {
    await app.close();
    stage = 'child close event';
    await stopped;
    assert.equal(child.exitCode, 0, `${label} Electron process did not exit cleanly (signal=${child.signalCode})`);
  } finally { clearTimeout(timer); }
}

async function checkQuitDuringLoad() {
  let requested = false;
  const server = createServer((_request, reply) => {
    requested = true;
    reply.writeHead(200, { 'Content-Type': 'text/html' });
    reply.write('<!doctype html><title>Renderer still loading</title>');
    // Leave the main document response unfinished until Electron quits.
  });
  server.listen(0, '127.0.0.1');
  try {
    await once(server, 'listening');
    app = await launch({
      ...launchOptions,
      env: { ...launchOptions.env, ELECTRON_RENDERER_URL: `http://127.0.0.1:${server.address().port}/` },
    });
    appProcess = app.process();
    if (!requested) await once(server, 'request', { signal: AbortSignal.timeout(15_000) });
    assert.ok(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.webContents.isLoadingMainFrame()),
      'The renderer must still be loading when the quit is requested');
    await closeGracefully(app, appProcess, 'quit during renderer load');
    assert.doesNotMatch(stderr.get(appProcess) ?? '', /CatPilot startup failed/);
    console.log('Electron shutdown regression passed: quitting during renderer load exits cleanly.');
  } finally {
    server.close();
    server.closeAllConnections();
  }
}

try {
  if (!process.env.CATPILOT_TEST_EXE) await checkQuitDuringLoad();
  app = await launch();
  appProcess = app.process();
  const page = await app.firstWindow();
  page.setDefaultTimeout(15_000);
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => Boolean(window.catpilot));
  await assert.rejects(page.evaluate(() => window.catpilot.copyLoginCode()), /No active GitHub sign-in code/, 'Native clipboard access requires an active sign-in code');
  const request = async value => page.evaluate(request => window.catpilot.request(request), value);
  const work = await request({ action: 'createWorkspace', name: 'Work', backend: 'sqlite' });
  const personal = await request({ action: 'createWorkspace', name: 'Personal', backend: 'markdown' });
  const record = await request({ action: 'put', workspaceId: work.id, input: recordInputSchema.parse({ domain: 'knowledge', title: 'Release plan', body: '# Ready\n\n- [ ] Ship CatPilot' }) });
  assert.equal((await request({ action: 'snapshot', workspaceId: work.id })).records[0].id, record.id);
  assert.equal((await request({ action: 'snapshot', workspaceId: personal.id })).records.length, 0);
  await assert.rejects(() => request({ action: 'put', workspaceId: work.id, id: record.id, expectedRevision: 'stale', input: recordInputSchema.parse({ domain: 'knowledge', title: 'Wrong' }) }), /changed/);
  await page.reload();
  await page.waitForFunction(() => document.body.innerText.includes('Work'));
  const text = await page.locator('body').innerText();
  assert.match(text, /CatPilot/i);
  assert.match(text, /Concepts/);
  assert.match(text, /Tasks/);
  const security = await app.evaluate(({ BrowserWindow }) => {
    const prefs = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
    return { sandbox: prefs.sandbox, contextIsolation: prefs.contextIsolation, nodeIntegration: prefs.nodeIntegration };
  });
  assert.deepEqual(security, { sandbox: true, contextIsolation: true, nodeIntegration: false });
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  assert.ok(csp?.includes("default-src 'self'"));
  const context = page.getByRole('complementary', { name: 'Context and records' });
  const closeDetails = async () => {
    const close = page.getByRole('button', { name: 'Close item', exact: true });
    if (await close.isVisible()) await close.click();
  };
  const openRecord = async name => {
    await closeDetails();
    const list = context.getByRole('button', { name: 'List', exact: true });
    if (await list.isVisible()) await list.click();
    await page.getByRole('main').getByRole('button').filter({ has: page.getByText(name, { exact: true }) }).click();
  };
  await page.getByRole('navigation').getByRole('button', { name: 'Concepts', exact: true }).click();
  await openRecord('Release plan');
  await page.getByRole('button', { name: 'Markdown', exact: true }).click();
  const source = page.getByRole('textbox', { name: 'Markdown source', exact: true });
  await source.fill('# Ready\n\nEdited through the desktop source editor.');
  await page.getByRole('button', { name: 'Save Ctrl S', exact: true }).click();
  await page.waitForFunction(async id => {
    const snapshot = await window.catpilot.request({ action: 'snapshot', workspaceId: id });
    return snapshot.records.some(r => r.body.includes('Edited through the desktop source editor.'));
  }, work.id);
  await closeDetails();
  await page.getByRole('combobox', { name: 'Switch workspace', exact: true }).selectOption(personal.id);
  await page.waitForFunction(() => document.body.innerText.includes('Markdown workspace'));
  assert.equal((await request({ action: 'snapshot', workspaceId: personal.id })).records.length, 0);

  const preservedBody = '\uFEFF' + [
    '---',
    'title: Original frontmatter title',
    'unknown:',
    '  nested: "keep: this value"',
    '  values: [one, two]',
    '---',
    '',
    '# Preserve this document',
    '',
    '<!-- Keep this comment exactly, including its  spacing. -->',
    'A [[Wiki page|custom label]] and ![[embedded-note]].',
    '{{plugin: untouched}}',
    '```dataview',
    'LIST FROM "Knowledge"',
    '```',
    '',
    'Trailing spaces stay here.  ',
    '',
  ].join('\r\n');
  const preservedRecord = await request({
    action: 'put', workspaceId: personal.id,
    input: recordInputSchema.parse({ domain: 'knowledge', title: 'Lossless Markdown regression', body: preservedBody }),
  });
  await openRecord('Lossless Markdown regression');
  assert.equal(await page.getByRole('button', { name: 'Write', exact: true }).isDisabled(), true, 'Unsupported syntax must not enter the rich editor');
  await page.getByRole('button', { name: 'Markdown', exact: true }).click();
  await source.waitFor({ state: 'visible' });
  await page.getByRole('button', { name: 'Preview Markdown', exact: true }).click();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+s' : 'Control+s');
  let preservedSaved = (await request({ action: 'snapshot', workspaceId: personal.id })).records.find(r => r.id === preservedRecord.id);
  assert.ok(preservedSaved, 'The no-op saved record must still exist');
  assert.deepEqual(Buffer.from(preservedSaved.body, 'utf8'), Buffer.from(preservedBody, 'utf8'), 'Opening source/preview and saving without edits must preserve every original Markdown byte');
  assert.equal(preservedSaved.revision, preservedRecord.revision, 'A no-op save must not create a new revision');
  await page.getByRole('textbox', { name: 'Document title', exact: true }).fill('Lossless Markdown renamed');
  await page.getByRole('button', { name: 'Save Ctrl S', exact: true }).click();
  await page.waitForFunction(async ({ workspaceId, id }) => {
    const snapshot = await window.catpilot.request({ action: 'snapshot', workspaceId });
    return snapshot.records.some(r => r.id === id && r.title === 'Lossless Markdown renamed');
  }, { workspaceId: personal.id, id: preservedRecord.id });
  preservedSaved = (await request({ action: 'snapshot', workspaceId: personal.id })).records.find(r => r.id === preservedRecord.id);
  assert.ok(preservedSaved, 'The renamed record must still exist');
  assert.deepEqual(Buffer.from(preservedSaved.body, 'utf8'), Buffer.from(preservedBody, 'utf8'), 'A title-only save must preserve BOM, CRLF, raw YAML, comments, wiki links, plugin syntax, and trailing spaces');
  assert.notEqual(preservedSaved.revision, preservedRecord.revision, 'The title-only save must actually persist a new revision');
  console.log('Electron editor regression passed: exact-byte Markdown preservation on no-op and title-only saves.');

  const richRecord = await request({
    action: 'put', workspaceId: personal.id,
    input: recordInputSchema.parse({ domain: 'knowledge', title: 'Rich editor regression', body: '# Rich document\n\nOriginal paragraph.\n' }),
  });
  await openRecord('Rich editor regression');
  await page.getByRole('button', { name: 'Write', exact: true }).click();
  const richEditor = page.getByLabel('Rich document editor', { exact: true });
  await richEditor.click();
  await richEditor.press(process.platform === 'darwin' ? 'Meta+End' : 'Control+End');
  await richEditor.press('Enter');
  await page.getByRole('button', { name: 'Bold', exact: true }).click();
  // Tiptap restores toolbar focus asynchronously; target the editor before typing.
  await richEditor.pressSequentially('Rich mode regression text');
  await page.getByRole('button', { name: 'Bold', exact: true }).click();
  await page.getByRole('button', { name: 'Markdown', exact: true }).click();
  await source.waitFor({ state: 'visible' });
  const richMarkdown = (await source.locator('.cm-line').allTextContents()).join('\n');
  assert.match(richMarkdown, /\*\*Rich mode regression text\*\*/, 'A rich bold edit must serialize to supported Markdown');
  assert.match(richMarkdown, /Original paragraph\./, 'Rich editing must retain existing document content');
  await page.getByRole('button', { name: 'Preview Markdown', exact: true }).click();
  assert.equal(await page.locator('.markdown-preview strong').innerText(), 'Rich mode regression text', 'Preview must render the rich bold edit');
  await page.getByRole('button', { name: 'Write', exact: true }).click();
  assert.equal(await richEditor.locator('strong').innerText(), 'Rich mode regression text', 'Switching back to rich editing must retain formatting');
  await page.getByRole('button', { name: 'Markdown', exact: true }).click();
  await source.waitFor({ state: 'visible' });
  assert.equal((await source.locator('.cm-line').allTextContents()).join('\n'), richMarkdown, 'Mode-only switches must not rewrite the edited Markdown');
  await page.getByRole('button', { name: 'Preview Markdown', exact: true }).click();
  // Mode switches can outlast the autosave debounce. The shortcut also works
  // when the edit is already saved and the Save button is disabled.
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+s' : 'Control+s');
  await page.waitForFunction(async ({ workspaceId, id, body }) => {
    const snapshot = await window.catpilot.request({ action: 'snapshot', workspaceId });
    return snapshot.records.some(r => r.id === id && r.body === body);
  }, { workspaceId: personal.id, id: richRecord.id, body: richMarkdown });
  const richSaved = (await request({ action: 'snapshot', workspaceId: personal.id })).records.find(r => r.id === richRecord.id);
  assert.ok(richSaved, 'The rich-edited record must still exist');
  assert.equal(richSaved.body, richMarkdown, 'The actual rich edit must persist after switching to Preview');
  assert.notEqual(richSaved.revision, richRecord.revision, 'The rich edit must create a new persisted revision');
  await page.reload();
  await page.getByRole('combobox', { name: 'Switch workspace', exact: true }).selectOption(personal.id);
  await page.getByRole('navigation').getByRole('button', { name: 'Concepts', exact: true }).click();
  await openRecord('Rich editor regression');
  assert.equal(await richEditor.locator('strong').innerText(), 'Rich mode regression text', 'The saved rich edit must survive a renderer reload into Write mode');
  console.log('Electron editor regression passed: rich bold editing, Write/Markdown/Preview mode switches, save, and reload.');

  const fixtureImage = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6f7kAAAAASUVORK5CYII=', 'base64');
  const imagePath = path.join(temp, 'local-image.png');
  await fs.writeFile(imagePath, fixtureImage);
  await app.evaluate(({ dialog }, file) => {
    globalThis.catpilotTestDialogs = { open: dialog.showOpenDialog, save: dialog.showSaveDialog };
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
  }, imagePath);
  const reference = await page.evaluate(id => window.catpilot.importAsset(id), personal.id);
  assert.match(reference, /^catpilot-asset:attachments\//);
  const assetPath = reference.slice('catpilot-asset:'.length);
  const importedAsset = await page.evaluate(({ id, path }) => window.catpilot.readAsset(id, path), { id: personal.id, path: assetPath });
  assert.equal(importedAsset.mime, 'image/png');
  assert.deepEqual(Buffer.from(importedAsset.data), fixtureImage);
  await assert.rejects(request({ action: 'addAsset', workspaceId: personal.id, asset: { path: 'bypass.png', data: '', sha256: '0'.repeat(64) } }), /native/);
  await assert.rejects(page.evaluate(id => window.catpilot.readAsset(id, '../outside'), personal.id), /unsafe/);
  await request({ action: 'put', workspaceId: personal.id, input: recordInputSchema.parse({ domain: 'knowledge', title: 'Local attachment regression', body: `![Local fixture](${reference})` }) });
  await openRecord('Local attachment regression');
  await page.getByRole('button', { name: 'Markdown', exact: true }).click();
  await page.getByRole('button', { name: 'Preview Markdown', exact: true }).click();
  await page.waitForFunction(() => {
    const image = document.querySelector('.markdown-preview img[alt="Local fixture"]');
    return image?.src.startsWith('blob:') && image.complete && image.naturalWidth === 1;
  });
  const savedImage = path.join(temp, 'exported-image.png');
  await app.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }); }, savedImage);
  assert.equal(await page.evaluate(({ id, path }) => window.catpilot.exportAsset(id, path), { id: personal.id, path: assetPath }), true);
  assert.deepEqual(await fs.readFile(savedImage), fixtureImage);
  const legacySource = path.join(temp, 'legacy-source');
  await fs.mkdir(legacySource);
  const rawLegacy = Buffer.from('\uFEFF# Legacy fixture\r\n\r\n![Original image](photo.png)\r\n<!-- Original bytes -->\r\n');
  await fs.writeFile(path.join(legacySource, 'note.md'), rawLegacy);
  await fs.writeFile(path.join(legacySource, 'photo.png'), fixtureImage);
  const migrated = await request({ action: 'createWorkspace', name: 'Legacy import fixture', backend: 'sqlite' });
  await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, legacySource);
  const preview = await page.evaluate(id => window.catpilot.importLegacy(id, true), migrated.id);
  assert.equal(preview.assets, 2);
  assert.equal(preview.sourceFiles, 2);
  assert.equal((await request({ action: 'snapshot', workspaceId: migrated.id })).records.length, 0, 'Preview must not mutate the destination');
  await page.evaluate(id => window.catpilot.importLegacy(id, false), migrated.id);
  const migratedBackup = await request({ action: 'export', workspaceId: migrated.id });
  assert.match(migratedBackup.records.find(record => record.title === 'Legacy fixture').body, /catpilot-asset:legacy-source\/photo.png/);
  assert.deepEqual(Buffer.from(migratedBackup.assets.find(asset => asset.path === 'legacy-source/note.md').data, 'base64'), rawLegacy);
  assert.deepEqual(await fs.readFile(path.join(legacySource, 'note.md')), rawLegacy);
  await app.evaluate(({ dialog }) => {
    dialog.showOpenDialog = globalThis.catpilotTestDialogs.open;
    dialog.showSaveDialog = globalThis.catpilotTestDialogs.save;
    delete globalThis.catpilotTestDialogs;
  });
  console.log('Electron migration regression passed: native attachment import/export, contained Blob images, approved legacy preview, and exact source archive.');

  await closeDetails();
  await page.getByRole('combobox', { name: 'Switch workspace', exact: true }).selectOption(work.id);
  await page.getByRole('navigation').getByRole('button', { name: /^Tasks(?: \d+)?$/ }).click();
  await page.getByRole('main').getByRole('button', { name: 'New item', exact: true }).click();
  await page.getByRole('textbox', { name: 'Document title', exact: true }).fill('Desktop smoke task');
  await page.getByRole('tab', { name: 'Properties', exact: true }).click();
  await page.getByRole('main').getByRole('combobox', { name: 'Status', exact: true }).selectOption('Done');
  await page.getByRole('button', { name: 'Create task', exact: true }).click();
  await page.waitForFunction(async id => {
    const snapshot = await window.catpilot.request({ action: 'snapshot', workspaceId: id });
    return snapshot.records.some(r => r.title === 'Desktop smoke task' && r.fields.status === 'Done');
  }, work.id);
  if (process.env.CATPILOT_TEST_LARGE) {
    const workspace = await request({ action: 'createWorkspace', name: 'Large fixture', backend: 'sqlite' });
    largeWorkspace = workspace;
    const now = new Date().toISOString();
    const records = Array.from({ length: 11_000 }, (_, i) => ({
      ...recordInputSchema.parse({
        domain: i < 10_000 ? 'tasks' : 'knowledge',
        title: `Benchmark ${i < 10_000 ? 'task' : 'note'} ${String(i).padStart(5, '0')}`,
        body: '# Synthetic fixture\n\nThis record contains no personal or repository data.',
      }),
      id: crypto.randomUUID(), created: now, updated: now, revision: crypto.randomUUID(),
    }));
    const repository = await openRepository(workspace);
    try { await repository.restore(records); }
    finally { repository.close(); }
    const snapshotStart = performance.now();
    const snapshot = await request({ action: 'snapshot', workspaceId: workspace.id });
    const snapshotMs = performance.now() - snapshotStart;
    assert.equal(snapshot.records.length, 11_000);
    await page.reload();
    const navigationStart = performance.now();
    await page.getByRole('combobox', { name: 'Switch workspace', exact: true }).selectOption(workspace.id);
    await page.getByRole('navigation').getByRole('button', { name: /^Tasks(?: \d+)?$/ }).click();
    await page.waitForFunction(() => document.body.innerText.includes('Benchmark task'));
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const navigationMs = performance.now() - navigationStart;
    const memoryMb = await app.evaluate(({ app }) => app.getAppMetrics().reduce((sum, metric) => sum + metric.memory.workingSetSize, 0) / 1024);
    console.log(`Large SQLite fixture (10,000 tasks + 1,000 notes): snapshot ${snapshotMs.toFixed(0)}ms; workspace navigation ${navigationMs.toFixed(0)}ms; process working sets ${memoryMb.toFixed(0)} MiB.`);
    assert.ok(snapshotMs < 5_000, `Large snapshot exceeded 5s: ${snapshotMs.toFixed(0)}ms`);
    assert.ok(navigationMs < 10_000, `Large navigation exceeded 10s: ${navigationMs.toFixed(0)}ms`);
    assert.ok(memoryMb < 1_024, `Large fixture exceeded 1 GiB combined working sets: ${memoryMb.toFixed(0)} MiB`);
    const pageNumber = page.getByRole('spinbutton', { name: 'Content items: page', exact: true });
    assert.equal(await pageNumber.inputValue(), '1');
    await page.getByRole('button', { name: 'Content items: next page', exact: true }).click();
    assert.equal(await pageNumber.inputValue(), '2');
    const visibleTasks = await page.getByRole('main').getByText(/^Benchmark task \d+$/).count();
    assert.ok(visibleTasks > 0 && visibleTasks <= 50, `Task page mounted ${visibleTasks} items`);
  }
  if (process.env.CATPILOT_SCREENSHOT) await page.screenshot({ path: process.env.CATPILOT_SCREENSHOT });
  if (process.env.CATPILOT_TEST_AI_STATUS) {
    const status = await page.evaluate(() => window.catpilot.aiStatus());
    assert.equal(typeof status.authenticated, 'boolean');
    assert.equal(typeof status.message, 'string');
    assert.ok(!status.message.startsWith('Copilot unavailable:'), status.message);
    console.log(`Copilot runtime readiness: ${status.authenticated ? 'authenticated' : 'not authenticated'}`);
  }
  if (process.env.CATPILOT_TEST_AI_DRAFT) {
    const live = await page.evaluate(async id => {
      const chunks = [];
      const unsubscribe = window.catpilot.onAiChunk(chunk => chunks.push(chunk));
      try {
        const draft = await window.catpilot.aiDraft(id, 'Write a short Markdown launch checklist with three items.', 'A fictional local productivity app is preparing its first release.');
        return { draft, chunks };
      } finally { unsubscribe(); }
    }, work.id);
    const { draft, chunks } = live;
    assert.ok(typeof draft === 'string' && draft.length > 20);
    assert.ok(chunks.length > 0 && chunks.every(chunk => chunk.workspaceId === work.id && typeof chunk.text === 'string'));
    assert.ok(chunks.at(-1).text.length > 20, 'The actual SDK must stream text, not only return a final response');
    console.log('Live Copilot streaming passed using synthetic, non-repository context.');
    const target = await request({ action: 'put', workspaceId: work.id, input: recordInputSchema.parse({
      domain: 'tasks', title: 'Synthetic AI edit target', body: 'Keep this fictional checklist unchanged.',
      fields: { status: 'Blocked', due: '2030-01-02', tags: ['synthetic-preserved'], preservedUnknown: { keep: true } },
    }) });
    const proposal = await page.evaluate(async ({ id, record }) => window.catpilot.aiPropose(
      id, record.id, record.revision,
      'Use catpilot_propose_record_change. Preserve the title and complete body exactly. Set only the goal field to the exact string: Ship the fictional app',
    ), { id: work.id, record: target });
    const beforeApproval = (await request({ action: 'snapshot', workspaceId: work.id })).records.find(record => record.id === target.id);
    assert.equal(beforeApproval.revision, target.revision, 'SDK proposal tools must not write records');
    assert.equal(proposal.after.fields.goal, 'Ship the fictional app');
    assert.equal(proposal.after.title, target.title);
    assert.equal(proposal.after.body, target.body);
    await assert.rejects(page.evaluate(({ workspaceId, proposalId }) => window.catpilot.aiApply(workspaceId, proposalId), { workspaceId: personal.id, proposalId: proposal.id }), /workspace/);
    const approved = await page.evaluate(({ workspaceId, proposalId }) => window.catpilot.aiApply(workspaceId, proposalId), { workspaceId: work.id, proposalId: proposal.id });
    assert.equal(approved.id, target.id);
    assert.equal(approved.fields.goal, 'Ship the fictional app');
    assert.equal(approved.fields.status, 'Blocked');
    assert.equal(approved.fields.due, '2030-01-02');
    assert.deepEqual(approved.fields.tags, ['synthetic-preserved']);
    assert.deepEqual(approved.fields.preservedUnknown, { keep: true });
    await assert.rejects(page.evaluate(({ workspaceId, proposalId }) => window.catpilot.aiApply(workspaceId, proposalId), { workspaceId: work.id, proposalId: proposal.id }), /no longer available/);
    console.log('Live scoped AI proposal passed: no write before approval, bound workspace/record, metadata preservation and single-use save.');
    await page.getByRole('combobox', { name: 'Switch workspace', exact: true }).selectOption(work.id);
    await page.getByRole('navigation').getByRole('button', { name: /^Tasks(?: \d+)?$/ }).click();
    await openRecord(target.title);
    await page.getByRole('tab', { name: 'AI assistant', exact: true }).click();
    await page.getByRole('button', { name: 'Enable AI', exact: true }).click();
    await page.getByLabel('Your instruction', { exact: true }).fill('Use catpilot_propose_record_change. Preserve the title, complete body and all other fields exactly. Set only measure to the exact string: Checklist has three items');
    await page.getByRole('button', { name: 'Propose structured edit', exact: true }).click();
    await page.getByRole('region', { name: 'Structured AI edit review', exact: true }).waitFor({ timeout: 120_000 });
    assert.equal(await page.getByRole('textbox', { name: 'After AI edit title', exact: true }).inputValue(), target.title);
    assert.equal(await page.getByRole('textbox', { name: 'After AI edit Markdown source', exact: true }).inputValue(), target.body);
    assert.equal((await request({ action: 'snapshot', workspaceId: work.id })).records.find(record => record.id === target.id).revision, approved.revision);
    await page.getByRole('button', { name: 'Approve and save AI edit', exact: true }).click();
    await page.getByText('Approved AI edit saved to workspace.', { exact: true }).waitFor();
    const uiApproved = (await request({ action: 'snapshot', workspaceId: work.id })).records.find(record => record.id === target.id);
    assert.equal(uiApproved.fields.measure, 'Checklist has three items');
    assert.equal(uiApproved.fields.goal, 'Ship the fictional app');
    assert.equal(uiApproved.fields.status, 'Blocked');
    assert.equal(uiApproved.fields.due, '2030-01-02');
    assert.deepEqual(uiApproved.fields.tags, ['synthetic-preserved']);
    assert.deepEqual(uiApproved.fields.preservedUnknown, { keep: true });
    console.log('Live Copilot UI passed: selected saved record, real structured tool, read-only review and explicit approved save.');
    if (largeWorkspace) {
      await page.getByRole('combobox', { name: 'Switch workspace', exact: true }).selectOption(largeWorkspace.id);
      await page.waitForFunction(() => document.body.innerText.includes('Benchmark task'));
    }
  }
  await closeGracefully(app, appProcess, 'initial');
  const startupStart = performance.now();
  app = await launch();
  appProcess = app.process();
  const restartedPage = await app.firstWindow();
  restartedPage.on('pageerror', error => errors.push(error.message));
  await restartedPage.waitForFunction(() => Boolean(window.catpilot));
  const persisted = await restartedPage.evaluate(id => window.catpilot.request({ action: 'snapshot', workspaceId: id }), work.id);
  assert.ok(persisted.records.some(item => item.id === record.id));
  assert.ok(persisted.records.some(item => item.title === 'Desktop smoke task' && item.fields.status === 'Done'));
  if (largeWorkspace) {
    const workspaceSwitcher = restartedPage.getByRole('combobox', { name: 'Switch workspace', exact: true });
    // The preload bridge is available before the renderer restores the workspace.
    await workspaceSwitcher.and(restartedPage.locator('select:enabled:has(option[value]:not([value=""]))')).waitFor();
    assert.equal(await workspaceSwitcher.inputValue(), largeWorkspace.id);
    await restartedPage.getByRole('navigation').getByRole('button', { name: /^Tasks(?: \d+)?$/ }).click();
    await restartedPage.waitForFunction(() => document.body.innerText.includes('Benchmark task'));
    const startupMs = performance.now() - startupStart;
    console.log(`Second process launch with the large workspace selected: ${startupMs.toFixed(0)}ms.`);
    assert.ok(startupMs < 10_000, `Large workspace startup exceeded 10s: ${startupMs.toFixed(0)}ms`);
  }
  assert.deepEqual(errors, []);
  succeeded = true;
} finally {
  if (app && appProcess) {
    if (succeeded) {
      await closeGracefully(app, appProcess, 'restarted');
    } else if (appProcess.exitCode === null && appProcess.signalCode === null) {
      // Test workspaces are disposable; dirty-state guards must not hide a test failure.
      const stopped = new Promise(resolve => appProcess.once('close', resolve));
      await app.evaluate(({ app }) => app.exit(0)).catch(error => {
        if (!/closed|exited|destroyed/i.test(error.message)) throw error;
      });
      await stopped;
    }
  }
  await fs.rm(temp, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
}
console.log('Electron smoke passed: both backends, restart/reload, conflict rejection, exact-byte Markdown preservation, rich editing, renderer and sandbox.');
