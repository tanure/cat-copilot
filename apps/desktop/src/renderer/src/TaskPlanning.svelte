<script lang="ts">
  import type { RecordEntry } from '../../shared.js';
  import { taskClassification } from '../../../../../packages/core/management.js';
  import { dayKey, dateFromDay, calendarDays, shiftMonth, groupBy, isDay } from './workspace-views.js';
  import { statusNames, type Status, type Priority } from './presentation.js';
  import { ArrowLeft, ChevronRight, Plus } from './icons.js';
  import TagList from './TagList.svelte';
  import StatusSelect from './StatusSelect.svelte';
  import PriorityBadge from './PriorityBadge.svelte';
  import Pagination from './Pagination.svelte';
  import { pageWindow } from './pagination.js';

  let { view, records, disabled, today, onopen, onmove, oncreate }: {
    view: string; records: RecordEntry[]; disabled: boolean; today: string;
    onopen: (record: RecordEntry) => void; onmove: (record: RecordEntry, status: Status) => void;
    oncreate: (date: string) => void;
  } = $props();
  const statusTone = { Open: 'slate', 'In Progress': 'blue', Blocked: 'amber', Done: 'teal' };
  const quadrants = [
    { id: 'q1', label: 'Do first', hint: 'Urgent and important', tone: 'rose' },
    { id: 'q2', label: 'Schedule', hint: 'Important, not urgent', tone: 'blue' },
    { id: 'q3', label: 'Delegate', hint: 'Urgent, less important', tone: 'amber' },
    { id: 'q4', label: 'Consider dropping', hint: 'Neither urgent nor important', tone: 'violet' },
  ];
  let month = $state(dayKey(new Date()).slice(0, 7));
  let selectedDay = $state(dayKey(new Date()));
  let dayPage = $state(0);
  let pages = $state<Record<string, number>>({});
  let dragged = $state<{ record: RecordEntry; status: Status } | null>(null);
  let hover = $state<Status | null>(null);
  const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const buckets = $derived(view === 'board' ? groupBy(records, record => record.fields.status) : new Map<string, RecordEntry[]>());
  const days = $derived(view === 'calendar' ? groupBy(records, record => isDay(record.fields.due) ? record.fields.due : '') : new Map<string, RecordEntry[]>());
  const ranked = $derived.by(() => {
    if (view !== 'matrix') return new Map<string, (ReturnType<typeof taskClassification> & { record: RecordEntry })[]>();
    const date = dateFromDay(today);
    return groupBy(records.filter(record => record.fields.status !== 'Done').map(record => ({
      record, ...taskClassification(record, date),
    })), item => item.quadrant);
  });
  const dayItems = $derived(days.get(selectedDay) ?? []);
  const range = $derived(pageWindow(dayItems.length, dayPage));
  const displayedDay = $derived(selectedDay && dateFromDay(selectedDay).toLocaleDateString(undefined, { dateStyle: 'full' }));
  function chooseDay(day: string) { selectedDay = day; dayPage = 0; }
  function moveMonth(offset: number) {
    month = shiftMonth(month, offset);
    chooseDay(month === today.slice(0, 7) ? today : `${month}-01`);
  }
  function dragStart(event: DragEvent, record: RecordEntry) {
    if (disabled || !event.dataTransfer) { event.preventDefault(); return; }
    dragged = { record, status: record.fields.status };
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', record.id);
  }
  function dropTarget(event: DragEvent, status: Status) {
    if (disabled || !dragged || dragged.status === status) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    hover = status;
  }
  function drop(event: DragEvent, status: Status) {
    event.preventDefault();
    const current = dragged;
    dragged = null; hover = null;
    if (!disabled && current && current.status !== status && event.dataTransfer?.getData('text/plain') === current.record.id) onmove(current.record, status);
  }
  const priorityTone: Record<Priority, string> = { P0: 'rose', P1: 'amber', P2: 'blue', P3: 'slate' };
</script>

