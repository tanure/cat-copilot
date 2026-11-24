import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WorkspaceRegistry, WorkspaceService, openRepository, recordInputSchema } from '../dist/core/index.js';
import { assetBytes, digest, validateAssets } from '../dist/core/assets.js';
import { legacyBackup } from '../dist/core/legacy.js';
import { restoreWorkspace } from '../dist/core/transfer.js';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'catpilot-migration-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const home = path.join(root, 'profile');
  return { root, registry: new WorkspaceRegistry(home), service: new WorkspaceService(home) };
}
const asset = (name = 'attachments/image.png', bytes = Buffer.from([0, 255, 13, 10, 128])) => ({
  path: name, data: bytes.toString('base64'), sha256: digest(bytes),
});

for (const backend of ['sqlite', 'markdown']) {
  test(`${backend}: assets and record links survive transfers without changing their source`, async t => {
    const { registry, service } = await fixture(t);
    const source = await registry.create('Source', backend);
    const image = asset();
    assert.equal(await service.execute({ action: 'addAsset', workspaceId: source.id, asset: image }), 'catpilot-asset:attachments/image.png');
    await service.execute({ action: 'put', workspaceId: source.id, input: recordInputSchema.parse({ domain: 'knowledge', title: 'Image', body: '![Example](catpilot-asset:attachments/image.png)' }) });
    const backup = await service.execute({ action: 'export', workspaceId: source.id });
    const destination = await registry.create('Destination', backend === 'sqlite' ? 'markdown' : 'sqlite');
    assert.deepEqual(await service.execute({ action: 'import', workspaceId: destination.id, backup, approved: true }), { count: 1, assets: 1 });
    assert.equal((await service.execute({ action: 'readAsset', workspaceId: destination.id, path: image.path })).mime, 'image/png');
    assert.deepEqual(Buffer.from((await service.execute({ action: 'readAsset', workspaceId: destination.id, path: image.path })).data), assetBytes(image));
    const exported = await service.execute({ action: 'export', workspaceId: destination.id });
    assert.deepEqual(exported.assets, backup.assets);
    assert.equal(exported.records[0].body, backup.records[0].body);
    assert.deepEqual((await service.execute({ action: 'export', workspaceId: source.id })).assets, backup.assets);
  });

  test(`${backend}: interrupted imports retry safely, reject a different source, and do not duplicate records`, async t => {
    const { registry, service } = await fixture(t);
    const source = await registry.create('Source', backend);
    await service.execute({ action: 'put', workspaceId: source.id, input: recordInputSchema.parse({ domain: 'tasks', title: 'Recover me' }) });
    await service.execute({ action: 'addAsset', workspaceId: source.id, asset: asset() });
    const backup = await service.execute({ action: 'export', workspaceId: source.id });
    const destination = await registry.create('Destination', backend);
    const repository = await openRepository(destination);
    let interrupted = false;
    const failed = {
      snapshot: () => repository.snapshot(),
      restore: async records => {
        await repository.restore(records);
        interrupted = true;
        throw new Error('Synthetic crash after records committed');
      },
    };
    try {
      await assert.rejects(restoreWorkspace(destination, failed, backup), /Import incomplete.*new empty workspace/);
      assert.equal(interrupted, true);
      await fs.access(path.join(destination.location, 'catpilot-import.json'));
      await assert.rejects(service.execute({ action: 'put', workspaceId: destination.id, input: recordInputSchema.parse({ domain: 'tasks', title: 'Do not change partial import' }) }), /interrupted import/);
      await assert.rejects(service.execute({ action: 'addAsset', workspaceId: destination.id, asset: asset('new.png') }), /interrupted import/);
      const other = structuredClone(backup);
      other.records[0].title = 'Different import';
      await assert.rejects(restoreWorkspace(destination, repository, other), /original backup/);
      assert.deepEqual(await restoreWorkspace(destination, repository, backup), { count: 1, assets: 1 });
      assert.equal((await repository.snapshot()).records.length, 1);
      await assert.rejects(fs.access(path.join(destination.location, 'catpilot-import.json')), { code: 'ENOENT' });
      assert.equal((await fs.readdir(destination.location)).some(name => name.startsWith('.catpilot-assets-')), false);
    } finally { repository.close(); }
  });
}

