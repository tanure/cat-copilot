import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { DatabaseSync } from 'node:sqlite';
import { WorkspaceRegistry, WorkspaceService, openRepository, recordInputSchema } from '../dist/core/index.js';
import { conceptFolderTree, flattenFolders, folderVersion } from '../dist/core/concept-folders.js';
import { changeFolderFiles } from '../dist/core/folder-file-edits.js';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'catpilot-workspaces-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return { root, service: new WorkspaceService(root), registry: new WorkspaceRegistry(root) };
}
const input = (domain = 'knowledge', title = 'Portable note') => recordInputSchema.parse({
  domain, title, body: '# Hello\r\n\r\n- [ ] Plan\n\n[[Keep this]]\n<!-- comment -->\n',
  fields: { tags: ['a,b', 'work'], goal: 'Ship', unknown: { nested: true } },
});

for (const backend of ['markdown', 'sqlite']) {
  test(`${backend}: Concept folders persist and preserve or delete the entire branch as requested`, async t => {
    const { registry, service } = await fixture(t);
    const workspace = await registry.create('Folder fixture', backend);
    const execute = (action, data = {}) => service.execute({ action, workspaceId: workspace.id, ...data });
    const snapshot = () => execute('snapshot');
    const change = async (command, observed) => execute('conceptFolder', { command, expected: await folderVersion(observed ?? (await snapshot()).records) });
    const paths = records => flattenFolders(conceptFolderTree(records));
    const note = (domain, title, folder) => execute('put', { input: { ...input(domain, title), fields: { ...input().fields, folder } } });

    await change({ type: 'create', parent: '', name: 'Work' });
    await change({ type: 'create', parent: '', name: 'Archive' });
    await change({ type: 'create', parent: 'Work', name: 'Research' });
    assert.deepEqual(paths((await snapshot()).records), ['Archive', 'Work', 'Work/Research']);
    await assert.rejects(() => change({ type: 'create', parent: '', name: 'archive' }), /already exists/);
    await assert.rejects(() => change({ type: 'create', parent: '', name: 'invalid/name' }), /without slashes/);
    await assert.rejects(() => change({ type: 'move', path: 'Work', parent: 'Work/Research' }), /cannot be moved/);
    const top = await note('knowledge', 'Work overview', 'Work');
    const old = (await snapshot()).records;
    const leaf = await note('growth', 'Nested document $&', 'Work/Research');
    const project = await note('projects', 'Unrelated project', 'Work/Research');
    await assert.rejects(() => change({ type: 'delete', path: 'Work', contents: 'delete' }, old), /changed/);
    const moved = (await change({ type: 'move', path: 'Work', parent: 'Archive' })).records;
    assert.deepEqual(paths(moved), ['Archive', 'Archive/Work', 'Archive/Work/Research']);
    assert.equal(moved.find(record => record.id === leaf.id).fields.folder, 'Archive/Work/Research');
    assert.equal(moved.find(record => record.id === leaf.id).body, leaf.body);
    assert.equal(moved.find(record => record.id === leaf.id).title, leaf.title);
    assert.equal(moved.find(record => record.id === leaf.id).created, leaf.created);
    assert.deepEqual(moved.find(record => record.id === project.id), project);
    const kept = (await change({ type: 'delete', path: 'Archive/Work', contents: 'keep' })).records;
    assert.equal(kept.find(record => record.id === top.id).fields.folder, 'Archive');
    assert.equal(kept.find(record => record.id === leaf.id).fields.folder, 'Archive/Research');
    assert.deepEqual(paths(kept), ['Archive', 'Archive/Research']);

    await change({ type: 'create', parent: '', name: 'Empty' });
    const backup = await execute('export');
    const restored = await registry.create('Restored', backend === 'sqlite' ? 'markdown' : 'sqlite');
    await service.execute({ action: 'import', workspaceId: restored.id, backup, approved: true });
    assert.deepEqual(paths((await service.execute({ action: 'snapshot', workspaceId: restored.id })).records), ['Archive', 'Archive/Research', 'Empty']);
    await change({ type: 'delete', path: 'Archive', contents: 'delete' });
    const left = (await snapshot()).records;
    assert.deepEqual(paths(left), ['Empty']);
    assert.deepEqual(left.filter(record => record.domain !== 'concept-folders'), [project]);
  });

  test(`${backend}: persistence, stale edits/deletes, unknown metadata and isolation`, async t => {
    const { registry } = await fixture(t);
    const workspace = await registry.create('Work', backend);
    const personal = await registry.create('Personal', backend);
    let repo = await openRepository(workspace);
    const created = await repo.put(input());
    repo.close();
    repo = await openRepository(workspace);
    const record = (await repo.snapshot()).records[0];
    assert.deepEqual(record.body, input().body);
    assert.deepEqual(record.fields.unknown, { nested: true });
    const next = await repo.put({ ...input(), title: 'Updated' }, record.id, record.revision);
    await assert.rejects(() => repo.put(input(), record.id, record.revision), /changed/);
    await assert.rejects(() => repo.remove(record.id, record.revision), /changed/);
    await assert.rejects(() => repo.put({ ...input('tasks') }, record.id, next.revision), /domain/);
    const other = await openRepository(personal);
    assert.equal((await other.snapshot()).records.length, 0);
    other.close();
    await repo.remove(created.id, next.revision);
    await assert.rejects(() => repo.remove(created.id, next.revision), /changed/);
    assert.equal((await repo.snapshot()).records.length, 0);
    repo.close();
  });

  test(`${backend}: cross-process optimistic concurrency`, async t => {
    const { registry } = await fixture(t);
    const workspace = await registry.create('Concurrent', backend);
    const repo = await openRepository(workspace);
    const record = await repo.put(input('tasks'));
    repo.close();
    const moduleUrl = new URL('../dist/core/index.js', import.meta.url).href;
    const code = `
      import {openRepository} from ${JSON.stringify(moduleUrl)};
      const repo = await openRepository(${JSON.stringify(workspace)});
      try {
        await repo.put(${JSON.stringify(input('tasks'))}, ${JSON.stringify(record.id)}, ${JSON.stringify(record.revision)});
        console.log('saved');
      } catch (e) { if(e.name !== 'ConflictError') throw e; console.log('conflict'); }
      finally { repo.close(); }
    `;
    const run = () => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['--input-type=module', '-e', code], { stdio: ['ignore', 'pipe', 'pipe'] });
      let output = '', errors = '';
      child.stdout.on('data', chunk => output += chunk);
      child.stderr.on('data', chunk => errors += chunk);
      child.on('error', reject);
      child.on('close', code => code === 0 ? resolve(output.trim()) : reject(new Error(errors)));
    });
    assert.deepEqual((await Promise.all([run(), run()])).sort(), ['conflict', 'saved']);
  });
}