{#if view === 'board'}
  <div class="board" aria-label="Task board">
    {#each statusNames as status}
      {@const items = buckets.get(status) ?? []}
      {@const visible = pageWindow(items.length, pages[status] ?? 0, 12)}
      <section class="board-column" data-tone={statusTone[status]} class:drop-ready={hover === status}
        aria-label={`${status} column`} ondragover={event => dropTarget(event, status)}
        ondragleave={event => { if (!event.currentTarget.contains(event.relatedTarget instanceof Node ? event.relatedTarget : null) && hover === status) hover = null; }}
        ondrop={event => drop(event, status)}>
        <h2>{status}<span>{items.length}</span></h2>
        {#each items.slice(visible.start, visible.end) as task (task.id)}
          <article class="task-card" class:dragging={dragged?.record.id === task.id}>
            <button class="task-board-open" draggable={!disabled} onclick={() => onopen(task)}
              ondragstart={event => dragStart(event, task)} ondragend={() => { dragged = null; hover = null; }}>
              <strong>{task.title}</strong>
              <span class="task-card-meta"><PriorityBadge value={task.fields.priority} />{#if task.fields.due}<time datetime={task.fields.due}>{task.fields.due}</time>{/if}</span>
            </button>
            <div class="task-card-controls"><TagList tags={task.fields.tags} /><StatusSelect label={`Status for ${task.title}`} value={status} {disabled} onchange={value => onmove(task, value)} /></div>
          </article>
        {:else}
          <p class="column-empty">{dragged ? 'Drop here to move' : 'No matching tasks'}</p>
        {/each}
        {#if items.length > 12}<Pagination label={`${status} tasks`} total={items.length} size={12} page={pages[status] ?? 0} onchange={value => pages[status] = value} />{/if}
      </section>
    {/each}
  </div>
{:else if view === 'matrix'}
  <p class="subtle">Open tasks are placed automatically. Set importance or urgency on a task to override the suggestion.</p>
  <div class="matrix">
    {#each quadrants as quadrant}
      {@const items = ranked.get(quadrant.id) ?? []}
      {@const visible = pageWindow(items.length, pages[quadrant.id] ?? 0, 12)}
      <section class="matrix-quadrant" data-tone={quadrant.tone} aria-label={quadrant.label}>
        <header><h2>{quadrant.label} <span>{items.length}</span></h2><p>{quadrant.hint}</p></header>
        {#each items.slice(visible.start, visible.end) as item (item.record.id)}
          <button class="planning-item" onclick={() => onopen(item.record)}><strong>{item.record.title}</strong><span>{item.rationale}</span></button>
        {:else}<p class="column-empty">No matching open tasks</p>{/each}
        {#if items.length > 12}<Pagination label={quadrant.label} total={items.length} size={12} page={pages[quadrant.id] ?? 0} onchange={value => pages[quadrant.id] = value} />{/if}
      </section>
    {/each}
  </div>
{:else}
  <section class="task-calendar" aria-label="Task calendar">
    <header class="section-heading calendar-heading">
      <h2 aria-live="polite">{dateFromDay(`${month}-01`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</h2>
      <div class="button-row">
        <button aria-label="Previous month" onclick={() => moveMonth(-1)}><ArrowLeft size={16} aria-hidden="true" /></button>
        <button onclick={() => { month = today.slice(0, 7); chooseDay(today); }}>Today</button>
        <button aria-label="Next month" onclick={() => moveMonth(1)}><ChevronRight size={16} aria-hidden="true" /></button>
      </div>
    </header>
    <div class="calendar-grid">
      {#each weekdays as weekday}<span class="calendar-weekday">{weekday}</span>{/each}
      {#each calendarDays(month) as day (day)}
        {@const tasks = days.get(day) ?? []}
        <div class="calendar-cell" class:is-today={day === today} class:outside-month={!day.startsWith(month)} class:selected-day={day === selectedDay}>
          <button class="calendar-day-number" aria-label={`${dateFromDay(day).toLocaleDateString(undefined, { dateStyle: 'full' })}, ${tasks.length} ${tasks.length === 1 ? 'task' : 'tasks'}`} aria-pressed={day === selectedDay} aria-current={day === today ? 'date' : undefined} onclick={() => { month = day.slice(0, 7); chooseDay(day); }}>{Number(day.slice(8))}<span class="calendar-count">{tasks.length || ''}</span></button>
          {#each tasks.slice(0, 2) as task (task.id)}
            <button class="calendar-event" data-tone={priorityTone[task.fields.priority]} title={task.title} onclick={() => onopen(task)}>{task.title}</button>
          {/each}
          {#if tasks.length > 2}<button class="calendar-more" onclick={() => chooseDay(day)}>+{tasks.length - 2} more</button>{/if}
        </div>
      {/each}
    </div>
    <div class="section-heading calendar-day-header">
      <h2>{displayedDay || 'Undated tasks'}</h2>
      <div class="button-row"><button aria-pressed={!selectedDay} onclick={() => chooseDay('')}>Undated ({days.get('')?.length ?? 0})</button><button disabled={disabled} onclick={() => oncreate(selectedDay)}><Plus size={16} aria-hidden="true" />New task{selectedDay ? ' on this day' : ''}</button></div>
    </div>
    {#each dayItems.slice(range.start, range.end) as task (task.id)}
      <button class="overview-item" onclick={() => onopen(task)}><strong>{task.title}</strong><span>{task.fields.status}</span></button>
    {:else}<p class="subtle">{selectedDay ? 'No matching tasks due on this day.' : 'No matching undated tasks.'}</p>{/each}
    {#if dayItems.length > 0}<Pagination label="Selected day" total={dayItems.length} page={dayPage} onchange={value => dayPage = value} />{/if}
  </section>
{/if}
