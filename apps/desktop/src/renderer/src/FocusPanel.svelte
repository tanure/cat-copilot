<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import type { RecordEntry } from '../../shared.js';
  import type { ManagementRequest, ManagementTimerStatus } from '../../../../../packages/core/management-types.js';
  import MarkdownEditor from './MarkdownEditor.svelte';
  import { Timer, ListTodo, CircleCheck } from './icons.js';
  import { focusTaskIds } from './workspace-views.js';
  let { workspaceId, records, tasks, seed, onseedused, disabled, onbusy, onupdate, onerror }: {
    workspaceId: string; records: RecordEntry[]; disabled: boolean; onbusy: (value: boolean) => void;
    tasks: RecordEntry[]; seed: string; onseedused: () => void;
    onupdate: (record: RecordEntry) => void; onerror: (message: string) => void;
  } = $props();
  const modes = [{ id: 'focus', label: 'Focus', minutes: 25 }, { id: 'short-break', label: 'Short break', minutes: 5 }, { id: 'long-break', label: 'Long break', minutes: 15 }] as const;
  let status = $state<ManagementTimerStatus | null>(null);
  let statusError = $state('');
  let purpose = $state('');
  let minutes = $state<number | undefined>(25);
  let type = $state<'focus' | 'short-break' | 'long-break'>('focus');
  let selected = $state<string[]>([]);
  let taskSearch = $state('');
  let pickerOpen = $state(false);
  let notes = $state('');
  let action = $state('');
  let tick = $state(Date.now());
  let observedAt = $state(Date.now());
  let mounted = $state(false);
  let seen = '';
  let alive = true;
  let generation = 0;
  const busy = $derived(disabled || !!action);
  const taskMap = $derived(new Map(tasks.map(task => [task.id, task])));
  const available = $derived(tasks.filter(task => task.fields.status !== 'Done' || selected.includes(task.id)));
  const matching = $derived(available.filter(task => task.title.toLocaleLowerCase().includes(taskSearch.trim().toLocaleLowerCase())));
  const validMinutes = $derived(minutes !== undefined && Number.isInteger(minutes) && minutes >= 1 && minutes <= 1440);
  const remaining = $derived(status?.active ? Math.max(0, status.remainingSec - Math.floor((tick - observedAt) / 1000)) : 0);
  const display = $derived(formatTime(status?.active ? remaining : (validMinutes ? minutes ?? 0 : 0) * 60));
  const active = $derived(status?.active);
  const activeTasks = $derived(active ? focusTaskIds(active.fields) : []);
  const progress = $derived(active ? Math.max(0, Math.min(1, 1 - remaining / (active.fields.minutes * 60))) : 0);
  const modeName = $derived(modes.find(mode => mode.id === (active ? active.fields.type : type))?.label ?? 'Focus');
  const purposeText = $derived(active && typeof active.fields.focusPurpose === 'string' ? active.fields.focusPurpose : '');
  function formatTime(seconds: number) {
    const hours = Math.floor(seconds / 3600);
    return `${hours ? `${hours}:` : ''}${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  }
  function chooseTask(id: string) {
    if (selected.includes(id)) selected = selected.filter(item => item !== id);
    else if (selected.length < 50) selected = [...selected, id];
  }
  function start() {
    if (!validMinutes || minutes === undefined || (type === 'focus' && selected.some(id => !taskMap.has(id)))) return;
    void execute({ action: 'timerStart', minutes, type, purpose, tasks: type === 'focus' ? $state.snapshot(selected) : [] });
  }
  $effect(() => {
    if (!seed) return;
    if (!selected.includes(seed)) selected = [seed, ...selected].slice(0, 50);
    type = 'focus'; minutes = 25; pickerOpen = true;
    onseedused();
  });
  async function hydrate() {
    const ws = workspaceId; const current = ++generation;
    try {
      const result = await window.catpilot.request({ action: 'management', workspaceId: ws, request: { action: 'timerStatus' } }) as ManagementTimerStatus;
      if (!alive || ws !== workspaceId || current !== generation) return;
      status = result; observedAt = Date.now(); tick = observedAt; statusError = '';
    } catch (cause) {
      if (alive && ws === workspaceId && current === generation) {
        statusError = cause instanceof Error ? cause.message : String(cause); status = null;
      }
    }
  }
  async function execute(request: ManagementRequest) {
    if (busy) return;
    const ws = workspaceId;
    generation++; action = request.action; onbusy(true);
    try {
      const saved = await window.catpilot.request({ action: 'management', workspaceId: ws, request }) as RecordEntry;
      if (!alive || ws !== workspaceId) return;
      onupdate(saved);
      if (request.action === 'timerStart') { purpose = ''; selected = []; taskSearch = ''; pickerOpen = false; }
      notes = '';
      await hydrate();
    } catch (cause) { if (alive && ws === workspaceId) onerror(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (alive) { action = ''; onbusy(false); } }
  }
  $effect(() => {
    const signature = JSON.stringify([workspaceId, records.filter(record => record.domain === 'pomodoro').map(record => [record.id, record.revision])]);
    if (mounted && signature !== seen) { seen = signature; void hydrate(); }
  });
  onMount(() => { mounted = true; const clock = window.setInterval(() => tick = Date.now(), 1000); return () => clearInterval(clock); });
  onDestroy(() => { alive = false; generation++; });
</script>

<section class="focus-panel" aria-label="Persisted Focus timer">
  {#if statusError}<p role="alert" class="error">{statusError}</p><button disabled={busy} onclick={() => void hydrate()}>Retry timer status</button>
  {:else if !status}<p role="status">Loading timer…</p>
  {:else}
    <div class="focus-workbench">
      <div class="focus-clock" data-tone={modeName === 'Focus' ? 'teal' : 'blue'}>
        <div class="focus-clock-heading"><Timer size={20} aria-hidden="true" /><h2>{active ? modeName : 'Pomodoro'}</h2></div>
        <output class="timer focus-time" aria-label={active ? 'Focus time remaining' : 'Planned time'} aria-live="off">{display}</output>
        {#if active}
          <progress aria-label="Time elapsed" value={progress} max="1"></progress>
          <p role="status">{remaining === 0 ? 'Time’s up. Complete the session to log it.' : 'Timer running'}</p>
        {:else}
          <p>{modeName} · {validMinutes ? `${minutes} min` : 'Set a duration'}</p>
        {/if}
      </div>
      {#if active}
        <div class="focus-controls">
          <h3>{active.title}</h3>
          {#if purposeText && purposeText !== active.title}<p class="focus-purpose">{purposeText}</p>{/if}
          {#if activeTasks.length}<ul class="focus-scope-list" aria-label="Session tasks">{#each activeTasks as id (id)}<li><ListTodo size={16} aria-hidden="true" />{taskMap.get(id)?.title ?? 'Task no longer available'}</li>{/each}</ul>{/if}
          {#if selected.length}<p class="small subtle">Your task selection is ready for the next session.</p>{/if}
          <div class="button-row focus-actions">
            <button class="primary" disabled={busy || notes.length > 100_000} onclick={() => void execute({ action: 'timerComplete', id: active.id, expectedRevision: active.revision, notes })}><CircleCheck size={17} aria-hidden="true" />Complete focus session</button>
            <button disabled={busy || notes.length > 100_000} onclick={() => void execute({ action: 'timerCancel', id: active.id, expectedRevision: active.revision, notes })}>Cancel focus session</button>
          </div>
          <details class="focus-notes"><summary>Session notes <span class="subtle">Optional</span></summary>
            <MarkdownEditor value={notes} {workspaceId} label="Focus completion notes" sourceLabel="Focus completion notes Markdown" maxLength={100_000} compact attachments={false} disabled={busy} onchange={value => notes = value} />
          </details>
          <p class="small subtle">The timer keeps running when you leave this page.</p>
        </div>
      {:else}
        <form class="focus-controls" onsubmit={event => { event.preventDefault(); start(); }}>
          <div role="group" aria-label="Focus session type" class="focus-modes">
            {#each modes as mode (mode.id)}<button type="button" aria-pressed={type === mode.id} disabled={busy} onclick={() => { type = mode.id; minutes = mode.minutes; }}>{mode.label}</button>{/each}
          </div>
          <div class="focus-form-fields">
            <label>Purpose <span class="subtle">Optional</span><input aria-label="Session purpose" maxlength="500" placeholder="What do you want to get done?" bind:value={purpose} disabled={busy} /></label>
            <label>Minutes<input aria-label="Focus duration minutes" type="number" min="1" max="1440" step="1" required bind:value={minutes} disabled={busy} /></label>
          </div>
          {#if type === 'focus'}
            <details class="focus-task-picker" bind:open={pickerOpen}>
              <summary><ListTodo size={17} aria-hidden="true" />Tasks <span class="subtle">{selected.length ? `${selected.length} selected` : 'Optional'}</span></summary>
              {#if selected.length}
                <ul class="focus-selected" aria-label="Selected focus tasks">
                  {#each selected as id (id)}<li><button type="button" disabled={busy} aria-label={`Remove ${taskMap.get(id)?.title ?? 'unavailable task'}`} onclick={() => chooseTask(id)}>{taskMap.get(id)?.title ?? 'Task no longer available'} <span aria-hidden="true">&times;</span></button></li>{/each}
                </ul>
              {/if}
              {#if available.length}
                <input type="search" aria-label="Find tasks for focus" placeholder="Find an open task…" bind:value={taskSearch} disabled={busy} />
                <div class="focus-task-options">
                  {#each matching.slice(0, 25) as task (task.id)}
                    <label><input type="checkbox" checked={selected.includes(task.id)} disabled={busy || (selected.length >= 50 && !selected.includes(task.id))} onchange={() => chooseTask(task.id)} /><span>{task.title}</span></label>
                  {:else}<p class="small subtle">No tasks match your search.</p>{/each}
                </div>
                {#if matching.length > 25}<p class="small subtle">Showing 25 of {matching.length}. Search to find other tasks.</p>{/if}
                {#if selected.length >= 50}<p class="small subtle">You can link up to 50 tasks.</p>{/if}
              {:else}<p class="small subtle">No open tasks in this workspace. You can still start a session.</p>{/if}
            </details>
            {#if selected.some(id => !taskMap.has(id))}<p class="error" role="alert">Remove unavailable tasks before starting.</p>{/if}
          {/if}
          <div class="button-row focus-actions"><button class="primary" disabled={busy || !validMinutes || (type === 'focus' && selected.some(id => !taskMap.has(id)))}>{type === 'focus' ? 'Start focus session' : 'Start break'}</button></div>
        </form>
      {/if}
    </div>
  {/if}
  {#if action}<p class="small subtle" role="status">Saving session…</p>{/if}
</section>