test('Markdown folder batch restores the exact earlier files if a later write fails', async () => {
  const first = { id: 'one', revision: 'one' };
  const second = { id: 'two', revision: 'two' };
  const raw = new Map([['one', 'first\r\n'], ['two', 'second\n']]);
  await assert.rejects(() => changeFolderFiles([{ before: first }, { before: second, after: second }], {
    read: async id => raw.has(id) ? { raw: raw.get(id), revision: id } : undefined,
    serialize: () => 'edited',
    write: async (id, value) => { if (id === 'two') throw new Error('Storage write failed'); raw.set(id, value); },
    remove: async id => raw.delete(id),
  }), /Storage write failed/);
  assert.equal(raw.get('one'), 'first\r\n');
  assert.equal(raw.get('two'), 'second\n');
});

test('registry rejects duplicate names and overlapping roots; unregister never deletes data', async t => {
  const { registry } = await fixture(t);
  const workspace = await registry.create('Work', 'markdown');
  await assert.rejects(() => registry.create('work', 'sqlite'), /name/);
  await assert.rejects(() => registry.create('Nested', 'markdown', path.join(workspace.location, 'nested')), /overlap/);
  await registry.rename(workspace.id, 'Renamed');
  assert.equal((await registry.get(workspace.id)).name, 'Renamed');
  await registry.unregister(workspace.id);
  assert.deepEqual(await registry.list(), []);
  await fs.access(workspace.location);
});

