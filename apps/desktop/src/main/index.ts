import { app, BrowserWindow, clipboard, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron';
import { Worker } from 'node:worker_threads';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { backupSchema, recordInputSchema, requestSchema, type Backup, type Request, type Snapshot } from '../../../../dist/core/types.js';
import { aiChangeSchema, type AiProposal } from '../../../../dist/core/ai.js';
import { atomicWrite } from '../../../../dist/core/files.js';
import { CopilotProvider } from './provider.js';
import { randomUUID } from 'node:crypto';
import { WorkspaceRegistry } from '../../../../dist/core/index.js';
import { legacyBackup } from '../../../../dist/core/legacy.js';
import { assetParts, digest } from '../../../../dist/core/assets.js';

const here = path.dirname(fileURLToPath(import.meta.url));
let window: BrowserWindow | null = null;
let worker: Worker | undefined;
let provider: CopilotProvider | undefined;
let sequence = 0;
const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
const approvedDirectories = new Set<string>();
let preview: { workspaceId: string; backup: Backup } | undefined;
let rendererUrl = '';
let aiProposal: AiProposal | undefined;
let loginCode = '';
let loginGeneration = 0;
const traceQuit = process.env.CATPILOT_TRACE_QUIT === '1';
function quitTrace(stage: string) {
  if (traceQuit) process.stderr.write(`[quit app pid=${process.pid}] ${stage}\n`);
}

if (traceQuit) {
  app.on('before-quit', () => quitTrace('before-quit'));
  app.on('quit', (_event, code) => quitTrace(`quit code=${code}`));
  process.on('exit', code => quitTrace(`node exit code=${code}`));
}

function trusted(event: IpcMainInvokeEvent) {
  if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame?.url !== rendererUrl) throw new Error('Untrusted application frame.');
}
function handle(channel: string, callback: (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>) {
  ipcMain.handle(channel, async (event, ...args: unknown[]) => {
    try { trusted(event); return { ok: true, value: await callback(event, ...args) }; }
    catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
  });
}
function execute(request: Request): Promise<unknown> {
  if (!worker) return Promise.reject(new Error('Storage service is unavailable. Restart CatPilot.'));
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    worker!.postMessage({ id, request });
  });
}
function failPending(error: Error) {
  for (const item of pending.values()) item.reject(error);
  pending.clear();
}

