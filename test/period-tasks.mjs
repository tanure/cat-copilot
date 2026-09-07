#!/usr/bin/env node
/**
 * Period (month) partitioning tests for the canvas store.
 *
 * CatPilot writes tasks into date-partitioned markdown (`<root>/YYYY/YYYY-MM/tasks.md`),
 * so the canvas has to be able to read and edit any month — not just the live one —
 * and file forward-planned work into the month it is due.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let failures = 0;
function assert(cond, label) {
    if (cond) console.log(`✅ ${label}`);
    else { console.error(`❌ ${label}`); failures++; }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'catpilot-period-'));
process.env.CATPILOT_CONFIG = path.join(tmp, 'config.json');
fs.writeFileSync(process.env.CATPILOT_CONFIG, JSON.stringify({
    storage: { root: path.join(tmp, 'vault'), partitioning: 'month', files: {} },
}));

const storePath = path.join(process.cwd(), '.github', 'extensions', 'catpilot-canvas', 'catpilot-store.mjs');
const store = await import(`file://${storePath}`);

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const now = new Date();
const current = store.currentPeriod();

console.log('\n😺 CatPilot period tests\n');

assert(/^\d{4}\/\d{4}-\d{2}$/.test(current), 'currentPeriod returns a month partition');
assert(store.periodLabel(current) === now.toLocaleString('en-US', { month: 'long' }) + ' ' + now.getFullYear(),
    'periodLabel renders a human month');

// A due date in a later month files the task into that month's markdown.
const ahead = new Date(now.getFullYear(), now.getMonth() + 2, 15);
const planned = store.addTask({ title: 'Plan ahead', due: iso(ahead) });
assert(planned.period > current, 'a future due date files the task into that future month');

// A due date already behind us must never be filed into an archived month.
const behind = new Date(now.getFullYear(), now.getMonth() - 2, 5);
const late = store.addTask({ title: 'Overdue capture', due: iso(behind) });
assert(late.period === current, 'a past due date stays in the current month');

const plain = store.addTask({ title: 'Do now' });
assert(plain.period === current, 'an undated task stays in the current month');

// Reading one period vs. every period (the calendar spans months).
assert(store.listTasks('all', current).length === 2, 'listTasks scopes to a single period');
assert(store.listAllTasks().length === 3, 'listAllTasks unions every period');
assert(store.listAllTasks().every((t) => t.period), 'every task reports the period it lives in');

// Progress logs must be reachable in a non-live period.
store.taskCommentAdd(planned.id, { text: 'kickoff note' }, planned.period);
assert(store.taskCommentList(planned.id, planned.period).length === 1, 'task comments work in a non-current period');

// Moving a task re-files it; the target owns the ID sequence so the ID changes.
const moved = store.moveTask(plain.id, planned.period, current);
assert(moved.to === planned.period, 'moveTask reports its target period');
assert(store.listTasks('all', current).every((t) => t.title !== 'Do now'), 'moveTask removes the task from the source');
assert(store.listTasks('all', planned.period).some((t) => t.title === 'Do now'), 'moveTask writes the task to the target');

// Changing a due date to a later month reschedules the task, log and all.
const resched = store.updateTask(late.id, { dueDate: iso(ahead) });
assert(resched.period === planned.period, 'pushing a due date forward reschedules into that month');
assert(store.updateTask(resched.id, { title: 'Renamed' }, resched.period).period === resched.period,
    'an unrelated edit does not move a task');

// Bulk replanning leaves only finished work behind.
const stay = store.addTask({ title: 'Finished here' });
store.completeTask(stay.id);
store.addTask({ title: 'Still open' });
const carried = store.carryOverTasks(current, planned.period);
assert(carried.moved.length === 1 && carried.moved[0].title === 'Still open', 'carryOverTasks moves only unfinished work');
assert(store.listTasks('all', current).every((t) => t.status === 'Done'), 'carryOverTasks leaves completed tasks in place');

// Browsing a month that was never used must not litter the vault.
const ghost = '1999/1999-01';
assert(store.listTasks('all', ghost).length === 0, 'an unused period reads as empty');
assert(!fs.existsSync(path.join(tmp, 'vault', ghost)), 'browsing an unused period creates nothing on disk');

// The period comes from a query string, so traversal has to be refused.
let blocked = false;
try { store.listTasks('all', '../../etc'); } catch { blocked = true; }
assert(blocked, 'a traversal period is rejected');

const periods = store.listTaskPeriods();
assert(periods.some((p) => p.isCurrent), 'listTaskPeriods marks the current period');
assert(periods.every((p, i, a) => i === 0 || a[i - 1].period >= p.period), 'listTaskPeriods sorts newest first');

// Inline updates must patch one field without dropping metadata or confusing
// identical IDs in two partition files.
const scoped = store.addTask({
    title: 'Inline metadata', due: iso(ahead), context: 'Keep **context**',
    priority: 'P1', tags: 'inline,test', project: 'demo-project',
    goal: 'Preserve details', measure: 'All fields retained', why: 'Avoid data loss',
}, planned.period);
store.taskCommentAdd(scoped.id, { text: 'Keep this log' }, scoped.period);
const baseline = store.listTasks('all', scoped.period).find((t) => t.id === scoped.id);
for (const status of ['In Progress', 'Blocked', 'Done', 'Open']) {
    const saved = store.updateTask(scoped.id, { status }, scoped.period);
    assert(saved.status === status && saved.period === scoped.period, `inline status ${status} updates the source period`);
}
const afterStatus = store.listTasks('all', scoped.period).find((t) => t.id === scoped.id);
assert(['title', 'dueDate', 'context', 'priority', 'tags', 'project', 'smart', 'log'].every((key) =>
    JSON.stringify(baseline[key]) === JSON.stringify(afterStatus[key])), 'status-only edits preserve task metadata and log');
const cleared = store.updateTask(scoped.id, { dueDate: '' }, scoped.period);
assert(cleared.dueDate === '' && cleared.period === scoped.period, 'clearing a future task date keeps its existing period');
const later = new Date(now.getFullYear(), now.getMonth() + 3, 18);
const inlineMoved = store.updateTask(cleared.id, { dueDate: iso(later) }, cleared.period);
assert(inlineMoved.movedFrom === cleared.period && inlineMoved.period > cleared.period, 'inline due edit reports its moved identity');
assert(['context', 'priority', 'tags', 'project', 'smart', 'log'].every((key) =>
    JSON.stringify(baseline[key]) === JSON.stringify(inlineMoved[key])), 'inline rescheduling preserves SMART fields and log');
const twinA = store.addTask({ title: 'First same-id task' }, '2001/2001-01');
const twinB = store.addTask({ title: 'Second same-id task' }, '2001/2001-02');
assert(twinA.id === twinB.id, 'fixture tasks have duplicate IDs in separate periods');
store.updateTask(twinA.id, { status: 'Blocked' }, twinA.period);
assert(store.listTasks('all', twinA.period)[0].status === 'Blocked'
    && store.listTasks('all', twinB.period)[0].status === 'Open', 'inline updates never change the same ID in another month');

fs.rmSync(tmp, { recursive: true, force: true });

if (failures) { console.error(`\n❌ ${failures} period test(s) failed.\n`); process.exit(1); }
console.log('\n😺 Period tests complete.\n');
