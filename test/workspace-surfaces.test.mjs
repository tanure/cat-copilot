import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { WorkspaceRegistry } from '../dist/core/index.js';
import * as claude from '../adapters/claude-code/tools.js';
import * as gemini from '../adapters/gemini-cli/tools.js';

const exec = promisify(execFile);
test('selected adapters share UUID records without touching legacy data or inventing paths', async t => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'catpilot-surfaces-'));
  const old = process.env.CATPILOT_HOME;
  const oldConfig = process.env.CATPILOT_CONFIG;
  process.env.CATPILOT_HOME = home;
  process.env.CATPILOT_CONFIG = path.join(home, 'no-legacy-config.json');
  t.after(async () => {
    if (old === undefined) delete process.env.CATPILOT_HOME; else process.env.CATPILOT_HOME = old;
    if (oldConfig === undefined) delete process.env.CATPILOT_CONFIG; else process.env.CATPILOT_CONFIG = oldConfig;
    await fs.rm(home, { recursive: true, force: true });
  });
  const workspace = await new WorkspaceRegistry(home).create('Pinned', 'sqlite');
  const created = await claude.add_task({ workspace: workspace.id, title: 'Workspace only', fields: { opaque: true } });
  assert.equal(created.success, true);
  assert.match(created.data.id, /^[0-9a-f-]{36}$/);
  assert.equal('path' in created, false);
  const listed = await gemini.catpilot_list_tasks({ workspace: workspace.id });
  assert.equal(listed.success, true);
  assert.equal(listed.result.data[0].id, created.data.id);
  const previewOnly = await claude.task_carry({ workspace: workspace.id, id: created.data.id, expectedRevision: created.data.revision, period: '2026-12', dryRun: true });
  assert.equal(previewOnly.success, true);
  assert.equal(previewOnly.data.dryRun, true, 'dry-run must remain read-only');
  assert.equal((await claude.list_tasks({ workspace: workspace.id })).data[0].revision, created.data.revision);
  const stale = await claude.complete_task({ workspace: workspace.id, id: created.data.id });
  assert.equal(stale.success, false, 'workspace mutations must require an observed revision');
  const done = await claude.complete_task({ workspace: workspace.id, id: created.data.id, expectedRevision: created.data.revision });
  assert.equal(done.data.fields.status, 'Done');
  assert.equal(done.data.fields.opaque, true);
  const marker = path.join(workspace.location, 'catpilot-import.json');
  await fs.writeFile(marker, '{}', { flag: 'wx' });
  const blocked = await claude.add_task({ workspace: workspace.id, title: 'Never enter an interrupted transfer' });
  assert.equal(blocked.success, false);
  assert.match(blocked.error, /interrupted import/i);
  const blockedComment = await claude.add_task_comment({ workspace: workspace.id, id: created.data.id, expectedRevision: done.data.revision, text: 'Never mutate through an alternate adapter' });
  assert.equal(blockedComment.success, false);
  assert.match(blockedComment.error, /interrupted import/i);
  await fs.unlink(marker);
  const started = await claude.pomodoro_start({ workspace: workspace.id, task: created.data.id, minutes: 5 });
  assert.equal(started.success, true);
  const timer = await claude.pomodoro_status({ workspace: workspace.id });
  assert.equal(timer.data.id, started.data.id);
  const stop = await claude.pomodoro_complete({ workspace: workspace.id, id: timer.data.id, expectedRevision: timer.data.revision });
  assert.equal(stop.data.fields.timerState, 'completed');
  const comment = await claude.add_task_comment({ workspace: workspace.id, id: created.data.id, expectedRevision: done.data.revision, text: 'Editable' });
  const edited = await claude.edit_task_comment({ workspace: workspace.id, id: created.data.id, expectedRevision: comment.data.revision, index: 0, text: 'Updated' });
  assert.equal(edited.data.fields.comments[0].text, 'Updated');
  const removed = await claude.remove_task_comment({ workspace: workspace.id, id: created.data.id, expectedRevision: edited.data.revision, index: 0 });
  assert.deepEqual(removed.data.fields.comments, []);
});

test('pinned CLI and TUI refuse legacy fallback and workspace CLI supports management', async t => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'catpilot-surface-cli-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const workspace = await new WorkspaceRegistry(home).create('Pinned', 'markdown');
  const env = { ...process.env, CATPILOT_HOME: home, CATPILOT_WORKSPACE: workspace.id };
  await assert.rejects(() => exec(process.execPath, ['bin/cat-cli.js', 'task', 'list'], { env }), /Refusing|workspace/);
  const terminal = JSON.parse((await exec(process.execPath, ['bin/cat-tui.js', '--snapshot'], { env })).stdout);
  assert.equal(terminal.workspace.id, workspace.id);
  const created = JSON.parse((await exec(process.execPath, ['bin/cat-cli.js', 'workspace', 'add', 'tasks', 'Pinned task'], { env })).stdout);
  const completed = JSON.parse((await exec(process.execPath, ['bin/cat-cli.js', 'workspace', 'manage', JSON.stringify({ action: 'complete', id: created.id, expectedRevision: created.revision })], { env })).stdout);
  assert.equal(completed.fields.status, 'Done');
});

