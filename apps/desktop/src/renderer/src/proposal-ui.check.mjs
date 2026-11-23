import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { _electron as electron } from 'playwright';
import { defaultFields } from './document.ts';

// Serve the current renderer without rebuilding the desktop parent is integrating.
// The controlled bridge tests UI authorization/lifecycle, not SDK or native token storage.
const root = fileURLToPath(new URL('../../../../../', import.meta.url));
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'catpilot-proposal-ui-'));
const timestamp = new Date().toISOString();
const initial = {
  workspaces: [
    { id: 'workspace-a', name: 'Proposal A', backend: 'sqlite', location: temp },
    { id: 'workspace-b', name: 'Proposal B', backend: 'markdown', location: temp },
  ],
  records: [
    { id: 'target-task', domain: 'tasks', title: 'Target task', body: 'Original source\n',
      fields: { ...defaultFields(), status: 'In Progress', due: '2026-12-10', tags: ['preserve-tag'], custom: { keep: true } },
      revision: 'r1', created: timestamp, updated: timestamp },
    { id: 'other-task', domain: 'tasks', title: 'Other task', body: 'Other source',
      fields: defaultFields(), revision: 'r2', created: timestamp, updated: timestamp },
  ],
};

function install(data) {
  const state = window.__proposalTest = {
    ...data, revision: 1, proposal: null, held: [], mode: 'normal', proposeCalls: [], applyCalls: [], cancels: 0,
    authenticated: false, copies: 0, modelCalls: 0, models: [{ id: 'test-model', name: 'Test model' }],
    modelError: false, copyError: false, loginError: false, finishLogin: null,
  };
  const clone = value => structuredClone(value);
  window.catpilot = {
    request: async request => {
      if (request.action === 'listWorkspaces') return clone(state.workspaces);
      if (request.action === 'snapshot') return {
        records: request.workspaceId === 'workspace-a' ? clone(state.records) : [], revision: String(state.revision),
      };
      throw new Error('Unexpected request: ' + request.action);
    },
    aiStatus: async () => ({ authenticated: state.authenticated, message: state.authenticated ? 'Synthetic connected account' : 'Sign in with GitHub' }),
    aiModels: async () => {
      state.modelCalls++;
      if (state.modelError) throw new Error('Synthetic model discovery failure');
      return clone(state.models);
    },
    aiLogin: async begin => {
      if (state.loginError) throw new Error('Synthetic login failure');
      if (begin) return { complete: false, code: 'ABCD-EFGH', url: 'https://github.com/login/device', message: 'Authorize this device in your browser.' };
      return new Promise(resolve => { state.finishLogin = () => resolve({ complete: true, message: 'Connected' }); });
    },
    copyLoginCode: async () => { if (state.copyError) throw new Error('Clipboard unavailable'); state.copies++; },
    onAiChunk: () => () => {},
    aiCancel: async () => { state.cancels++; state.proposal = null; },
    aiPropose: async (workspaceId, recordId, expectedRevision, prompt, model) => {
      state.proposeCalls.push({ workspaceId, recordId, expectedRevision, prompt, model });
      if (state.mode === 'reject') throw new Error('Synthetic proposal error');
      const record = state.records.find(item => item.id === recordId);
      const before = { domain: record.domain, title: record.title, body: record.body, fields: clone(record.fields) };
      const proposal = {
        id: 'token-' + state.proposeCalls.length, workspaceId, recordId, expectedRevision, before,
        after: { ...clone(before), title: record.title + ' revised', body: '# Structured replacement\n',
          fields: { ...clone(record.fields), goal: 'Ship scoped change', measure: 'Five checks', importance: 'High' } },
      };
      if (state.mode === 'mismatch') proposal.workspaceId = 'workspace-b';
      state.proposal = clone(proposal);
      if (state.mode === 'held') return new Promise(resolve => state.held.push(() => resolve(clone(proposal))));
      return clone(proposal);
    },
    aiApply: async (workspaceId, proposalId) => {
      state.applyCalls.push({ workspaceId, proposalId });
      const proposal = state.proposal;
      state.proposal = null;
      if (state.mode === 'apply-reject') throw new Error('Synthetic stale revision');
      if (!proposal || proposal.id !== proposalId || proposal.workspaceId !== workspaceId) throw new Error('Invalid approval token');
      const old = state.records.find(item => item.id === proposal.recordId);
      if (old.revision !== proposal.expectedRevision) throw new Error('Stale revision');
      const saved = { ...old, ...clone(proposal.after), revision: 'saved-' + state.applyCalls.length };
      state.records = state.records.map(item => item.id === saved.id ? saved : item);
      state.revision++;
      return clone(saved);
    },
  };
}

