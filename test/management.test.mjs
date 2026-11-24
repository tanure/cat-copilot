import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WorkspaceRegistry, WorkspaceService, openRepository, recordInputSchema } from '../dist/core/index.js';
import { ManagementService } from '../dist/core/management.js';

for (const backend of ['markdown', 'sqlite']) {
  async function fixture(t) {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'catpilot-management-'));
    const workspace = await new WorkspaceRegistry(home).create('Management', backend);
    const repo = await openRepository(workspace);
    t.after(async () => { repo.close(); await fs.rm(home, { recursive: true, force: true }); });
    const service = new ManagementService(repo, () => new Date('2026-11-23T12:00:00Z'));
    const add = (domain, title, fields = {}) => repo.put(recordInputSchema.parse({ domain, title, fields }));
    return { repo, service, add, workspace, home };
  }

  test(`${backend}: histories preserve unknown metadata and reject stale edits without partial writes`, async t => {
    const { repo, service, add } = await fixture(t);
    const task = await add('tasks', 'Ship', { unknown: { deep: ['keep'] }, period: '2026-11-22' });
    const commented = await service.execute({ action: 'comment', id: task.id, expectedRevision: task.revision, text: 'Ready' });
    assert.equal(commented.fields.comments[0].text, 'Ready');
    assert.deepEqual(commented.fields.unknown, task.fields.unknown);
    await assert.rejects(() => service.execute({ action: 'log', id: task.id, expectedRevision: task.revision, text: 'stale' }), /changed/);
    const carried = await service.execute({ action: 'carryForward', id: task.id, expectedRevision: commented.revision, period: '2026-11-23' });
    assert.equal(carried.fields.period, '2026-11-23');
    assert.deepEqual(carried.fields.carryHistory[0], { from: '2026-11-22', to: '2026-11-23', at: '2026-11-23T12:00:00.000Z' });
    await assert.rejects(() => service.execute({ action: 'carryForward', id: task.id, expectedRevision: carried.revision, period: '2026-11-21' }), /later/);
    await assert.rejects(() => service.execute({ action: 'carryForward', id: task.id, expectedRevision: carried.revision, period: '2026-W48' }), /granularity/);
    assert.equal((await repo.snapshot()).records.length, 1);
    const done = await service.execute({ action: 'complete', id: task.id, expectedRevision: carried.revision });
    assert.equal(done.fields.progress, 100);
    assert.equal(done.fields.completed, '2026-11-23T12:00:00.000Z');
    assert.equal((await repo.snapshot()).records.length, 1, 'completion must not write a second achievement record');
    const again = await service.execute({ action: 'complete', id: task.id, expectedRevision: done.revision });
    assert.equal(again.revision, done.revision, 'idempotent completion must not duplicate history or timestamps');
  });

  test(`${backend}: malformed history is rejected rather than overwritten`, async t => {
    const { service, add } = await fixture(t);
    const task = await add('tasks', 'Keep history', { comments: { legacy: 'do not discard' } });
    await assert.rejects(() => service.execute({ action: 'comment', id: task.id, expectedRevision: task.revision, text: 'new' }), /history/);
    await assert.rejects(() => service.execute({ action: 'comment', id: task.id, expectedRevision: task.revision, text: '   ' }));
  });

  test(`${backend}: rollups derive completion without partially mutating a parent`, async t => {
    const { service, add, repo } = await fixture(t);
    const project = await add('projects', 'Release');
    const learning = await add('learning', 'Study', { parent: project.id });
    const child = await add('tasks', 'Practice', { parent: learning.id, project: project.id });
    let rollup = await service.execute({ action: 'rollup', id: project.id });
    assert.equal(rollup.total, 1, 'a leaf linked by both project and parent must not be double counted');
    assert.equal(rollup.canComplete, false);
    await assert.rejects(() => service.execute({ action: 'complete', id: project.id, expectedRevision: project.revision }), /derived/);
    await service.execute({ action: 'complete', id: child.id, expectedRevision: child.revision });
    rollup = await service.execute({ action: 'rollup', id: project.id });
    assert.equal(rollup.progress, 100);
    assert.equal(rollup.canComplete, true);
    assert.equal((await repo.snapshot()).records.find(r => r.id === project.id).revision, project.revision);
  });

  test(`${backend}: deterministic reports derive achievements and reuse SMART/Eisenhower`, async t => {
    const { service, add } = await fixture(t);
    const task = await add('tasks', 'Deliver', { due: '2026-11-23', importance: 'High', urgency: 'High', goal: 'Ship', measure: 'Tests pass', steps: 'Test', why: 'Users' });
    await add('tasks', 'Later', { priority: 'P3', due: '2027-01-01', importance: 'Low', urgency: 'Low' });
    const ranked = await service.execute({ action: 'prioritize', asOf: '2026-11-23' });
    assert.equal(ranked[0].record.id, task.id);
    assert.equal(ranked[0].quadrant, 'q1');
    assert.equal(ranked[0].smart.score, 5);
    await service.execute({ action: 'complete', id: task.id, expectedRevision: task.revision });
    const request = { action: 'report', from: '2026-11-01', to: '2026-11-30' };
    const first = await service.execute(request);
    assert.deepEqual(await service.execute(request), first);
    assert.equal(first.achievements.length, 1);
    assert.equal(first.achievements[0].sourceId, task.id);
    assert.match(first.markdown, /Deliver/);
    await assert.rejects(() => service.execute({ ...request, from: '2026-12-01' }), /range/);
  });

  test(`${backend}: concurrent histories retain the winner and never overwrite its metadata`, async t => {
    const { service, add, repo } = await fixture(t);
    const task = await add('tasks', 'Concurrent log', { logs: [{ text: 'Original', extension: true }], unknown: { retained: true } });
    const results = await Promise.allSettled(['First', 'Second'].map(text =>
      service.execute({ action: 'log', id: task.id, expectedRevision: task.revision, text })));
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    const current = (await repo.snapshot()).records[0];
    assert.equal(current.fields.logs.length, 2);
    assert.deepEqual(current.fields.logs[0], { text: 'Original', extension: true });
    assert.deepEqual(current.fields.unknown, { retained: true });
  });

  test(`${backend}: carry-forward validates real periods and rejects completed work without a write`, async t => {
    const { service, add, repo } = await fixture(t);
    const task = await add('tasks', 'Week plan', { period: '2026-W48' });
    await assert.rejects(() => service.execute({ action: 'carryForward', id: task.id, expectedRevision: task.revision, period: '2027-W53' }), /valid/);
    await assert.rejects(() => service.execute({ action: 'carryForward', id: task.id, expectedRevision: task.revision, period: '../../outside' }), /valid/);
    assert.equal((await repo.snapshot()).records[0].revision, task.revision);
    const carried = await service.execute({ action: 'carryForward', id: task.id, expectedRevision: task.revision, period: '2027-W01' });
    const complete = await service.execute({ action: 'complete', id: task.id, expectedRevision: carried.revision });
    await assert.rejects(() => service.execute({ action: 'carryForward', id: task.id, expectedRevision: complete.revision, period: '2027-W02' }), /open tasks/);
  });

  test(`${backend}: project scope requirements do not dilute progress and cyclic hierarchies fail explicitly`, async t => {
    const { service, add, repo } = await fixture(t);
    const project = await add('projects', 'Scope');
    await add('tasks', 'Requirement only', { parent: project.id, type: 'requirement' });
    await add('tasks', 'Delivered', { project: project.id, status: 'Done', progress: 100, completed: '2026-11-23T12:00:00Z' });
    const aggregate = await service.execute({ action: 'rollup', id: project.id });
    assert.equal(aggregate.total, 1);
    assert.equal(aggregate.progress, 100);
    assert.equal(aggregate.canComplete, true);
    const loop = await add('learning', 'Loop', { parent: project.id });
    await repo.put({ ...project, fields: { ...project.fields, parent: loop.id } }, project.id, project.revision);
    await assert.rejects(() => service.execute({ action: 'rollup', id: project.id }), /Cyclic/);
  });

  test(`${backend}: carry-forward accepts archived legacy period metadata without treating it as a file path`, async t => {
    const { service, add } = await fixture(t);
    const task = await add('tasks', 'Imported work', { period: '2026/2026-11', log: [{ date: '2026-11-22', text: 'Preserve imported history' }] });
    const next = await service.execute({ action: 'carryForward', id: task.id, expectedRevision: task.revision, period: '2026-12' });
    assert.equal(next.fields.period, '2026-12');
    assert.equal(next.fields.carryHistory[0].from, '2026/2026-11');
    assert.deepEqual(next.fields.log, task.fields.log);
  });

  test(`${backend}: public management envelope honors revision checks and pending-transfer write barriers`, async t => {
    const { workspace, home, repo, add } = await fixture(t);
    const core = new WorkspaceService(home);
    const task = await add('tasks', 'Integrated operation', { extension: { keep: true } });
    const log = await core.execute({
      action: 'management', workspaceId: workspace.id,
      request: { action: 'log', id: task.id, expectedRevision: task.revision, text: 'Via core dispatcher' },
    });
    assert.equal(log.fields.logs[0].text, 'Via core dispatcher');
    assert.deepEqual(log.fields.extension, { keep: true });
    await assert.rejects(() => core.execute({
      action: 'management', workspaceId: workspace.id,
      request: { action: 'complete', id: task.id, expectedRevision: task.revision },
    }), /changed/);
    const marker = path.join(workspace.location, 'catpilot-import.json');
    await fs.writeFile(marker, '{}', { flag: 'wx' });
    await assert.rejects(() => core.execute({
      action: 'management', workspaceId: workspace.id,
      request: { action: 'complete', id: task.id, expectedRevision: log.revision },
    }), /interrupted import/i);
    assert.equal((await repo.snapshot()).records[0].revision, log.revision);
    const report = await core.execute({
      action: 'management', workspaceId: workspace.id,
      request: { action: 'report', from: '2000-01-01', to: '2099-12-31' },
    });
    assert.equal(report.records.length, 1, 'read-only management should remain available for diagnosis');
    await fs.unlink(marker);
  });

  test(`${backend}: comment editing/deletion and carry previews use current CAS without losing legacy log metadata`, async t => {
    const { service, add, repo } = await fixture(t);
    const task = await add('tasks', 'History edits', { period: '2026-11', log: [{ date: '2026-11-20', text: 'Original', extension: true }] });
    const preview = await service.execute({ action: 'carryForward', id: task.id, expectedRevision: task.revision, period: '2026-12', dryRun: true });
    assert.equal(preview.dryRun, true);
    assert.equal(preview.to, '2026-12');
    assert.equal((await repo.snapshot()).records[0].revision, task.revision);
    const edit = await service.execute({ action: 'editComment', id: task.id, expectedRevision: task.revision, collection: 'log', index: 0, text: 'Revised' });
    assert.deepEqual(edit.fields.log[0], { date: '2026-11-20', text: 'Revised', extension: true });
    await assert.rejects(() => service.execute({ action: 'removeComment', id: task.id, expectedRevision: task.revision, collection: 'log', index: 0 }), /changed/);
    const removed = await service.execute({ action: 'removeComment', id: task.id, expectedRevision: edit.revision, collection: 'log', index: 0 });
    assert.deepEqual(removed.fields.log, []);
    await assert.rejects(() => service.execute({ action: 'removeComment', id: task.id, expectedRevision: removed.revision, index: 0 }), /not found/);
  });

  test(`${backend}: timestamp timers survive service recreation and complete with a single revision-checked record write`, async t => {
    const { service, repo } = await fixture(t);
    const started = await service.execute({ action: 'timerStart', title: 'Focus', minutes: 25, type: 'focus' });
    const later = new ManagementService(repo, () => new Date('2026-11-23T12:07:30Z'));
    const status = await later.execute({ action: 'timerStatus' });
    assert.equal(status.active.id, started.id);
    assert.equal(status.elapsedSec, 450);
    assert.equal(status.remainingSec, 1050);
    await assert.rejects(() => later.execute({ action: 'timerStart', minutes: 10 }), /already running/);
    const completed = await later.execute({ action: 'complete', id: started.id, expectedRevision: started.revision });
    assert.equal(completed.fields.elapsedSec, 450);
    assert.equal(completed.fields.status, 'Done');
    assert.equal((await later.execute({ action: 'timerStatus' })).active, null);
    const stats = await later.execute({ action: 'timerStats' });
    assert.equal(stats.focusMinutes, 7.5);
    assert.equal(stats.completed, 1);
    assert.equal((await repo.snapshot()).records.length, 1);
    const next = await later.execute({ action: 'timerStart', minutes: 5, type: 'short-break' });
    await later.execute({ action: 'timerCancel', id: next.id, expectedRevision: next.revision });
    assert.equal((await later.execute({ action: 'timerStats' })).cancelled, 1);
  });

  test(`${backend}: concurrent timer starts through the public service cannot create two active sessions`, async t => {
    const { workspace, home } = await fixture(t);
    const request = { action: 'management', workspaceId: workspace.id, request: { action: 'timerStart', minutes: 25 } };
    const results = await Promise.allSettled([new WorkspaceService(home).execute(request), new WorkspaceService(home).execute(request)]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    const status = await new WorkspaceService(home).execute({ action: 'management', workspaceId: workspace.id, request: { action: 'timerStatus' } });
    assert.ok(status.active.id);
  });

  test(`${backend}: timers preserve ordered task links and purpose without updating linked tasks`, async t => {
    const { service, repo, add } = await fixture(t);
    const first = await add('tasks', 'First linked task');
    const second = await add('tasks', 'Second linked task');
    const note = await add('knowledge', 'Not a task');
    await assert.rejects(() => service.execute({ action: 'timerStart', tasks: [first.id, note.id] }), /tasks from this workspace/);
    assert.equal((await service.execute({ action: 'timerStatus' })).active, null);
    const started = await service.execute({ action: 'timerStart', task: first.id, tasks: [second.id, first.id], purpose: '  Clear the queue  ' });
    assert.equal(started.title, 'Clear the queue');
    const active = (await new ManagementService(repo).execute({ action: 'timerStatus' })).active;
    assert.deepEqual(active.fields.focusTasks, [first.id, second.id]);
    assert.equal(active.fields.task, first.id);
    assert.equal(active.fields.focusPurpose, 'Clear the queue');
    const saved = await service.execute({ action: 'timerComplete', id: started.id, expectedRevision: started.revision });
    assert.deepEqual(saved.fields.focusTasks, [first.id, second.id]);
    const { records } = await repo.snapshot();
    assert.deepEqual(records.find(record => record.id === first.id), first);
    assert.deepEqual(records.find(record => record.id === second.id), second);
  });
}