test('invalid checksums, paths, case collisions and file/directory conflicts fail before writing', async t => {
  const { registry, service } = await fixture(t);
  const workspace = await registry.create('Empty', 'sqlite');
  const base = await service.execute({ action: 'export', workspaceId: workspace.id });
  for (const assets of [
    [{ ...asset(), sha256: '0'.repeat(64) }],
    [asset('../escape.png')], [asset('CON.txt')], [asset('bad\\path')],
    [asset('Pictures/a.png'), asset('pictures/b.png')],
    [asset('a'), asset('a/file')], [asset('same'), asset('same')],
  ]) {
    const backup = { ...base, assets };
    await assert.rejects(service.execute({ action: 'previewImport', backup }));
    await assert.rejects(service.execute({ action: 'import', workspaceId: workspace.id, backup, approved: true }));
    assert.equal((await service.execute({ action: 'snapshot', workspaceId: workspace.id })).records.length, 0);
    await assert.rejects(fs.access(path.join(workspace.location, 'catpilot-import.json')), { code: 'ENOENT' });
  }
  assert.throws(() => validateAssets([asset('big', Buffer.alloc(20_000_001))]), /Invalid asset/);
  assert.throws(() => validateAssets(['a', 'b', 'c'].map(name => asset(name, Buffer.alloc(17_000_000)))), /50 MB/);
});

