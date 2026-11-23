import type { Domain, RecordEntry } from '../../shared.js';

export { conceptKinds, isConcept, folderTrail, type ConceptKind } from '../../../../../packages/core/concept-folders.js';
export const kindNames: Record<Domain, string> = {
  tasks: 'Task', knowledge: 'Knowledge', journal: 'Journal', projects: 'Project', learning: 'Learning',
  milestones: 'Milestone', growth: 'Growth', achievements: 'Achievement', pomodoro: 'Focus', reports: 'Report',
};
export const tones = ['teal', 'blue', 'violet', 'amber', 'rose', 'slate'] as const;
export type Tone = typeof tones[number];
export const kindTones: Record<Domain, Tone> = {
  tasks: 'blue', knowledge: 'teal', journal: 'violet', projects: 'blue', learning: 'violet',
  milestones: 'amber', growth: 'rose', achievements: 'amber', pomodoro: 'teal', reports: 'slate',
};

export function dayKey(date: Date) {
  return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function dateFromDay(day: string) {
  return new Date(`${day}T12:00:00`);
}
export function isDay(day: unknown): day is string {
  return typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day) && dayKey(dateFromDay(day)) === day;
}
export function shiftMonth(month: string, offset: number) {
  const date = dateFromDay(`${month}-01`);
  date.setMonth(date.getMonth() + offset);
  return dayKey(date).slice(0, 7);
}
export function calendarDays(month: string) {
  const date = dateFromDay(`${month}-01`);
  date.setDate(1 - (date.getDay() + 6) % 7);
  return Array.from({ length: 42 }, () => {
    const key = dayKey(date);
    date.setDate(date.getDate() + 1);
    return key;
  });
}
export function journalDay(record: Pick<RecordEntry, 'fields' | 'created'>) {
  return isDay(record.fields.date) ? record.fields.date : dayKey(new Date(record.created));
}
export function achievementYear(record: Pick<RecordEntry, 'fields' | 'created'>) {
  const completed = record.fields.completed;
  return (isDay(completed) ? completed : dayKey(new Date(Number.isFinite(Date.parse(completed)) ? completed : record.created))).slice(0, 4);
}
export function focusTaskIds(fields: RecordEntry['fields']): string[] {
  const stored = Array.isArray(fields.focusTasks) ? fields.focusTasks.filter((id): id is string => typeof id === 'string' && !!id) : [];
  return [...new Set([...stored, ...(typeof fields.task === 'string' && fields.task ? [fields.task] : [])])];
}
export function groupBy<T>(items: readonly T[], key: (item: T) => string) {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const name = key(item);
    const group = groups.get(name);
    if (group) group.push(item);
    else groups.set(name, [item]);
  }
  return groups;
}
export function activityEvents(records: readonly RecordEntry[]) {
  const events = records.flatMap(record => {
    const created = Date.parse(record.created);
    const updated = Date.parse(record.updated);
    const finished = Date.parse(record.fields.completed);
    const completion = Number.isFinite(finished) && (record.fields.status === 'Done' || record.fields.timerState === 'cancelled');
    return [
      ...(Number.isFinite(created) ? [{ key: `${record.id}:created`, record, at: created, action: 'Created' }] : []),
      ...(Number.isFinite(updated) && (!Number.isFinite(created) || updated > created) && (!completion || updated !== finished) ? [{ key: `${record.id}:updated`, record, at: updated, action: 'Last updated' }] : []),
      ...(completion ? [{ key: `${record.id}:completed`, record, at: finished, action: record.fields.timerState === 'cancelled' ? 'Cancelled' : 'Completed' }] : []),
    ];
  });
  return events.sort((a, b) => b.at - a.at || a.key.localeCompare(b.key));
}