test('simultaneous registry creates do not lose registrations', async t => {
  const { registry } = await fixture(t);
  await Promise.all(['One', 'Two', 'Three'].map(name => registry.create(name, 'markdown')));
  assert.equal((await registry.list()).length, 3);
});

test('full-fidelity transfers in both directions preserve IDs, fields and source', async t => {
  const { service, registry } = await fixture(t);
  const source = await registry.create('Source', 'markdown');
  const repo = await openRepository(source);
  for (const domain of ['tasks', 'knowledge', 'learning', 'projects', 'pomodoro']) await repo.put(input(domain, domain));
  repo.close();
  const backup = await service.execute({ action: 'export', workspaceId: source.id });
  const sqlite = await registry.create('SQL', 'sqlite');
  assert.deepEqual(await service.execute({ action: 'import', workspaceId: sqlite.id, backup, approved: true }), { count: 5, assets: 0 });
  await assert.rejects(() => service.execute({ action: 'import', workspaceId: sqlite.id, backup, approved: true }), /empty/);
  const secondBackup = await service.execute({ action: 'export', workspaceId: sqlite.id });
  const markdown = await registry.create('Restored', 'markdown');
  await service.execute({ action: 'import', workspaceId: markdown.id, backup: secondBackup, approved: true });
  const finalBackup = await service.execute({ action: 'export', workspaceId: markdown.id });
  const normalized = records => records.map(({ revision, ...record }) => record).sort((a, b) => a.id.localeCompare(b.id));
  assert.deepEqual(normalized(finalBackup.records), normalized(backup.records));
  assert.equal((await service.execute({ action: 'snapshot', workspaceId: source.id })).records.length, 5);
  assert.equal((await service.execute({ action: 'previewImport', backup })).count, 5);
  await assert.rejects(() => service.execute({ action: 'import', workspaceId: markdown.id, backup, approved: false }));
});

test('external Markdown changes produce a conflict and malformed metadata is not overwritten', async t => {
  const { registry } = await fixture(t);
  const workspace = await registry.create('Vault', 'markdown');
  const repo = await openRepository(workspace);
  const record = await repo.put(input());
  const file = path.join(workspace.location, 'CatPilot', `${record.id}.md`);
  const raw = await fs.readFile(file, 'utf8');
  await repo.snapshot();
  assert.equal(await fs.readFile(file, 'utf8'), raw);
  await fs.appendFile(file, '\nExternal edit');
  await assert.rejects(() => repo.put(input(), record.id, record.revision), /changed/);
  await fs.writeFile(file, 'Broken metadata');
  await assert.rejects(() => repo.snapshot(), /metadata/);
  await assert.rejects(() => repo.put(input(), record.id, record.revision), /metadata/);
  assert.equal(await fs.readFile(file, 'utf8'), 'Broken metadata');
  repo.close();
});

test('duplicate backup IDs fail without partial writes', async t => {
  const { registry } = await fixture(t);
  for (const backend of ['markdown', 'sqlite']) {
    const workspace = await registry.create(backend, backend);
    const repo = await openRepository(workspace);
    const record = await repo.put(input());
    await repo.remove(record.id, record.revision);
    await assert.rejects(() => repo.restore([record, record]), /Duplicate/);
    assert.equal((await repo.snapshot()).records.length, 0);
    repo.close();
  }
});

test('CLI can read a workspace created by the service', async t => {
  const { root, registry } = await fixture(t);
  const workspace = await registry.create('CLI', 'sqlite');
  const repo = await openRepository(workspace);
  const record = await repo.put(input());
  repo.close();
  const output = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['bin/cat-cli.js', 'workspace', 'records', '--workspace', workspace.id], {
      cwd: path.resolve(import.meta.dirname, '..'), env: { ...process.env, CATPILOT_HOME: root }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => stdout += chunk);
    child.stderr.on('data', chunk => stderr += chunk);
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(stdout) : reject(new Error(stderr)));
  });
  assert.equal(JSON.parse(output)[0].id, record.id);
});

