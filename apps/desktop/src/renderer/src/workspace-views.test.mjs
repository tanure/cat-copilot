import assert from 'node:assert/strict';
import test from 'node:test';
import { activityEvents, calendarDays, dayKey, isDay, journalDay, shiftMonth } from './workspace-views.ts';

test('the calendar includes leap day and adjacent months without skipping dates', () => {
  const days = calendarDays('2024-02');
  assert.deepEqual([days[0], days[31], days[32], days.at(-1)], ['2024-01-29', '2024-02-29', '2024-03-01', '2024-03-10']);
  assert.equal(new Set(calendarDays('2024-03')).size, 42, 'The spring clock change must not repeat or skip a day');
  assert.equal(isDay('2023-02-29'), false);
  assert.equal(shiftMonth('2025-01', -1), '2024-12');
});

test('journal uses the authored date independently of observable workspace activity', () => {
  const entry = {
    id: 'journal', created: '2025-01-02T03:00:00Z', updated: '2025-01-04T03:00:00Z',
    fields: { date: '2024-02-29', status: 'Open' },
  };
  assert.equal(journalDay(entry), '2024-02-29');
  assert.equal(journalDay({ ...entry, fields: {} }), dayKey(new Date(entry.created)));
  assert.deepEqual(activityEvents([entry]).map(event => [event.action, event.at]), [
    ['Last updated', Date.parse(entry.updated)], ['Created', Date.parse(entry.created)],
  ]);
});

test('timeline shows only recorded completions and does not duplicate their update timestamp', () => {
  const start = '2025-01-02T03:00:00Z';
  const finish = '2025-01-04T03:00:00Z';
  const pair = { id: 'timer', created: start, updated: finish };
  const cancelled = { ...pair, fields: { status: 'Blocked', completed: finish, timerState: 'cancelled' } };
  const noCompletion = { ...pair, fields: { status: 'Done', completed: '' } };
  assert.deepEqual(activityEvents([cancelled]).map(event => event.action), ['Cancelled', 'Created']);
  assert.deepEqual(activityEvents([noCompletion]).map(event => event.action), ['Last updated', 'Created']);
});
