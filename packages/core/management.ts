import { z } from 'zod';
import * as eisen from '../../lib/eisenhower.js';
import { ConflictError, domains, isDocument, recordInputSchema, type RecordEntry, type Repository } from './types.js';
import { managementRequestSchema, type ManagementRequest, type ManagementResult, type ManagementRollup, type ManagementPriority, type ManagementReport, type ManagementCarryPreview, type ManagementTimerStatus, type ManagementTimerStats } from './management-types.js';
export * from './management-types.js';
type ActionRequest<A extends ManagementRequest['action']> = Extract<ManagementRequest, { action: A }>;
type ActionResult<A extends ManagementRequest['action']> = A extends 'rollup' ? ManagementRollup :
  A extends 'prioritize' ? ManagementPriority[] : A extends 'report' ? ManagementReport :
  A extends 'carryForward' ? RecordEntry | ManagementCarryPreview :
  A extends 'timerStatus' ? ManagementTimerStatus : A extends 'timerStats' ? ManagementTimerStats : RecordEntry;

const compareId = (a: RecordEntry, b: RecordEntry) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
const done = (record: RecordEntry) => record.fields.status === 'Done';
const container = (record: RecordEntry) => record.domain === 'projects' || record.domain === 'learning';
const trackable = (record: RecordEntry) => record.fields.type !== 'requirement' && ['tasks', 'milestones', 'growth', 'projects', 'learning'].includes(record.domain);
function childrenOf(record: RecordEntry, records: RecordEntry[]) {
  return records.filter(item => item.id !== record.id && (
    item.fields.parent === record.id || (record.domain === 'projects' && item.fields.project === record.id)
  )).sort(compareId);
}
export function createRollup(records: readonly RecordEntry[]) {
  const links = new Map<string, RecordEntry[]>();
  for (const item of records) {
    for (const parent of new Set([item.fields.parent, item.fields.project])) {
      if (!parent || parent === item.id) continue;
      const list = links.get(parent);
      if (list) list.push(item);
      else links.set(parent, [item]);
    }
  }
  return (record: RecordEntry) => rollup(record, item => (links.get(item.id) ?? []).filter(child =>
    child.fields.parent === item.id || (item.domain === 'projects' && child.fields.project === item.id)));
}
function rollup(record: RecordEntry, childrenOfItem: (item: RecordEntry) => RecordEntry[]): ManagementRollup {
  const leaves = new Map<string, RecordEntry>();
  const descendants = new Map<string, RecordEntry>();
  const visited = new Set<string>();
  const visit = (item: RecordEntry, ancestors: Set<string>) => {
    if (ancestors.has(item.id) || item.fields.parent === item.id) throw new Error('Cyclic parent/project relationship; fix links before computing a rollup.');
    if (visited.has(item.id)) return;
    const children = container(item) ? childrenOfItem(item) : [];
    if (!children.length && item.id !== record.id && trackable(item)) leaves.set(item.id, item);
    for (const child of children) {
      descendants.set(child.id, child);
      visit(child, new Set([...ancestors, item.id]));
    }
    visited.add(item.id);
  };
  visit(record, new Set());
  const list = [...leaves.values()];
  const completed = list.filter(done).length;
  return {
    id: record.id, total: list.length, completed,
    progress: list.length ? Math.round(list.reduce((sum, item) => sum + (done(item) ? 100 : Math.min(99, item.fields.progress)), 0) / list.length) : (done(record) ? 100 : record.fields.progress),
    children: [...descendants.values()].sort(compareId),
    canComplete: list.length ? completed === list.length : done(record),
  };
}
function asTask(record: Pick<RecordEntry, 'fields' | 'body'>, id = 0) {
  return { ...record.fields, id, dueDate: record.fields.due, context: record.body, smart: record.fields };
}
export function taskClassification(record: Pick<RecordEntry, 'fields' | 'body'>, date: Date) {
  return eisen.classifyTask(asTask(record), date);
}
export function taskReadiness(record: Pick<RecordEntry, 'fields' | 'body'>) {
  return eisen.smartScore(asTask(record));
}
function periodValue(period: string) {
  // Imported periods are metadata, never physical paths for either backend.
  const legacyDay = /^(\d{4})\/(\d{4}-\d{2})\/(\d{4}-\d{2}-\d{2})$/.exec(period);
  const legacyMonth = /^(\d{4})\/(\d{4}-\d{2})$/.exec(period);
  const legacyWeek = /^(\d{4})\/W(\d{2})$/.exec(period);
  if (legacyDay && legacyDay[2].startsWith(legacyDay[1] + '-') && legacyDay[3].startsWith(legacyDay[2] + '-')) period = legacyDay[3];
  else if (legacyMonth && legacyMonth[2].startsWith(legacyMonth[1] + '-')) period = legacyMonth[2];
  else if (legacyWeek) period = `${legacyWeek[1]}-W${legacyWeek[2]}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(period) && z.iso.date().safeParse(period).success) return { kind: 'day', value: period };
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) return { kind: 'month', value: period };
  const week = /^(\d{4})-W(\d{2})$/.exec(period);
  if (week) {
    const year = Number(week[1]);
    const jan1 = new Date(`${week[1]}-01-01T00:00:00Z`).getUTCDay();
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const max = jan1 === 4 || (jan1 === 3 && leap) ? 53 : 52;
    if (Number(week[2]) >= 1 && Number(week[2]) <= max) return { kind: 'week', value: period };
  }
  throw new Error('Period must be a valid YYYY-MM-DD, YYYY-Www, or YYYY-MM.');
}
function appendHistory(record: RecordEntry, key: string, value: unknown) {
  const existing = record.fields[key];
  if (existing !== undefined && !Array.isArray(existing)) throw new Error(`Invalid ${key} history; refusing to overwrite existing metadata.`);
  return [...(existing as unknown[] | undefined ?? []), value];
}
const escapeLine = (text: string) => text.replace(/[\r\n]/g, ' ').replace(/[\\`*_[\]<>#|]/g, '\\$&');

/** Backend-neutral operations deliberately commit at most one record per request. */
export class ManagementService {
  constructor(readonly repository: Repository, private readonly clock: () => Date = () => new Date()) {}

  async execute<A extends ManagementRequest['action']>(raw: ActionRequest<A>): Promise<ActionResult<A>>;
  async execute(raw: ManagementRequest): Promise<ManagementResult>;
  async execute(raw: ManagementRequest): Promise<ManagementResult> {
    const request = managementRequestSchema.parse(raw);
    const records = (await this.repository.snapshot()).records.filter(isDocument);
    if (request.action === 'report') return this.report(records, request.from, request.to);
    if (request.action === 'timerStats') {
      if (request.from && request.to && request.from > request.to) throw new Error('Invalid timer report range.');
      const sessions = records.filter(record => record.domain === 'pomodoro' &&
        (!request.from || (record.fields.started || record.created).slice(0, 10) >= request.from) &&
        (!request.to || (record.fields.started || record.created).slice(0, 10) <= request.to)).sort(compareId);
      return {
        sessions,
        completed: sessions.filter(record => done(record) && record.fields.timerState !== 'cancelled').length,
        cancelled: sessions.filter(record => record.fields.timerState === 'cancelled').length,
        focusMinutes: Math.round(sessions.filter(record => done(record) && record.fields.type === 'focus' && record.fields.timerState !== 'cancelled')
          .reduce((sum, record) => sum + (typeof record.fields.elapsedSec === 'number' ? record.fields.elapsedSec : 0), 0) / 60 * 100) / 100,
        plannedMinutes: sessions.reduce((sum, record) => sum + record.fields.minutes, 0),
      };
    }
    if (request.action === 'timerStart' || request.action === 'timerStatus') {
      const active = records.filter(record => record.domain === 'pomodoro' && record.fields.status === 'In Progress' && record.fields.started && !record.fields.completed);
      if (active.length > 1) throw new Error('Multiple active timer records found. Inspect UUID workspace records and cancel the unwanted sessions with their revisions.');
      if (request.action === 'timerStatus') {
        const record = active[0] || null;
        const elapsedSec = record ? Math.max(0, Math.floor((this.clock().getTime() - Date.parse(record.fields.started)) / 1000)) : 0;
        const remainingSec = record ? Math.max(0, record.fields.minutes * 60 - elapsedSec) : 0;
        return { active: record, elapsedSec, remainingSec, isExpired: Boolean(record && remainingSec === 0) };
      }
      if (active.length) throw new Error(`A timer is already running (${active[0].id}). Complete or cancel it using its observed revision first.`);
      const taskIds = [...new Set([...(request.task ? [request.task] : []), ...(request.tasks ?? [])])];
      if (taskIds.length > 50) throw new Error('Choose at most 50 tasks for a session.');
      const tasks = new Map(records.filter(record => record.domain === 'tasks').map(record => [record.id, record]));
      if (taskIds.some(id => !tasks.has(id))) throw new Error('Timer tasks must be tasks from this workspace.');
      const type = request.type || 'focus';
      const label = type === 'focus' ? 'Focus session' : type === 'short-break' ? 'Short break' : 'Long break';
      return this.repository.put(recordInputSchema.parse({
        domain: 'pomodoro', title: request.title || request.purpose || (taskIds.length === 1 ? tasks.get(taskIds[0])?.title : '') || label,
        fields: { status: 'In Progress', started: this.clock().toISOString(), minutes: request.minutes || (type === 'focus' ? 25 : type === 'short-break' ? 5 : 15), type, task: taskIds[0] || '', timerState: 'running',
          ...(taskIds.length ? { focusTasks: taskIds } : {}), ...(request.purpose ? { focusPurpose: request.purpose } : {}) },
      }));
    }
    if (request.action === 'prioritize') {
      // Static import lets desktop bundlers include the established pure engine.
      const now = new Date(`${request.asOf}T12:00:00`);
      const tasks = records.filter(record => record.domain === 'tasks' && !done(record)).sort(compareId);
      const legacy = tasks.map((record, id) => ({
        ...asTask(record, id),
      }));
      return legacy.sort((a, b) => eisen.compareForFocus(a, b, now)).map(task => ({
        record: tasks[task.id], quadrant: eisen.classifyTask(task, now).quadrant,
        smart: eisen.smartScore(task), score: eisen.smartScore(task).score,
      }));
    }
    const record = records.find(item => item.id === request.id);
    if (!record) throw new Error('Record not found.');
    if (request.action === 'rollup') {
      if (!container(record)) throw new Error('Rollups require a project or learning record.');
      return createRollup(records)(record);
    }
    if (record.revision !== request.expectedRevision) throw new ConflictError();
    const at = this.clock().toISOString();
    const fields = { ...record.fields };
    switch (request.action) {
      case 'comment':
      case 'log': {
        const key = request.action === 'comment' ? 'comments' : 'logs';
        fields[key] = appendHistory(record, key, { id: globalThis.crypto.randomUUID(), text: request.text, at });
        break;
      }
      case 'editComment':
      case 'removeComment': {
        const key = request.collection || 'comments';
        const history = record.fields[key];
        if (history !== undefined && !Array.isArray(history)) throw new Error(`Invalid ${key} history; refusing to overwrite metadata.`);
        if (!Array.isArray(history) || request.index >= history.length) throw new Error('Comment not found in the selected history collection.');
        const updated = [...history];
        if (request.action === 'removeComment') updated.splice(request.index, 1);
        else {
          const entry = history[request.index];
          if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('Invalid comment metadata; use source editing to repair this entry.');
          updated[request.index] = { ...entry, text: request.text, ...(request.date !== undefined ? { date: request.date } : {}) };
        }
        fields[key] = updated;
        break;
      }
      case 'carryForward': {
        if (record.domain !== 'tasks' || done(record)) throw new Error('Only open tasks can be carried forward.');
        const destination = periodValue(request.period);
        const source = record.fields.period ? periodValue(record.fields.period) : undefined;
        if (source && source.kind !== destination.kind) throw new Error('Carry-forward requires the same period granularity.');
        if (source && destination.value <= source.value) throw new Error('Carry-forward requires a later period.');
        if (request.dryRun) return { dryRun: true, id: record.id, expectedRevision: record.revision, from: record.fields.period, to: request.period };
        fields.period = request.period;
        fields.carryHistory = appendHistory(record, 'carryHistory', { from: record.fields.period, to: request.period, at });
        break;
      }
      case 'timerComplete':
      case 'timerCancel': {
        if (record.domain !== 'pomodoro' || fields.status !== 'In Progress' || !fields.started || fields.completed) throw new Error('The selected UUID is not an active timer.');
        fields.elapsedSec = Math.max(0, Math.floor((Date.parse(at) - Date.parse(fields.started)) / 1000));
        fields.completed = at;
        fields.status = request.action === 'timerCancel' ? 'Blocked' : 'Done';
        fields.progress = request.action === 'timerCancel' ? 0 : 100;
        fields.timerState = request.action === 'timerCancel' ? 'cancelled' : 'completed';
        if (request.notes !== undefined) fields.notes = request.notes;
        break;
      }
      case 'complete':
        if (!['tasks', 'projects', 'learning', 'milestones', 'growth', 'pomodoro'].includes(record.domain)) throw new Error('This domain does not support completion.');
        // A repository has no multi-record CAS. Parent completion stays derived
        // instead of racing a child edit and persisting a misleading Done status.
        if (container(record) && createRollup(records)(record).total) throw new Error('Container completion is derived from its children. Use rollup instead.');
        if (done(record) && fields.completed && fields.progress === 100) return record;
        if (record.domain === 'pomodoro' && fields.started && !fields.completed) {
          fields.elapsedSec = Math.max(0, Math.floor((Date.parse(at) - Date.parse(fields.started)) / 1000));
          fields.timerState = 'completed';
        }
        fields.status = 'Done';
        fields.progress = 100;
        fields.completed = fields.completed || at;
        break;
    }
    return this.repository.put({ domain: record.domain, title: record.title, body: record.body, fields }, record.id, request.expectedRevision);
  }

  private report(records: RecordEntry[], from: string, to: string): ManagementReport {
    if (from > to) throw new Error('Report range must start on or before its end.');
    const inRange = (value: string) => value.slice(0, 10) >= from && value.slice(0, 10) <= to;
    const selected = records.filter(record => inRange(record.created) || inRange(record.updated) || (record.fields.completed && inRange(record.fields.completed))).sort(compareId);
    const counts = Object.fromEntries(domains.map(domain => [domain, selected.filter(record => record.domain === domain).length]));
    const achievements: ManagementReport['achievements'] = [];
    for (const record of [...records].sort(compareId)) {
      if (!['tasks', 'projects', 'learning', 'milestones', 'growth'].includes(record.domain)) continue;
      if (container(record) && childrenOf(record, records).length) {
        const aggregate = createRollup(records)(record);
        const completed = aggregate.total
          ? aggregate.children.filter(child => trackable(child) && (!container(child) || !childrenOf(child, records).some(trackable))).map(child => child.fields.completed).filter(Boolean).sort().at(-1) || ''
          : record.fields.completed;
        if (aggregate.canComplete && completed && inRange(completed)) achievements.push({ id: `completion:${record.id}`, sourceId: record.id, title: record.title, completed });
      } else if (done(record) && record.fields.completed && inRange(record.fields.completed)) {
        achievements.push({ id: `completion:${record.id}`, sourceId: record.id, title: record.title, completed: record.fields.completed });
      }
    }
    const markdown = [
      `# CatPilot report: ${from} to ${to}`, '', '## Records', '',
      ...selected.map(record => `- [${done(record) ? 'x' : ' '}] ${escapeLine(record.title)} (${record.domain}; ${record.id})`),
      '', '## Completion achievements (derived)', '',
      ...achievements.map(item => `- ${escapeLine(item.title)} (${item.completed}; ${item.sourceId})`), '',
    ].join('\n');
    return { from, to, records: selected, counts, achievements, markdown };
  }
}