test('MCP reads the same workspace and preserves omitted metadata on updates', async t => {
  const { root, registry } = await fixture(t);
  const workspace = await registry.create('MCP', 'sqlite');
  const repo = await openRepository(workspace);
  const record = await repo.put(input());
  repo.close();
  const transport = new StdioClientTransport({
    command: process.execPath, args: [path.resolve(import.meta.dirname, '..', 'bin', 'cat-mcp.js')],
    env: { ...process.env, CATPILOT_HOME: root },
    stderr: 'pipe',
  });
  const client = new Client({ name: 'workspace-contract-test', version: '1' });
  t.after(() => client.close());
  await client.connect(transport);
  const result = await client.callTool({ name: 'workspace_records', arguments: { workspace: workspace.id } });
  const snapshot = JSON.parse(result.content[0].text);
  assert.equal(snapshot.records[0].id, record.id);
  const saved = await client.callTool({
    name: 'workspace_record_save',
    arguments: { workspace: workspace.id, id: record.id, expectedRevision: record.revision, domain: record.domain, title: 'Through MCP', fields: { priority: 'P1' } },
  });
  assert.ok(!saved.isError, JSON.stringify(saved));
  const updated = JSON.parse(saved.content[0].text);
  assert.equal(updated.body, record.body);
  assert.deepEqual(updated.fields.unknown, { nested: true });
  assert.equal(updated.fields.priority, 'P1');
  const stale = await client.callTool({
    name: 'workspace_record_remove', arguments: { workspace: workspace.id, id: record.id, expectedRevision: record.revision },
  });
  assert.equal(stale.isError, true);
});

test('SQLite refuses an unrelated database without changing its journal mode', async t => {
  const { registry } = await fixture(t);
  const workspace = await registry.create('Unrelated', 'sqlite');
  const db = new DatabaseSync(path.join(workspace.location, 'catpilot.sqlite'));
  db.exec('CREATE TABLE other_data (value TEXT); INSERT INTO other_data VALUES (\'keep\')');
  const mode = db.prepare('PRAGMA journal_mode').get().journal_mode;
  db.close();
  await assert.rejects(() => openRepository(workspace), /not a CatPilot/);
  const unchanged = new DatabaseSync(path.join(workspace.location, 'catpilot.sqlite'));
  assert.equal(unchanged.prepare('SELECT value FROM other_data').get().value, 'keep');
  assert.equal(unchanged.prepare('PRAGMA journal_mode').get().journal_mode, mode);
  unchanged.close();
});

test('Markdown rejects a junction escaping its workspace', async t => {
  const { root, registry } = await fixture(t);
  const workspace = await registry.create('Contained', 'markdown');
  const outside = path.join(root, 'outside');
  await fs.mkdir(outside);
  await fs.symlink(outside, path.join(workspace.location, 'CatPilot'), process.platform === 'win32' ? 'junction' : 'dir');
  const repository = await openRepository(workspace);
  await assert.rejects(() => repository.put(input()), /symlink/);
  assert.deepEqual(await fs.readdir(outside), []);
  repository.close();
});

test('backup UUID case collisions are rejected before either backend writes', async t => {
  const { registry } = await fixture(t);
  for (const backend of ['sqlite', 'markdown']) {
    const workspace = await registry.create(`Case ${backend}`, backend);
    const repository = await openRepository(workspace);
    const record = {
      ...input(), id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      created: '2026-01-01T00:00:00.000Z', updated: '2026-01-01T00:00:00.000Z', revision: 'source',
    };
    await assert.rejects(() => repository.restore([record, { ...record, id: record.id.toUpperCase() }]), /case collisions/);
    assert.equal((await repository.snapshot()).records.length, 0);
    repository.close();
  }
});

test('SQLite refuses dangling symbolic links without creating their targets', async t => {
  const { root, registry } = await fixture(t);
  const workspace = await registry.create('Linked database', 'sqlite');
  const target = path.join(root, 'outside.sqlite');
  try { await fs.symlink(target, path.join(workspace.location, 'catpilot.sqlite'), 'file'); }
  catch (error) {
    if (error.code === 'EPERM') { t.skip('File symlinks require OS permission.'); return; }
    throw error;
  }
  await assert.rejects(() => openRepository(workspace), /symbolic link/);
  await assert.rejects(() => fs.stat(target), { code: 'ENOENT' });
});