let server;
let app;
let page;
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
    if (request.url === '/__proposal-fixture.html') {
      response.setHeader('Content-Type', 'text/html');
      response.end('<!doctype html><html><head><meta charset="utf-8"></head><body><div id="app"></div><script src="/__proposal-bridge.js"></script><script type="module" src="/src/main.ts"></script></body></html>');
    } else if (request.url === '/__proposal-bridge.js') {
      response.setHeader('Content-Type', 'application/javascript');
      response.end('(' + install.toString() + ')(' + JSON.stringify(initial) + ');');
    } else next();
  });
  await server.listen();
  const url = `http://127.0.0.1:${server.httpServer.address().port}/__proposal-fixture.html`;
  app = await electron.launch({
    args: [path.join(root, 'apps/desktop')],
    env: { ...process.env, CATPILOT_HOME: path.join(temp, 'registry'), CATPILOT_USER_DATA: path.join(temp, 'profile') },
    timeout: 60_000,
  });
  await app.firstWindow();
  const opened = app.waitForEvent('window');
  await app.evaluate(({ BrowserWindow }, target) => {
    const window = new BrowserWindow({ width: 1500, height: 1100, webPreferences: { sandbox: true, contextIsolation: true } });
    void window.loadURL(target);
  }, url);
  page = await opened;
  page.setDefaultTimeout(20_000);
  await page.waitForURL(url);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const nav = page.getByRole('navigation');
  const context = page.getByRole('complementary', { name: 'Context and records' });
  const switcher = page.getByRole('combobox', { name: 'Switch workspace', exact: true });
  const title = page.getByRole('textbox', { name: 'Document title', exact: true });
  const prompt = page.getByLabel('Your instruction', { exact: true });
  const propose = page.getByRole('button', { name: 'Propose structured edit', exact: true });
  const review = page.getByRole('region', { name: 'Structured AI edit review', exact: true });
  const openTarget = async () => {
    await page.waitForFunction(() => document.querySelector('[aria-label="Switch workspace"]')?.value === 'workspace-a');
    await nav.getByRole('button', { name: /^Tasks(?: \d+)?$/ }).click();
    await page.getByRole('main').getByRole('button', { name: 'Target task', exact: true }).click();
    await page.getByRole('tab', { name: 'AI assistant', exact: true }).click();
  };
  const openItem = async name => {
    await context.getByRole('button', { name: 'List', exact: true }).click();
    await page.getByRole('main').getByRole('button', { name, exact: true }).click();
    await page.getByRole('tab', { name: 'AI assistant', exact: true }).click();
  };
  const mode = value => page.evaluate(value => window.__proposalTest.mode = value, value);
  const agents = async () => {
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await context.getByRole('button', { name: 'Agents', exact: true }).click();
    await page.getByRole('button', { name: 'Refresh connection', exact: true }).waitFor();
  };
  const signIn = page.getByRole('button', { name: 'Sign in with GitHub', exact: true });
  const models = page.getByRole('combobox', { name: 'AI model', exact: true });
  await agents();
  await signIn.click();
  await page.getByLabel('GitHub device code', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('GitHub device code', { exact: true }).evaluate(element => element.tagName), 'OUTPUT');
  await page.getByText('Code copied to clipboard.', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.__proposalTest.copies), 1);
  assert.equal(await signIn.count(), 0);
  await page.getByRole('button', { name: 'Copy code', exact: true }).click();
  assert.equal(await page.evaluate(() => window.__proposalTest.copies), 2);
  await page.waitForFunction(() => typeof window.__proposalTest.finishLogin === 'function');
  if (process.env.CATPILOT_DESIGN_SCREENSHOTS) await page.screenshot({ path: path.join(process.env.CATPILOT_DESIGN_SCREENSHOTS, 'catpilot-device-authorization.png') });
  await page.evaluate(() => { window.__proposalTest.authenticated = true; window.__proposalTest.finishLogin(); });
  await page.getByText('GitHub connected. Available AI models are ready.', { exact: true }).waitFor();
  assert.equal(await signIn.count(), 0);
  assert.equal(await page.getByLabel('GitHub device code', { exact: true }).count(), 0);
  await models.selectOption('test-model');
  assert.ok(await page.evaluate(() => window.__proposalTest.modelCalls > 0));
  await page.evaluate(() => window.__proposalTest.models = [{ id: 'fresh-model', name: 'Fresh model' }]);
  await page.getByRole('button', { name: 'Refresh models', exact: true }).click();
  await models.selectOption('fresh-model');
  await page.evaluate(() => window.__proposalTest.modelError = true);
  await page.getByRole('button', { name: 'Refresh connection', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Synthetic model discovery failure' }).waitFor();
  assert.equal(await signIn.count(), 0, 'Model errors must not falsely disconnect an authenticated account');
  await page.evaluate(() => { window.__proposalTest.authenticated = false; window.__proposalTest.modelError = false; window.__proposalTest.copyError = true; });
  await page.getByRole('button', { name: 'Refresh connection', exact: true }).click();
  await signIn.click();
  await page.getByText(/Could not copy the code: Clipboard unavailable/).waitFor();
  await page.waitForFunction(() => typeof window.__proposalTest.finishLogin === 'function');
  const modelCalls = await page.evaluate(() => window.__proposalTest.modelCalls);
  await page.getByRole('button', { name: 'Cancel AI operation', exact: true }).click();
  await signIn.waitFor();
  await page.evaluate(() => window.__proposalTest.finishLogin());
  assert.equal(await page.getByLabel('GitHub device code', { exact: true }).count(), 0);
  assert.equal(await page.evaluate(() => window.__proposalTest.modelCalls), modelCalls, 'Cancelled login must not refresh models on late completion');
  await page.evaluate(() => window.__proposalTest.loginError = true);
  await signIn.click();
  await page.getByRole('alert').filter({ hasText: 'Synthetic login failure' }).waitFor();
  assert.equal(await signIn.isEnabled(), true);
  await page.evaluate(() => {
    Object.assign(window.__proposalTest, { authenticated: true, loginError: false, copyError: false, cancels: 0, models: [{ id: 'test-model', name: 'Test model' }] });
  });
  await page.getByRole('button', { name: 'Refresh connection', exact: true }).click();
  await models.selectOption('test-model');
  if (process.env.CATPILOT_DESIGN_SCREENSHOTS) await page.screenshot({ path: path.join(process.env.CATPILOT_DESIGN_SCREENSHOTS, 'catpilot-connected-models.png') });
  console.log('Authentication UI passed: automatic/manual code copy, label-only code, automatic completion and models, refreshable selection, preserved connection on model error, clipboard fallback, cancellation/late completion and login-error recovery.');
  await openTarget();
  await page.getByRole('button', { name: 'Enable AI', exact: true }).click();
  await page.getByRole('button', { name: 'Refresh models', exact: true }).click();
  await page.getByRole('combobox', { name: 'AI model', exact: true }).selectOption('test-model');
  await prompt.fill('Improve the SMART goal');
  await title.fill('Unsaved local title');
  assert.equal(await propose.isDisabled(), true);
  assert.equal(await page.evaluate(() => window.__proposalTest.proposeCalls.length), 0);
  await title.fill('Target task');
  await propose.click();
  await review.waitFor();
  assert.equal(await page.getByRole('textbox', { name: 'Before AI edit title', exact: true }).inputValue(), 'Target task');
  assert.equal(await page.getByRole('textbox', { name: 'After AI edit title', exact: true }).inputValue(), 'Target task revised');
  assert.equal(await page.getByRole('textbox', { name: 'After AI edit Markdown source', exact: true }).getAttribute('readonly'), '');
  await review.getByRole('rowheader', { name: 'SMART goal', exact: true }).waitFor();
  await review.getByRole('rowheader', { name: 'SMART measure', exact: true }).waitFor();
  assert.equal(await review.getByRole('rowheader', { name: 'Status', exact: true }).count(), 0);
  assert.equal(await page.evaluate(() => window.__proposalTest.applyCalls.length), 0);
  assert.equal(await title.inputValue(), 'Target task');
  assert.deepEqual(await page.evaluate(() => window.__proposalTest.proposeCalls[0]), {
    workspaceId: 'workspace-a', recordId: 'target-task', expectedRevision: 'r1', prompt: 'Improve the SMART goal', model: 'test-model',
  });
  await page.getByRole('button', { name: 'Discard AI edit', exact: true }).click();
  await review.waitFor({ state: 'detached' });
  assert.equal(await page.evaluate(() => window.__proposalTest.proposal), null);

  await mode('held');
  await propose.click();
  await title.fill('Edited while proposing');
  await page.waitForFunction(() => window.__proposalTest.cancels >= 2);
  await page.evaluate(() => window.__proposalTest.held.shift()());
  assert.equal(await review.count(), 0);
  await title.fill('Target task');
  await mode('normal');
  await propose.click();
  await review.waitFor();
  await openItem('Other task');
  await page.waitForFunction(() => window.__proposalTest.proposal === null);
  assert.equal(await review.count(), 0);
  await openItem('Target task');
  await prompt.fill('Review only target');
  await mode('held');
  await propose.click();
  await switcher.selectOption('workspace-b');
  await page.evaluate(() => window.__proposalTest.held.shift()());
  assert.equal(await review.count(), 0);
  await switcher.selectOption('workspace-a');
  await openTarget();
  await prompt.fill('Review scoped metadata');

  await mode('mismatch');
  await propose.click();
  await page.getByText('The saved record changed or the proposal does not match this selection. Reload and request a new proposal.', { exact: true }).waitFor();
  assert.equal(await review.count(), 0);
  await page.waitForFunction(() => window.__proposalTest.proposal === null);
  await mode('reject');
  await propose.click();
  await page.getByText('Synthetic proposal error', { exact: true }).waitFor();
  assert.equal(await review.count(), 0);
  await mode('normal');
  await propose.click();
  await review.waitFor();
  await page.evaluate(() => { window.__proposalTest.records[0].revision = 'external-r2'; window.__proposalTest.revision++; });
  await review.waitFor({ state: 'detached' });
  assert.equal(await propose.isDisabled(), true);
  await page.reload();
  await page.evaluate(() => window.__proposalTest.authenticated = true);
  await openTarget();
  await page.getByRole('button', { name: 'Enable AI', exact: true }).click();
  await prompt.fill('Approve scoped metadata');
  await propose.click();
  await review.waitFor();
  await page.getByRole('button', { name: 'Approve and save AI edit', exact: true }).click();
  await page.getByText('Approved AI edit saved to workspace.', { exact: true }).waitFor();
  assert.equal(await title.inputValue(), 'Target task revised');
  assert.equal(await review.count(), 0);
  const saved = await page.evaluate(() => window.__proposalTest.records[0]);
  assert.equal(saved.fields.goal, 'Ship scoped change');
  assert.equal(saved.fields.status, 'In Progress');
  assert.equal(saved.fields.due, '2026-12-10');
  assert.deepEqual(saved.fields.tags, ['preserve-tag']);
  assert.deepEqual(saved.fields.custom, { keep: true });
  assert.deepEqual(await page.evaluate(() => window.__proposalTest.applyCalls[0]), { workspaceId: 'workspace-a', proposalId: 'token-1' });
  await page.getByRole('tab', { name: 'Properties', exact: true }).click();
  assert.equal(await page.getByRole('main').getByRole('combobox', { name: 'Status', exact: true }).inputValue(), 'In Progress');
  await page.getByRole('tab', { name: 'AI assistant', exact: true }).click();
  assert.equal(await page.getByText('A recovery draft is available. The saved record is still untouched.', { exact: false }).count(), 0);
  await propose.click();
  await review.waitFor();
  await mode('apply-reject');
  await page.getByRole('button', { name: 'Approve and save AI edit', exact: true }).click();
  await page.getByText('Synthetic stale revision', { exact: true }).waitFor();
  assert.equal(await review.count(), 0);
  assert.equal(await title.inputValue(), 'Target task revised');
  assert.deepEqual(errors, []);
  console.log('Proposal UI passed: read-only SMART review; dirty/stale/scope/late/error guards; explicit token approval; status/due/tags preservation. Controlled bridge; no desktop build.');
} catch (error) {
  if (page) console.error('Proposal UI fixture state:', page.url(), (await page.locator('body').innerText()).slice(0, 1200));
  throw error;
} finally {
  if (app) await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  if (server) await server.close();
  await fs.rm(temp, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
}