test('linked asset roots are not read or archived', async t => {
  const { root, registry, service } = await fixture(t);
  const workspace = await registry.create('Linked', 'markdown');
  const external = path.join(root, 'external');
  await fs.mkdir(external);
  await fs.writeFile(path.join(external, 'private.txt'), 'Must not be exposed');
  await fs.symlink(external, path.join(workspace.location, 'CatPilotAssets'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(service.execute({ action: 'readAsset', workspaceId: workspace.id, path: 'private.txt' }), /[Ll]ink/);
  await assert.rejects(service.execute({ action: 'export', workspaceId: workspace.id }), /symbolic link/);
});

test('a replaced workspace-root junction cannot redirect record or asset requests', async t => {
  const { root, registry, service } = await fixture(t);
  const workspace = await registry.create('Original', 'markdown');
  const external = path.join(root, 'outside');
  await fs.mkdir(external);
  await fs.rename(workspace.location, `${workspace.location}-original`);
  await fs.symlink(external, workspace.location, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(service.execute({ action: 'snapshot', workspaceId: workspace.id }), /replaced by a link/);
  await assert.rejects(service.execute({ action: 'addAsset', workspaceId: workspace.id, asset: asset() }), /replaced by a link/);
  assert.deepEqual(await fs.readdir(external), []);
});

test('legacy import preserves period-local IDs, raw bytes, metadata, assets and unambiguous parents', async t => {
  const { root, registry, service } = await fixture(t);
  const source = path.join(root, 'legacy');
  await fs.mkdir(source);
  const files = {
    '2026/2026-01/tasks.md': Buffer.from('# Tasks\n\n## Open Tasks\n\n| ID | Status | Title | Due | Priority | Tags | Context | Project |\n|---|---|---|---|---|---|---|---|\n| 1 | Open | January task | 2026-02-01 | P1 | work | Keep me | build |\n'),
    '2026/2026-02/tasks.md': Buffer.from('# Tasks\n\n## Open Tasks\n\n| ID | Status | Title | Due | Priority | Tags | Context | Project |\n|---|---|---|---|---|---|---|---|\n| 1 | Open | February task | | P2 | | Other | |\n'),
    '2026/2026-02/milestones.md': Buffer.from('# Milestones\n\n| ID | Name | Target Date | Status | Notes | Link |\n|---|---|---|---|---|---|\n| 1 | First release | 2026-03-01 | Planned | Review | project:build |\n| 2 | Finish study | | Done | Learned | learning:study |\n'),
    'knowledge/note.md': Buffer.from('\uFEFF---\r\ncatpilot: memo\r\ntitle: Portable\r\ncustom: keep-me\r\ntags: ["one,two", "three"]\r\n---\r\n# Portable\r\n\r\n![Image](../images/photo.png)\r\n[[Wiki]]\r\n<!-- Keep -->\r\n'),
    'projects/build/index.md': Buffer.from('---\ncatpilot: project\ntitle: Build\n---\n# Build\n'),
    'projects/build/items/design.md': Buffer.from('---\ncatpilot: project-item\ntitle: Design\n---\n# Design\n'),
    'learning/study/index.md': Buffer.from('---\ncatpilot: learning\ntitle: Study\ngoal: Understand safe storage\ntarget_date: 2026-03-02\ncreated: 2026-01-03\n---\n# Study\n'),
    'learning/study/steps/read.md': Buffer.from('---\ncatpilot: learning-step\ntitle: Read\nstatus: Done\norder: 2\n---\n# Read\n'),
    'achievements/done.md': Buffer.from('---\ncatpilot: achievement\ntitle: Completed build\nsource_type: project\nsource: build\n---\n# Completed build\n'),
    '_templates/task.md': Buffer.from('---\ncatpilot: project\ntitle: Not a real project\n---\n'),
    'images/photo.png': Buffer.from([0, 255, 1, 128]),
    'unknown.dat': Buffer.from([0, 254, 128]),
  };
  for (const [relative, bytes] of Object.entries(files)) {
    const file = path.join(source, ...relative.split('/'));
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, bytes);
  }
  const workspace = await registry.create('Imported', 'sqlite');
  const first = await legacyBackup(source, workspace);
  const second = await legacyBackup(source, workspace);
  assert.deepEqual(first.backup.records.map(record => record.id), second.backup.records.map(record => record.id));
  assert.equal(first.sourceFiles, Object.keys(files).length);
  const tasks = first.backup.records.filter(record => record.domain === 'tasks');
  assert.equal(tasks.length, 2);
  assert.notEqual(tasks[0].id, tasks[1].id);
  assert.deepEqual(tasks.map(record => record.fields.legacyId), [1, 1]);
  assert.deepEqual(tasks.map(record => record.fields.period), ['2026/2026-01', '2026/2026-02']);
  const project = first.backup.records.find(record => record.title === 'Build');
  assert.equal(first.backup.records.find(record => record.title === 'Design').fields.parent, project.id);
  assert.equal(first.backup.records.find(record => record.title === 'January task').fields.project, project.id);
  assert.equal(first.backup.records.find(record => record.title === 'First release').fields.project, project.id);
  const learning = first.backup.records.find(record => record.title === 'Study');
  assert.equal(learning.fields.goal, 'Understand safe storage');
  assert.equal(learning.fields.due, '2026-03-02');
  assert.equal(learning.created, '2026-01-03T00:00:00.000Z');
  assert.equal(first.backup.records.find(record => record.title === 'Read').fields.parent, learning.id);
  assert.equal(first.backup.records.find(record => record.title === 'Finish study').fields.learning, learning.id);
  assert.equal(first.backup.records.find(record => record.title === 'Completed build').fields.source, project.id);
  assert.equal(first.backup.records.some(record => record.title === 'Not a real project'), false);
  const note = first.backup.records.find(record => record.title === 'Portable');
  assert.deepEqual(note.fields.tags, ['one,two', 'three']);
  assert.equal(note.fields.legacy.frontmatter.custom, 'keep-me');
  assert.match(note.body, /catpilot-asset:legacy-source\/images\/photo.png/);
  assert.match(note.body, /\[\[Wiki\]\]/);
  await service.execute({ action: 'import', workspaceId: workspace.id, backup: first.backup, approved: true });
  const exported = await service.execute({ action: 'export', workspaceId: workspace.id });
  for (const [relative, bytes] of Object.entries(files)) {
    assert.deepEqual(assetBytes(exported.assets.find(item => item.path === `legacy-source/${relative}`)), bytes);
    assert.deepEqual(await fs.readFile(path.join(source, ...relative.split('/'))), bytes);
  }
  await assert.rejects(legacyBackup(source, { ...workspace, location: source }), /non-overlapping/);
  await fs.writeFile(path.join(source, 'ambiguous.md'), '# Tasks\n## Open Tasks\n|ID|Status|Title|Due|Priority|Tags|Context|Project|\n|---|---|---|---|---|---|---|---|\n|1|Open|One||P2||||\n|1|Open|Two||P2||||\n');
  await assert.rejects(legacyBackup(source, workspace), /duplicate legacy identity/i);
});