test('portable Canvas explicitly rejects pinned workspace instead of opening legacy storage', async () => {
  const source = "import('./.github/extensions/catpilot-canvas/catpilot-store.mjs').then(m=>m.loadConfig())";
  await assert.rejects(() => exec(process.execPath, ['--input-type=module', '-e', source], {
    env: { ...process.env, CATPILOT_WORKSPACE: 'explicit-selection' },
  }), /workspace.*not supported|selected.*workspace|Refusing/);
});

test('pinned MCP shares management and refuses legacy tools before accessing legacy files', async t => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'catpilot-surface-mcp-'));
  const workspace = await new WorkspaceRegistry(home).create('Pinned', 'sqlite');
  const transport = new StdioClientTransport({
    command: process.execPath, args: ['mcp/server.js'],
    env: { ...process.env, CATPILOT_HOME: home, CATPILOT_WORKSPACE: workspace.id, CATPILOT_CONFIG: path.join(home, 'no-legacy.json') },
    stderr: 'pipe',
  });
  const client = new Client({ name: 'workspace-surfaces', version: '1' });
  let explicitClient;
  t.after(async () => { await explicitClient?.close(); await client.close(); await fs.rm(home, { recursive: true, force: true }); });
  await client.connect(transport);
  const old = await client.callTool({ name: 'task_list', arguments: {} });
  assert.equal(old.isError, true);
  assert.match(old.content[0].text, /refusing legacy/i);
  const created = await client.callTool({ name: 'workspace_record_save', arguments: { domain: 'tasks', title: 'MCP shared' } });
  assert.notEqual(created.isError, true);
  const record = JSON.parse(created.content[0].text);
  const managed = await client.callTool({ name: 'workspace_manage', arguments: { request: { action: 'comment', id: record.id, expectedRevision: record.revision, text: 'MCP comment' } } });
  assert.notEqual(managed.isError, true);
  assert.equal(JSON.parse(managed.content[0].text).fields.comments[0].text, 'MCP comment');
  const explicitTransport = new StdioClientTransport({
    command: process.execPath, args: ['mcp/server.js'],
    env: { ...process.env, CATPILOT_HOME: home, CATPILOT_WORKSPACE: '', CATPILOT_CONFIG: path.join(home, 'no-legacy.json') },
    stderr: 'pipe',
  });
  explicitClient = new Client({ name: 'explicit-selector', version: '1' });
  await explicitClient.connect(explicitTransport);
  const explicit = await explicitClient.callTool({ name: 'task_list', arguments: { workspace: workspace.id } });
  assert.equal(explicit.isError, true);
  assert.match(explicit.content[0].text, /refusing legacy/i, 'an explicit selector must not be stripped and silently routed to legacy');
});

test('CLI legacy preview never writes and approved import preserves source bytes and exported assets', async t => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'catpilot-cli-import-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const registry = new WorkspaceRegistry(path.join(home, 'registry'));
  const workspace = await registry.create('Import', 'sqlite');
  const source = path.join(home, 'source');
  await fs.mkdir(path.join(source, 'memos'), { recursive: true });
  const original = Buffer.from('# Legacy memo\r\n\r\nKeep exact source bytes.\r\n');
  await fs.writeFile(path.join(source, 'memos', 'example.md'), original);
  const env = { ...process.env, CATPILOT_HOME: path.join(home, 'registry'), CATPILOT_WORKSPACE: workspace.id };
  const run = async args => JSON.parse((await exec(process.execPath, ['bin/cat-cli.js', 'workspace', ...args], { env })).stdout);
  const preview = await run(['legacy-import', source]);
  assert.equal(preview.preview.assets, 1);
  assert.equal((await run(['records'])).length, 0, 'preview must not write records');
  const applied = await run(['legacy-import', source, '--apply']);
  assert.equal(applied.result.count, preview.preview.count);
  assert.ok((await run(['records'])).some(record => record.title === 'Legacy memo'));
  assert.deepEqual(await fs.readFile(path.join(source, 'memos', 'example.md')), original);
  const exported = path.join(home, 'source-copy.md');
  await run(['asset-export', 'legacy-source/memos/example.md', exported]);
  assert.deepEqual(await fs.readFile(exported), original);
  const bytes = Buffer.from([0, 255, 254, 1]);
  const binary = path.join(home, 'attachment.bin');
  await fs.writeFile(binary, bytes);
  const imported = await run(['asset-import', binary, '--path', 'attachments/test.bin']);
  assert.equal(imported.uri, 'catpilot-asset:attachments/test.bin');
  await assert.rejects(() => run(['asset-import', binary, '--path', 'attachments/test.bin']), /exist|collision/i);
  const copy = path.join(home, 'attachment-copy.bin');
  await run(['asset-export', 'attachments/test.bin', copy]);
  assert.deepEqual(await fs.readFile(copy), bytes);
  await assert.rejects(() => run(['asset-export', 'attachments/test.bin', copy]), /exist/i);
});