function registerHandlers() {
  handle('catpilot:request', async (_event, raw) => {
    const request = requestSchema.parse(raw);
    if (request.action === 'createWorkspace' && request.location && !approvedDirectories.has(request.location)) throw new Error('Select a workspace directory using the native folder picker.');
    if (request.action === 'import' || request.action === 'addAsset') throw new Error('Use the native import preview or attachment picker.');
    return execute(request);
  });
  handle('catpilot:directory', async () => {
    const result = await dialog.showOpenDialog(window!, { properties: ['openDirectory', 'createDirectory'], title: 'Choose workspace directory' });
    const directory = result.canceled ? null : result.filePaths[0];
    if (directory) approvedDirectories.add(directory);
    return directory;
  });
  handle('catpilot:export', async (_event, rawId) => {
    const workspaceId = z.uuid().parse(rawId);
    const result = await dialog.showSaveDialog(window!, { defaultPath: 'catpilot-backup.json', filters: [{ name: 'CatPilot backup', extensions: ['json'] }] });
    if (result.canceled || !result.filePath) return false;
    const backup = await execute({ action: 'export', workspaceId });
    await atomicWrite(result.filePath, JSON.stringify(backup, null, 2) + '\n');
    return true;
  });
  handle('catpilot:import', async (_event, rawId, rawPreview) => {
    const workspaceId = z.uuid().parse(rawId);
    const previewOnly = z.boolean().parse(rawPreview);
    if (previewOnly) {
      preview = undefined;
      const result = await dialog.showOpenDialog(window!, { properties: ['openFile'], filters: [{ name: 'CatPilot backup', extensions: ['json'] }] });
      if (result.canceled) return null;
      if ((await fs.stat(result.filePaths[0])).size > 250_000_000) throw new Error('Backup exceeds the 250 MB JSON import limit.');
      const backup = backupSchema.parse(JSON.parse(await fs.readFile(result.filePaths[0], 'utf8')));
      const summary = await execute({ action: 'previewImport', backup });
      preview = { workspaceId, backup };
      return summary;
    }
    if (!preview || preview.workspaceId !== workspaceId) throw new Error('Preview the import for this workspace first.');
    const approved = preview;
    const result = await execute({ action: 'import', workspaceId, backup: approved.backup, approved: true });
    if (preview === approved) preview = undefined;
    return result;
  });
  handle('catpilot:legacy', async (_event, rawId, rawPreview) => {
    const workspaceId = z.uuid().parse(rawId);
    if (z.boolean().parse(rawPreview)) {
      preview = undefined;
      const selected = await dialog.showOpenDialog(window!, { title: 'Preview legacy Markdown vault import (originals are unchanged)', properties: ['openDirectory'] });
      if (selected.canceled) return null;
      const workspace = await new WorkspaceRegistry().get(workspaceId);
      const source = await legacyBackup(selected.filePaths[0], workspace);
      const summary = await execute({ action: 'previewImport', backup: source.backup });
      preview = { workspaceId, backup: source.backup };
      return { ...(summary as object), warnings: source.warnings, sourceFiles: source.sourceFiles };
    }
    if (!preview || preview.workspaceId !== workspaceId) throw new Error('Preview this vault import first.');
    const approved = preview;
    const result = await execute({ action: 'import', workspaceId, backup: approved.backup, approved: true });
    if (preview === approved) preview = undefined;
    return result;
  });
  handle('catpilot:asset-import', async (_event, rawId) => {
    const workspaceId = z.uuid().parse(rawId);
    const selected = await dialog.showOpenDialog(window!, { title: 'Import workspace attachment', properties: ['openFile'] });
    if (selected.canceled) return null;
    if ((await fs.stat(selected.filePaths[0])).size > 20_000_000) throw new Error('Attachment exceeds 20 MB.');
    const bytes = await fs.readFile(selected.filePaths[0]);
    return execute({ action: 'addAsset', workspaceId, asset: {
      path: `attachments/${randomUUID()}-${path.basename(selected.filePaths[0])}`,
      data: bytes.toString('base64'), sha256: digest(bytes),
    } });
  });
  handle('catpilot:asset-read', async (_event, rawId, rawPath) => execute({
    action: 'readAsset', workspaceId: z.uuid().parse(rawId), path: z.string().max(1000).parse(rawPath),
  }));
  handle('catpilot:asset-export', async (_event, rawId, rawPath) => {
    const workspaceId = z.uuid().parse(rawId), relative = z.string().max(1000).parse(rawPath);
    const parts = assetParts(relative);
    const selected = await dialog.showSaveDialog(window!, { title: 'Save workspace attachment', defaultPath: parts.at(-1) });
    if (selected.canceled || !selected.filePath) return false;
    const asset = await execute({ action: 'readAsset', workspaceId, path: relative }) as { data: Uint8Array };
    await atomicWrite(selected.filePath, asset.data);
    return true;
  });
  handle('catpilot:ai-status', async () => provider!.status());
  handle('catpilot:ai-models', async () => provider!.models());
  handle('catpilot:ai-login', async (_event, rawBegin) => {
    const begin = z.boolean().parse(rawBegin);
    if (begin) { loginCode = ''; loginGeneration++; }
    const generation = loginGeneration;
    const result = await provider!.login(begin);
    if (generation === loginGeneration) {
      if (result.complete) loginCode = '';
      else if (result.code) loginCode = result.code;
    }
    return result;
  });
  handle('catpilot:ai-copy-code', async () => {
    if (!loginCode) throw new Error('No active GitHub sign-in code is available.');
    clipboard.writeText(loginCode);
  });
  handle('catpilot:ai-draft', async (_event, rawId, rawPrompt, rawContext, rawModel) => {
    const workspaceId = z.uuid().parse(rawId);
    await execute({ action: 'snapshot', workspaceId });
    return provider!.draft(workspaceId, z.string().trim().min(1).max(10_000).parse(rawPrompt), z.string().max(200_000).parse(rawContext), z.string().min(1).max(300).optional().parse(rawModel), text => {
      if (window && !window.isDestroyed()) window.webContents.send('catpilot:ai-chunk', { workspaceId, text });
    });
  });
  handle('catpilot:ai-propose', async (_event, rawWorkspace, rawRecord, rawRevision, rawPrompt, rawModel) => {
    const workspaceId = z.uuid().parse(rawWorkspace), recordId = z.uuid().parse(rawRecord);
    const expectedRevision = z.string().min(1).parse(rawRevision);
    const snapshot = await execute({ action: 'snapshot', workspaceId }) as Snapshot;
    const record = snapshot.records.find(record => record.id === recordId);
    if (!record || record.revision !== expectedRevision) throw new Error('The selected item changed. Reload it before requesting an AI edit.');
    const before = recordInputSchema.parse(record);
    const context = JSON.stringify({ title: before.title, body: before.body, fields: aiChangeSchema.shape.fields.parse({
      status: before.fields.status, priority: before.fields.priority, due: before.fields.due, tags: before.fields.tags,
      goal: before.fields.goal, measure: before.fields.measure, steps: before.fields.steps, why: before.fields.why,
      importance: before.fields.importance, urgency: before.fields.urgency,
    }) });
    if (context.length > 200_000) throw new Error('The selected document is too large for structured AI editing. Use a smaller document or selected-text drafting.');
    aiProposal = undefined;
    const change = await provider!.propose(workspaceId, z.string().trim().min(1).max(10_000).parse(rawPrompt), context, z.string().min(1).max(300).optional().parse(rawModel));
    const proposal: AiProposal = {
      id: randomUUID(), workspaceId, recordId, expectedRevision, before,
      after: recordInputSchema.parse({ ...before, title: change.title, body: change.body, fields: { ...before.fields, ...change.fields } }),
    };
    aiProposal = proposal;
    return proposal;
  });
  handle('catpilot:ai-apply', async (_event, rawWorkspace, rawProposal) => {
    const workspaceId = z.uuid().parse(rawWorkspace), proposalId = z.uuid().parse(rawProposal);
    const proposal = aiProposal;
    if (!proposal || proposal.id !== proposalId || proposal.workspaceId !== workspaceId) throw new Error('This AI proposal is no longer available for this workspace. Request a new proposal.');
    const saved = await execute({
      action: 'put', workspaceId, id: proposal.recordId, expectedRevision: proposal.expectedRevision, input: proposal.after,
    });
    if (aiProposal === proposal) aiProposal = undefined;
    return saved;
  });
  handle('catpilot:ai-cancel', async () => {
    aiProposal = undefined;
    loginCode = ''; loginGeneration++;
    return provider!.cancel();
  });
  handle('catpilot:external', async (_event, rawUrl) => {
    const url = new URL(z.string().max(2000).parse(rawUrl));
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Only HTTPS external links are allowed.');
    const result = await dialog.showMessageBox(window!, { type: 'question', buttons: ['Cancel', 'Open browser'], defaultId: 0, message: 'Open this link in your browser?', detail: url.href });
    if (result.response === 1) await shell.openExternal(url.href);
  });
}

