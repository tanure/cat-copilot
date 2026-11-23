import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { _electron as electron } from 'playwright';
import { WorkspaceService, recordInputSchema } from '../../../../../dist/core/index.js';

// Launch the existing Electron build with the source renderer and actual disk-backed core services.
const root = fileURLToPath(new URL('../../../../../', import.meta.url));
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'catpilot-workflows-ui-'));
const core = new WorkspaceService(path.join(temp, 'registry'));
const workspace = await core.execute({ action: 'createWorkspace', name: 'Workflow fixture', backend: 'markdown', location: path.join(temp, 'workspace') });
const other = await core.execute({ action: 'createWorkspace', name: 'Other workspace', backend: 'markdown', location: path.join(temp, 'other') });
const put = input => core.execute({ action: 'put', workspaceId: workspace.id, input: recordInputSchema.parse(input) });
const snapshot = () => core.execute({ action: 'snapshot', workspaceId: workspace.id });
const get = async id => (await snapshot()).records.find(record => record.id === id);
const prefix = '\uFEFF---\r\ncustom: untouched\r\n---\r\n';
const blocks = await put({ domain: 'knowledge', title: 'Block fixture', body: prefix + 'First paragraph\n\nSecond paragraph\n\nThird paragraph\n' });
const unsupported = await put({ domain: 'knowledge', title: 'Protected syntax', body: prefix + '<!-- keep exactly -->\r\n[[Wiki]]\r\n' });
const task = await put({ domain: 'tasks', title: 'History fixture', fields: {
  comments: Array.from({ length: 51 }, (_, index) => ({ id: `comment-${index}`, text: `Original comment ${index + 1}`, at: '2026-01-01T00:00:00.000Z', custom: index })),
  log: [{ text: 'Legacy log', date: '2026-01-01', custom: true }],
} });
const autosave = await put({ domain: 'tasks', title: 'Autosave fixture', body: 'Original body', fields: { tags: ['keep'], custom: { keep: true } } });
const historical = await put({ domain: 'pomodoro', title: 'Historical timer', body: 'Historical body stays exact.\n', fields: {
  status: 'Done', minutes: 25, started: '2026-01-01T12:00:00.000Z', completed: '2026-01-01T12:25:00.000Z', custom: 'preserve',
} });
const legacy = await put({ domain: 'pomodoro', title: 'Legacy running timer', body: 'Legacy running body.\n', fields: {
  status: 'In Progress', minutes: 25, started: new Date(Date.now() - 12_000).toISOString(), custom: 'preserve-running',
} });
let server;
let app;
let page;
let holdNextPut = false;
let rejectNextPut = false;
let releasePut;
const requests = [];
const errors = [];
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
async function until(predicate, label) {
  for (let count = 0; count < 150; count++) { if (await predicate()) return; await delay(50); }
  throw new Error('Timed out: ' + label);
}
const bridge = `
window.catpilot = {
  request: async request => {
    const response = await fetch('/__workflow-rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) });
    const result = await response.json();
    if (!result.ok) throw new Error(result.error);
    return result.value;
  },
  onAiChunk: () => () => {},
  aiCancel: async () => {}
};`;
try {
  server = await createServer({
    configFile: false, appType: 'custom', root: path.join(root, 'apps/desktop/src/renderer'), plugins: [svelte({ configFile: false })],
    cacheDir: path.join(temp, 'vite-cache'),
    optimizeDeps: { noDiscovery: true, include: [
      '@tiptap/core', '@tiptap/starter-kit', '@tiptap/markdown', '@tiptap/extension-task-list',
      '@tiptap/extension-task-item', '@tiptap/extension-table', '@tiptap/pm/state',
      '@codemirror/view', 'codemirror', '@codemirror/lang-markdown', 'marked', 'dompurify', 'zod',
    ] },
    server: { host: '127.0.0.1', port: 0, fs: { allow: [root, temp] } },
  });
  server.middlewares.use((request, response, next) => {
    if (request.url === '/__workflow.html') {
      response.setHeader('Content-Type', 'text/html');
      response.end('<!doctype html><html><head><meta charset="utf-8"></head><body><div id="app"></div><script src="/__workflow-bridge.js"></script><script type="module" src="/src/main.ts"></script></body></html>');
    } else if (request.url === '/__workflow-bridge.js') {
      response.setHeader('Content-Type', 'application/javascript'); response.end(bridge);
    } else if (request.url === '/__workflow-rpc') {
      void (async () => {
        try {
          let text = '';
          for await (const chunk of request) text += chunk;
          const value = JSON.parse(text);
          requests.push(value);
          if (value.action === 'put' && holdNextPut) {
            holdNextPut = false;
            await new Promise(resolve => { releasePut = resolve; });
            releasePut = undefined;
          }
          if (value.action === 'put' && rejectNextPut) { rejectNextPut = false; throw new Error('Temporary fixture save failure'); }
          const result = await core.execute(value);
          response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ ok: true, value: result }));
        } catch (error) {
          if (errors.length) console.error('Renderer errors:', errors);
          response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ ok: false, error: error.message }));
        }
      })();
    } else next();
  });
  await server.listen();
  const url = `http://127.0.0.1:${server.httpServer.address().port}/__workflow.html`;
  async function launch() {
    app = await electron.launch({
      args: [path.join(root, 'apps/desktop')],
      env: { ...process.env, CATPILOT_HOME: path.join(temp, 'native-registry'), CATPILOT_USER_DATA: path.join(temp, 'profile') },
      timeout: 60_000,
    });
    await app.firstWindow();
    const opened = app.waitForEvent('window');
    await app.evaluate(({ BrowserWindow }, target) => {
      const window = new BrowserWindow({ width: 1500, height: 1100, webPreferences: { sandbox: true, contextIsolation: true } });
      void window.loadURL(target);
    }, url);
    page = await opened; page.setDefaultTimeout(20_000);
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForURL(url);
    await page.waitForFunction(id => document.querySelector('[aria-label="Switch workspace"]')?.value === id, workspace.id);
  }
  const nav = () => page.getByRole('navigation');
  const context = () => page.getByRole('complementary', { name: 'Context and records' });
  async function closeDetails() {
    const close = page.getByRole('button', { name: 'Close item', exact: true });
    if (await close.isVisible()) await close.click();
  }
  async function section(name) {
    await closeDetails();
    await nav().getByRole('button', { name: name === 'Tasks' ? /^Tasks(?: \d+)?$/ : name, exact: name !== 'Tasks' }).click();
  }
  async function open(name) {
    await closeDetails();
    const list = context().getByRole('button', { name: 'List', exact: true });
    if (await list.isVisible()) await list.click();
    await page.getByRole('main').getByRole('button').filter({ has: page.getByText(name, { exact: true }) }).click();
  }
  const saveStatus = () => page.getByLabel('Document save status', { exact: true });
  await launch();

  await section('Concepts'); await open('Block fixture');
  await page.getByRole('button', { name: 'Write', exact: true }).click();
  let rich = page.getByLabel('Rich document editor', { exact: true });
  await rich.locator('p').nth(1).click();
  await page.getByRole('button', { name: 'Move current block up', exact: true }).click();
  assert.deepEqual(await rich.locator('p').allTextContents(), ['Second paragraph', 'First paragraph', 'Third paragraph']);
  await page.getByRole('button', { name: 'Move current block down', exact: true }).click();
  assert.deepEqual(await rich.locator('p').allTextContents(), ['First paragraph', 'Second paragraph', 'Third paragraph']);
  await rich.locator('p').last().click(); await rich.press('End'); await rich.press('Enter');
  await rich.pressSequentially('/head');
  await page.getByRole('listbox', { name: 'Slash block commands', exact: true }).waitFor();
  await rich.press('Enter');
  await rich.locator('h2').waitFor();
  await rich.pressSequentially('Slash inserted heading');
  await rich.locator('h2').getByText('Slash inserted heading', { exact: true }).waitFor();
  await until(async () => (await get(blocks.id)).body.includes('## Slash inserted heading'), 'slash insertion autosave');
  assert.ok((await get(blocks.id)).body.startsWith(prefix));
  await page.getByRole('button', { name: 'Add block', exact: true }).click();
  await page.getByRole('listbox', { name: 'Slash block commands', exact: true }).waitFor();
  await rich.pressSequentially('task'); await rich.press('Enter');
  await rich.pressSequentially('An inline checklist');
  const check = rich.getByRole('checkbox').first();
  const checkboxBox = await check.boundingBox();
  const itemText = await rich.locator('li[data-type="taskItem"] p').first().boundingBox();
  assert.ok(checkboxBox.width <= 20 && checkboxBox.x < itemText.x && Math.abs(checkboxBox.y - itemText.y) < 12, 'Checklist controls must align beside their text');
  await check.check();
  await until(async () => /\[x\] An inline checklist/.test((await get(blocks.id)).body), 'inline checklist insertion and toggle');
  await open('Protected syntax');
  assert.equal(await page.getByRole('button', { name: 'Write', exact: true }).isDisabled(), true);
  assert.equal((await get(unsupported.id)).body, unsupported.body);

  await section('Tasks'); await open('History fixture');
  await page.getByRole('tab', { name: 'Activity', exact: true }).click();
  await page.getByRole('button', { name: 'Task history: next page', exact: true }).click();
  await page.getByRole('button', { name: 'Edit comment 51', exact: true }).click();
  await page.getByRole('textbox', { name: 'Edit comment 51', exact: true }).fill('Edited final comment');
  await page.getByRole('button', { name: 'Save comment 51', exact: true }).click();
  await until(async () => (await get(task.id)).fields.comments[50].text === 'Edited final comment', 'saved comment edit');
  let updated = await get(task.id);
  assert.equal(updated.fields.comments[0].text, 'Original comment 1');
  assert.deepEqual(updated.fields.comments[50], { ...task.fields.comments[50], text: 'Edited final comment' });
  await page.getByRole('button', { name: 'Delete comment 51', exact: true }).click();
  assert.equal((await get(task.id)).fields.comments.length, 51);
  await page.getByRole('button', { name: 'Confirm delete comment 51', exact: true }).click();
  await until(async () => (await get(task.id)).fields.comments.length === 50, 'confirmed history deletion');
  await page.getByRole('button', { name: 'Legacy activity logs', exact: true }).click();
  await page.getByRole('button', { name: 'Edit activity log 1', exact: true }).click();
  await page.getByRole('textbox', { name: 'Edit activity log 1', exact: true }).fill('Legacy edited');
  await page.getByRole('button', { name: 'Save activity log 1', exact: true }).click();
  await until(async () => (await get(task.id)).fields.log[0].text === 'Legacy edited', 'legacy log edit');
  assert.equal((await get(task.id)).fields.log[0].date, '2026-01-01');
  await page.getByRole('button', { name: 'Comments', exact: true }).click();
  await page.getByRole('button', { name: 'Edit comment 1', exact: true }).click();
  await page.getByRole('textbox', { name: 'Edit comment 1', exact: true }).fill('Must conflict');
  updated = await get(task.id);
  await core.execute({ action: 'management', workspaceId: workspace.id, request: { action: 'comment', id: task.id, expectedRevision: updated.revision, text: 'Concurrent append' } });
  await page.getByRole('button', { name: 'Save comment 1', exact: true }).click();
  await page.getByText('This item changed in another window or process. Reload it before saving.', { exact: true }).waitFor();
  assert.equal((await get(task.id)).fields.comments[0].text, 'Original comment 1');

  await open('Autosave fixture');
  const title = page.getByRole('textbox', { name: 'Document title', exact: true });
  const writes = () => requests.filter(request => request.action === 'put' && request.id === autosave.id);
  await title.fill('Debounce first'); await delay(200); await title.fill('Debounce final'); await delay(300);
  assert.equal(writes().length, 0);
  await until(async () => (await get(autosave.id)).title === 'Debounce final', 'debounced write');
  assert.equal(writes().length, 1);
  holdNextPut = true;
  await title.fill('Submitted while typing');
  await until(() => !!releasePut, 'held save request');
  assert.equal(await saveStatus().innerText(), 'Saving...');
  assert.equal(await title.isDisabled(), false);
  await title.fill('Newer edit while saving');
  await page.getByRole('button', { name: 'Markdown', exact: true }).click();
  await page.getByRole('textbox', { name: 'Markdown source', exact: true }).fill('Body typed while save pending');
  releasePut();
  await until(async () => (await get(autosave.id)).body === 'Body typed while save pending', 'queued newer draft');
  assert.equal(await title.inputValue(), 'Newer edit while saving');
  assert.equal(await page.getByRole('textbox', { name: 'Markdown source', exact: true }).innerText(), 'Body typed while save pending');
  updated = await get(autosave.id);
  assert.deepEqual(updated.fields.tags, ['keep']); assert.deepEqual(updated.fields.custom, { keep: true });
  assert.equal(writes().length, 3);
  rejectNextPut = true; await title.fill('Retry this draft');
  await page.getByRole('button', { name: 'Retry save', exact: true }).waitFor();
  const failedCount = writes().length; await delay(1200); assert.equal(writes().length, failedCount);
  await page.getByRole('button', { name: 'Retry save', exact: true }).click();
  await until(async () => (await get(autosave.id)).title === 'Retry this draft', 'explicit retry');
  await title.fill(''); const invalidCount = writes().length; await delay(1200); assert.equal(writes().length, invalidCount);
  await title.fill('Uncommitted conflict');
  updated = await get(autosave.id);
  await core.execute({ action: 'management', workspaceId: workspace.id, request: { action: 'comment', id: autosave.id, expectedRevision: updated.revision, text: 'External revision' } });
  await page.getByRole('button', { name: 'Reload latest', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Save Ctrl S', exact: true }).isDisabled(), true);
  assert.equal((await get(autosave.id)).title, 'Retry this draft');
  const switcher = page.getByRole('combobox', { name: 'Switch workspace', exact: true });
  await switcher.selectOption(other.id);
  await page.getByRole('dialog').getByRole('button', { name: 'Discard changes', exact: true }).click();
  await switcher.selectOption(workspace.id);

  await section('Tasks');
  const beforeCreate = (await snapshot()).records.length;
  await page.getByRole('button', { name: 'New item', exact: true }).click();
  await page.getByLabel('Rich document editor', { exact: true }).waitFor();
  assert.equal(await page.getByRole('combobox', { name: 'Insert rich block', exact: true }).count(), 0);
  await page.getByRole('button', { name: 'Create task', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Title is required' }).first().waitFor();
  assert.equal(await title.evaluate(element => element === document.activeElement), true);
  await title.fill('Explicit creation fixture');
  await delay(1200);
  assert.equal((await snapshot()).records.length, beforeCreate, 'A new item must not be silently autosaved');
  await page.getByRole('button', { name: 'Create task', exact: true }).click();
  await until(async () => (await snapshot()).records.some(record => record.title === 'Explicit creation fixture'), 'title-only explicit creation');
  await context().getByRole('button', { name: 'Board', exact: true }).click();
  const openColumn = page.getByRole('region', { name: 'Open column', exact: true });
  const workingColumn = page.getByRole('region', { name: 'In Progress column', exact: true });
  const fixtureCard = column => column.locator('.task-board-open').filter({ hasText: 'Explicit creation fixture' });
  await fixtureCard(openColumn).dragTo(workingColumn.locator('h2'));
  const created = (await snapshot()).records.find(record => record.title === 'Explicit creation fixture');
  await until(async () => (await get(created.id)).fields.status === 'In Progress', 'board drag persisted');
  const boardSearch = page.getByRole('textbox', { name: 'Search current section', exact: true });
  await boardSearch.fill('Explicit creation');
  await fixtureCard(workingColumn).locator('.task-card-meta').click();
  await page.getByRole('dialog', { name: 'Edit task' }).waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('dialog', { name: 'Edit task' }).waitFor({ state: 'hidden' });
  assert.equal(await boardSearch.inputValue(), 'Explicit creation');
  assert.equal(await fixtureCard(workingColumn).evaluate(element => element === document.activeElement), true);

  const drag = await page.evaluateHandle(() => new DataTransfer());
  await fixtureCard(workingColumn).dispatchEvent('dragstart', { dataTransfer: drag });
  const moving = await get(created.id);
  await core.execute({ action: 'management', workspaceId: workspace.id, request: { action: 'comment', id: moving.id, expectedRevision: moving.revision, text: 'Updated during drag' } });
  await openColumn.dispatchEvent('drop', { dataTransfer: drag });
  await page.getByRole('alert').filter({ hasText: /changed/i }).waitFor();
  assert.equal((await get(created.id)).fields.status, 'In Progress');

  await context().getByRole('button', { name: 'Matrix', exact: true }).click();
  await page.getByRole('region', { name: 'Consider dropping', exact: true }).getByText('Explicit creation fixture', { exact: true }).waitFor();
  assert.equal((await get(created.id)).fields.importance, '');
  await context().getByRole('button', { name: 'Calendar', exact: true }).click();
  const calendar = page.getByRole('region', { name: 'Task calendar' });
  assert.equal(await calendar.locator('.calendar-cell').count(), 42);
  const monthHeading = calendar.locator('.calendar-heading h2');
  const monthBefore = await monthHeading.innerText();
  await calendar.getByRole('button', { name: 'Next month' }).click();
  const nextMonth = await monthHeading.innerText();
  assert.notEqual(nextMonth, monthBefore);
  const chosen = await calendar.locator('.calendar-day-number[aria-pressed=true]').getAttribute('aria-label');
  await calendar.getByRole('button', { name: 'New task on this day' }).click();
  await title.fill('Unsaved calendar fixture');
  await page.getByRole('tab', { name: 'Properties' }).click();
  assert.notEqual(await page.getByLabel('Due date', { exact: true }).inputValue(), '');
  await closeDetails();
  await page.getByRole('button', { name: 'Discard changes', exact: true }).click();
  assert.equal(await monthHeading.innerText(), nextMonth);
  assert.equal(await calendar.locator('.calendar-day-number[aria-pressed=true]').getAttribute('aria-label'), chosen);
  await calendar.getByRole('button', { name: 'Undated (1)' }).click();
  await calendar.getByRole('button', { name: /Explicit creation fixture/ }).waitFor();

  await context().getByRole('button', { name: 'List', exact: true }).click();
  await page.getByRole('textbox', { name: 'Search current section', exact: true }).fill('Explicit creation');
  assert.equal(await page.locator('.table-row').count(), 1);
  await section('Concepts');
  assert.equal(await context().getByRole('button', { name: 'Board', exact: true }).count(), 0);
  const folderGroup = () => context().getByRole('group', { name: 'Concept folders' });
  const folderAt = path => folderGroup().locator(`[data-folder-path="${path}"]`);
  const folderDialog = name => page.getByRole('dialog', { name, exact: true });
  async function createFolder(name, parent = '') {
    if (parent) {
      await folderAt(parent).click({ button: 'right' });
      await page.getByRole('button', { name: 'New subfolder', exact: true }).click();
    } else await folderGroup().getByRole('button', { name: 'New folder', exact: true }).click();
    const dialog = folderDialog(parent ? 'New subfolder' : 'New folder');
    await dialog.getByLabel('Folder name', { exact: true }).fill(name);
    await dialog.getByRole('button', { name: 'Create folder', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    await folderAt(parent ? `${parent}/${name}` : name).waitFor();
  }
  await createFolder('Work');
  await createFolder('Archives');
  await createFolder('Research', 'Work');
  const topFolders = await folderGroup().locator('.concept-folders > li > .folder-row').evaluateAll(rows =>
    rows.filter(row => row.style.getPropertyValue('--folder-depth') === '0').map(row => row.querySelector('[data-folder-path]').dataset.folderPath));
  assert.ok(topFolders.indexOf('Archives') < topFolders.indexOf('Work'));

  await page.getByRole('button', { name: 'New knowledge', exact: true }).click();
  await title.fill('Folder fixture');
  await page.getByRole('combobox', { name: 'Folder', exact: true }).selectOption('Work/Research');
  await page.getByRole('button', { name: 'Create note', exact: true }).click();
  await until(async () => (await snapshot()).records.some(record => record.title === 'Folder fixture'), 'concept creation');
  await closeDetails();
  await folderAt('Work').dragTo(folderAt('Archives'));
  await folderAt('Archives/Work').waitFor();
  await until(async () => (await snapshot()).records.some(record => record.title === 'Folder fixture' && record.fields.folder === 'Archives/Work/Research'), 'folder drag persisted nested concepts');
  await folderAt('Archives/Work/Research').click();
  await context().getByRole('group', { name: 'Concept kinds' }).getByRole('button', { name: 'Knowledge', exact: true }).click();
  assert.equal(await page.locator('.concept-entry').count(), 1);
  await page.getByText('Kind colors', { exact: true }).click();
  await page.getByLabel('Knowledge color', { exact: true }).selectOption('rose');
  assert.equal(await page.locator('.concept-entry .kind-badge').getAttribute('data-tone'), 'rose');
  await page.reload();
  await page.waitForFunction(id => document.querySelector('[aria-label="Switch workspace"]')?.value === id, workspace.id);
  await section('Concepts');
  await folderAt('Archives').waitFor();
  await folderAt('Archives').click({ button: 'right' });
  await page.getByRole('button', { name: 'Delete folder…', exact: true }).click();
  const deleteFolder = folderDialog('Delete folder');
  assert.ok(await deleteFolder.getByRole('radio', { name: /Keep contents/ }).isChecked());
  if (process.env.CATPILOT_FOLDER_SCREENSHOTS) await page.screenshot({ path: path.join(process.env.CATPILOT_FOLDER_SCREENSHOTS, 'desktop-delete-folder.png') });
  await deleteFolder.getByRole('button', { name: 'Delete folder', exact: true }).click();
  await deleteFolder.waitFor({ state: 'hidden' });
  await folderAt('Work').waitFor();
  await folderAt('Work').click();
  await folderAt('Work/Research').waitFor();
  await until(async () => (await snapshot()).records.some(record => record.title === 'Folder fixture' && record.fields.folder === 'Work/Research'), 'keep preserves and promotes contents');
  await folderAt('Work/Research').click();
  assert.equal(await page.locator('.concept-entry').filter({ hasText: 'Folder fixture' }).locator('.kind-badge').getAttribute('data-tone'), 'rose');
  await folderGroup().getByRole('button', { name: 'Actions for Work/Research', exact: true }).click();
  await page.getByRole('button', { name: 'Delete folder…', exact: true }).click();
  await deleteFolder.getByRole('radio', { name: /Delete everything inside/ }).check();
  await deleteFolder.getByRole('button', { name: 'Delete folder and contents', exact: true }).click();
  await deleteFolder.waitFor({ state: 'hidden' });
  assert.equal((await snapshot()).records.some(record => record.title === 'Folder fixture'), false);

  await section('Journal');
  assert.equal(await context().count(), 0, 'An empty Journal has no browse sidebar');
  await page.getByLabel('New journal entry date').fill('2024-02-29');
  await page.getByRole('button', { name: 'Write entry', exact: true }).click();
  const journalEditor = page.getByLabel('Rich document editor', { exact: true });
  await journalEditor.fill('Leap-day reflection');
  await page.getByRole('button', { name: 'Create entry', exact: true }).click();
  await until(async () => (await snapshot()).records.some(record => record.domain === 'journal' && record.fields.date === '2024-02-29'), 'dated journal entry');
  await closeDetails();
  await page.locator('.journal-entry').filter({ hasText: 'Leap-day reflection' }).click();
  await journalEditor.fill('Updated leap-day reflection');
  await page.getByRole('button', { name: 'Save Ctrl S', exact: true }).click();
  await until(async () => (await snapshot()).records.some(record => record.body.includes('Updated leap-day reflection')), 'journal edit');
  await closeDetails();
  assert.equal(await page.locator('.history-day h2 time').getAttribute('datetime'), '2024-02-29');
  await context().getByRole('button', { name: 'February 2024', exact: true }).click();
  assert.equal(await context().getByRole('button', { name: 'February 2024', exact: true }).getAttribute('aria-pressed'), 'true');
  await page.locator('.journal-entry').filter({ hasText: 'Updated leap-day reflection' }).waitFor();
  await section('Timeline');
  assert.equal(await context().count(), 0, 'Timeline uses inline filters, not a placeholder sidebar');
  await page.getByLabel('Filter activity by kind').selectOption('journal');
  await page.locator('.recorded-event').first().waitFor();
  const journalActivity = await page.locator('.recorded-event').allTextContents();
  assert.equal(journalActivity.length, 2);
  assert.ok(journalActivity.some(event => event.includes('Last updated')));
  assert.notEqual(await page.locator('.history-day h2 time').first().getAttribute('datetime'), '2024-02-29');

  await section('Projects');
  assert.equal(await context().getByRole('button', { name: 'Calendar', exact: true }).count(), 0);
  const project = await core.execute({ action: 'put', workspaceId: workspace.id, input: { domain: 'projects', title: 'Linked portfolio project', fields: { goal: 'Ship the linked work' } } });
  await core.execute({ action: 'put', workspaceId: workspace.id, input: { domain: 'milestones', title: 'Next portfolio milestone', fields: { project: project.id, due: '2030-01-02', status: 'Blocked' } } });
  const summary = page.locator('.project-summary').filter({ hasText: project.title });
  await summary.getByText('Next portfolio milestone', { exact: false }).waitFor();
  await summary.getByText('1 blocked', { exact: true }).waitFor();
  await context().getByRole('group', { name: 'Project status' }).getByRole('button', { name: 'Open', exact: true }).click();
  await summary.waitFor();
  assert.equal(await page.getByRole('combobox', { name: 'Filter by folder' }).count(), 0);
  await open('Linked portfolio project');
  await page.getByRole('tab', { name: 'Properties', exact: true }).click();
  assert.equal(await page.getByLabel('Folder', { exact: true }).count(), 0);
  await closeDetails();
  await section('Achievements');
  await core.execute({ action: 'put', workspaceId: workspace.id, input: { domain: 'achievements', title: 'Archived win', fields: { completed: '2024-03-01T12:00:00Z' } } });
  await core.execute({ action: 'put', workspaceId: workspace.id, input: { domain: 'achievements', title: 'Another win', fields: { completed: '2025-03-01T12:00:00Z' } } });
  await context().getByRole('group', { name: 'Achievement years' }).getByRole('button', { name: '2024', exact: true }).click();
  assert.equal(await page.locator('.table-row').count(), 1);
  assert.equal(await page.getByRole('combobox', { name: 'Filter by folder' }).count(), 0);
  await page.getByRole('button', { name: 'Archived win', exact: true }).click();
  await page.getByRole('tab', { name: 'Properties', exact: true }).click();
  assert.equal(await page.getByLabel('Folder', { exact: true }).count(), 0);

  await section('Focus');
  assert.equal(await context().count(), 0);
  const timer = () => page.getByRole('region', { name: 'Persisted Focus timer', exact: true });
  await timer().getByRole('heading', { name: 'Legacy running timer', exact: true }).waitFor();
  assert.deepEqual(await get(legacy.id), legacy);
  assert.deepEqual(await get(historical.id), historical);
  const firstRemaining = (await page.getByLabel('Focus time remaining', { exact: true }).innerText()).split(':').reduce((minutes, seconds) => minutes * 60 + Number(seconds), 0);
  const previousProcess = app.process();
  await app.close(); app = undefined;
  assert.notEqual(previousProcess.exitCode, null);
  await launch(); await section('Focus');
  await timer().getByRole('heading', { name: 'Legacy running timer', exact: true }).waitFor();
  const restoredRemaining = (await page.getByLabel('Focus time remaining', { exact: true }).innerText()).split(':').reduce((minutes, seconds) => minutes * 60 + Number(seconds), 0);
  assert.ok(restoredRemaining <= firstRemaining && restoredRemaining > firstRemaining - 30);
  assert.deepEqual(await get(legacy.id), legacy);
  await timer().locator('.focus-notes summary').click();
  await page.getByRole('textbox', { name: 'Focus completion notes', exact: true }).fill('Finished after actual process restart');
  await page.getByRole('button', { name: 'Complete focus session', exact: true }).click();
  await until(async () => (await get(legacy.id)).fields.timerState === 'completed', 'canonical completion');
  const finished = await get(legacy.id);
  assert.equal(finished.body, legacy.body); assert.equal(finished.fields.custom, 'preserve-running');
  assert.equal(finished.fields.status, 'Done'); assert.ok(finished.fields.elapsedSec >= 12);
  // Persistence can finish before the renderer clears the Focus action's busy state.
  await timer().getByRole('button', { name: 'Start focus session', exact: true })
    .and(page.locator(':enabled')).waitFor();
  await section('Tasks'); await open('Explicit creation fixture');
  await page.getByRole('button', { name: 'Focus on this task', exact: true }).click();
  const picker = page.locator('.focus-task-picker');
  assert.equal(await picker.getByRole('checkbox', { name: created.title, exact: true }).isChecked(), true);
  await picker.getByRole('searchbox').fill('History fixture');
  await picker.getByRole('checkbox', { name: 'History fixture', exact: true }).check();
  await page.getByRole('textbox', { name: 'Session purpose', exact: true }).fill('New canonical session');
  await page.getByRole('spinbutton', { name: 'Focus duration minutes', exact: true }).fill('1');
  await page.getByRole('button', { name: 'Start focus session', exact: true }).click();
  await timer().getByRole('heading', { name: 'New canonical session', exact: true }).waitFor();
  const active = (await snapshot()).records.find(record => record.title === 'New canonical session');
  assert.notEqual(active.id, legacy.id); assert.equal(active.fields.minutes, 1); assert.equal(active.fields.type, 'focus');
  assert.deepEqual(active.fields.focusTasks, [created.id, task.id]);
  assert.equal(active.fields.focusPurpose, 'New canonical session');
  await timer().getByRole('list', { name: 'Session tasks' }).getByText(created.title, { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Cancel focus session', exact: true }).click();
  await until(async () => (await get(active.id)).fields.timerState === 'cancelled', 'canonical cancellation');
  assert.equal((await get(active.id)).fields.status, 'Blocked');
  await page.getByRole('region', { name: 'Session history' }).getByRole('button', { name: /New canonical session.*Cancelled/ }).waitFor();
  assert.equal((await get(created.id)).fields.status, 'In Progress');
  await timer().getByRole('button', { name: 'Short break', exact: true }).click();
  assert.equal(await timer().getByRole('spinbutton', { name: 'Focus duration minutes' }).inputValue(), '5');
  await timer().getByRole('button', { name: 'Start break', exact: true }).click();
  await timer().getByRole('heading', { name: 'Short break', exact: true }).first().waitFor();
  await timer().getByRole('button', { name: 'Complete focus session', exact: true }).click();
  await until(async () => (await snapshot()).records.some(record => record.title === 'Short break' && record.fields.timerState === 'completed'), 'optional purpose and tasks for breaks');
  assert.deepEqual(await get(historical.id), historical);
  assert.deepEqual(errors, []);
  console.log('Workflows UI passed: direct writing, slash/inline block insertion, aligned toggleable checklists and exact frontmatter; paged comment/log CAS edit/delete; explicit title-only creation, validation and no premature autosave; collection views/filters across sections; debounced existing-item save, held-save edits, retry/invalid/conflict guards; Focus start/complete/cancel and legacy hydration across an actual process restart.');
} catch (error) {
  if (page && !page.isClosed()) console.error('Workflow fixture state:', (await page.locator('body').innerText()).slice(0, 1700));
  throw error;
} finally {
  releasePut?.();
  if (app) await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  if (server) await server.close();
  await fs.rm(temp, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
}