async function createWindow() {
  window = new BrowserWindow({
    width: 1440, height: 940, minWidth: 850, minHeight: 620,
    title: 'CatPilot', backgroundColor: '#f7f7f4', show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(here, '../preload/index.cjs'),
      nodeIntegration: false, contextIsolation: true, sandbox: true,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  if (traceQuit) window.on('close', () => quitTrace('window close'));
  window.webContents.on('will-prevent-unload', event => {
    quitTrace('will-prevent-unload: showing synchronous dialog');
    const choice = dialog.showMessageBoxSync(window!, {
      type: 'question', buttons: ['Keep editing', 'Discard unsaved changes'],
      defaultId: 0, cancelId: 0, message: 'This document has unsaved changes.',
      detail: 'Keep editing to save your changes, or discard them and close the window.',
    });
    quitTrace(`will-prevent-unload: dialog returned ${choice}`);
    if (choice === 1) event.preventDefault();
  });
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window.once('ready-to-show', () => window!.show());
  window.on('closed', () => { quitTrace('window closed'); window = null; preview = undefined; aiProposal = undefined; approvedDirectories.clear(); });
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    const url = new URL(process.env.ELECTRON_RENDERER_URL);
    if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.protocol !== 'http:') throw new Error('Development UI must be served from loopback.');
    rendererUrl = url.href;
    await window.loadURL(rendererUrl);
  } else {
    rendererUrl = new URL('../renderer/index.html', import.meta.url).href;
    await window.loadFile(path.join(here, '../renderer/index.html'));
  }
}

app.whenReady().then(async () => {
  if (process.env.CATPILOT_USER_DATA) {
    await fs.mkdir(process.env.CATPILOT_USER_DATA, { recursive: true });
    app.setPath('userData', process.env.CATPILOT_USER_DATA);
  }
  const home = process.env.CATPILOT_HOME;
  worker = new Worker(new URL('./storage-worker.js', import.meta.url), { workerData: { home } });
  worker.on('message', message => {
    const item = pending.get(message.id);
    if (!item) return;
    pending.delete(message.id);
    if (message.ok) item.resolve(message.value);
    else item.reject(new Error(message.error));
  });
  worker.on('error', error => { failPending(error); console.error('CatPilot storage worker:', error.message); });
  worker.on('exit', code => { worker = undefined; failPending(new Error(`Storage service exited (${code}). Restart CatPilot.`)); });
  const platform = `${process.platform}-${process.arch}`;
  const runtimePath = app.isPackaged ? path.join(
    process.resourcesPath, 'app.asar.unpacked', 'node_modules', '@github',
    `copilot-sdk-${platform}`, 'prebuilds', platform,
    process.platform === 'win32' ? 'copilot-runtime.exe' : 'copilot-runtime',
  ) : undefined;
  provider = new CopilotProvider(path.join(app.getPath('userData'), 'copilot'), runtimePath);
  registerHandlers();
  await createWindow();
  app.on('activate', () => { if (!window) void createWindow().catch(error => dialog.showErrorBox('CatPilot', String(error))); });
}).catch(error => { dialog.showErrorBox('CatPilot startup failed', String(error)); app.quit(); });

app.on('window-all-closed', () => { quitTrace('window-all-closed'); if (process.platform !== 'darwin') app.quit(); });
let stopping = false;
app.on('will-quit', event => {
  quitTrace(`will-quit stopping=${stopping}`);
  if (stopping) return;
  event.preventDefault();
  stopping = true;
  void (async () => {
    try { quitTrace('provider.stop start'); await provider?.stop(); quitTrace('provider.stop done'); }
    catch (error) { console.error('Copilot shutdown:', error); }
    finally {
      quitTrace(`storage terminate start thread=${worker?.threadId}`);
      const code = await worker?.terminate();
      quitTrace(`storage terminate done code=${code}; requesting app.quit again`);
      app.quit();
    }
  })();
});
