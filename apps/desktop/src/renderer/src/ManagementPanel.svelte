<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { RecordEntry } from '../../shared.js';
  import type { ManagementRequest, ManagementRollup, ManagementResult } from '../../../../../packages/core/management-types.js';
  import Pagination from './Pagination.svelte';
  import MarkdownEditor from './MarkdownEditor.svelte';
  import AssetPreview from './AssetPreview.svelte';
  import { pageWindow } from './pagination.js';

  let { workspaceId, record, disabled, hasChildren, onbusy, onupdate, onerror }: {
    workspaceId: string; record: RecordEntry; disabled: boolean; hasChildren: boolean;
    onbusy: (busy: boolean) => void; onupdate: (record: RecordEntry) => void; onerror: (message: string) => void;
  } = $props();
  let action = $state('');
  let text = $state('');
  let historyKind = $state<'comments' | 'logs' | 'log' | 'carryHistory'>('comments');
  let historyPage = $state(0);
  let destination = $state('');
  let rollup = $state<ManagementRollup | null>(null);
  let alive = true;
  let editing = $state<{ collection: 'comments' | 'logs' | 'log'; index: number; revision: string; text: string } | null>(null);
  let deleting = $state<{ collection: 'comments' | 'logs' | 'log'; index: number; revision: string } | null>(null);
  const isContainer = $derived(['projects', 'learning'].includes(record.domain));
  const completable = $derived(['tasks', 'projects', 'learning', 'milestones', 'growth', 'pomodoro'].includes(record.domain));
  const history = $derived(Array.isArray(record.fields[historyKind]) ? record.fields[historyKind] as unknown[] : []);
  const range = $derived(pageWindow(history.length, historyPage));
  const visibleHistory = $derived(history.slice(range.start, range.end));
  const busy = $derived(disabled || !!action);
  function editable(value: unknown): value is { text: string } {
    return !!value && typeof value === 'object' && !Array.isArray(value) && 'text' in value && typeof value.text === 'string';
  }
  function historyLabel(index: number) { return `${historyKind === 'comments' ? 'comment' : 'activity log'} ${index + 1}`; }
  function historyTime(value: unknown): string {
    if (!value || typeof value !== 'object' || !('at' in value) || typeof value.at !== 'string') return '';
    const time = new Date(value.at);
    return Number.isNaN(time.getTime()) ? value.at : time.toLocaleString();
  }
  function historyText(value: unknown): string {
    if (!value || typeof value !== 'object') return JSON.stringify(value);
    const item = value as { text?: unknown; at?: unknown; from?: unknown; to?: unknown };
    return historyKind === 'carryHistory' ? `${String(item.from || 'Unscheduled')} -> ${String(item.to || '')}\n${String(item.at || '')}`
      : `${String(item.text ?? '')}\n${String(item.at ?? '')}`;
  }
  async function execute(request: ManagementRequest) {
    if (busy) return;
    const ws = workspaceId; const id = record.id;
    action = request.action; onbusy(true);
    try {
      const result = await window.catpilot.request({ action: 'management', workspaceId: ws, request }) as ManagementResult;
      if (!alive || ws !== workspaceId || id !== record.id) return;
      if (request.action === 'rollup') rollup = result as ManagementRollup;
      else {
        onupdate(result as RecordEntry);
        if (request.action === 'comment' || request.action === 'log') text = '';
        if (request.action === 'carryForward') destination = '';
        if (request.action === 'editComment') editing = null;
        if (request.action === 'removeComment') deleting = null;
      }
    } catch (cause) { if (alive && ws === workspaceId && id === record.id) onerror(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (alive) { action = ''; onbusy(false); } }
  }
  onDestroy(() => { alive = false; });
</script>

<section class="management-panel" aria-label="Record management">
  <h2>Manage this item</h2>
  {#if disabled}<p class="editor-notice">Save pending edits before updating history, carrying forward, or completing this item.</p>{/if}
  {#if record.domain === 'tasks'}
    <div class="rich-field"><span class="field-label">Comment or activity log</span><MarkdownEditor value={text} {workspaceId} label="Task comment or log" sourceLabel="Task comment or log Markdown" maxLength={100_000} compact attachments={false} disabled={busy} onchange={value => text = value} /></div>
    <div class="button-row">
      <button disabled={busy || !text.trim() || text.length > 100_000} onclick={() => { historyKind = 'comments'; void execute({ action: 'comment', id: record.id, expectedRevision: record.revision, text }); }}>Add comment</button>
      <button disabled={busy || !text.trim() || text.length > 100_000} onclick={() => { historyKind = 'logs'; void execute({ action: 'log', id: record.id, expectedRevision: record.revision, text }); }}>Add activity log</button>
    </div>
    <div class="tabs" aria-label="Task history">
      {#each [{ id: 'comments', label: 'Comments' }, { id: 'logs', label: 'Activity logs' }, { id: 'carryHistory', label: 'Carry-forward history' }] as tab}
        <button class:active={historyKind === tab.id} onclick={() => { historyKind = tab.id as typeof historyKind; historyPage = 0; }}>{tab.label}</button>
      {/each}
      {#if Array.isArray(record.fields.log) && record.fields.log.length}<button class:active={historyKind === 'log'} onclick={() => { historyKind = 'log'; historyPage = 0; }}>Legacy activity logs</button>{/if}
    </div>
    <div class="history-list">{#each visibleHistory as entry, offset}
      {@const index = range.start + offset}
      <article class="history-item">
        {#if historyKind !== 'carryHistory' && editable(entry)}<div class="history-entry"><AssetPreview value={entry.text} {workspaceId} />{#if historyTime(entry)}<p class="small subtle">{historyTime(entry)}</p>{/if}</div>{:else}<pre class="history-entry">{historyText(entry)}</pre>{/if}
        {#if historyKind !== 'carryHistory' && editable(entry)}
          {#if editing?.collection === historyKind && editing.index === index}
            <div class="rich-field"><span class="field-label">Edit {historyLabel(index)}</span><MarkdownEditor value={editing.text} {workspaceId} label={`Edit ${historyLabel(index)}`} sourceLabel={`Edit ${historyLabel(index)} Markdown`} maxLength={100_000} compact attachments={false} disabled={busy} onchange={value => { if (editing) editing.text = value; }} /></div>
            <div class="button-row"><button disabled={busy || !editing.text.trim() || editing.text.length > 100_000} onclick={() => { if (editing) void execute({ action: 'editComment', id: record.id, expectedRevision: editing.revision, collection: editing.collection, index: editing.index, text: editing.text }); }}>Save {historyLabel(index)}</button><button disabled={!!action} onclick={() => editing = null}>Cancel history edit</button></div>
          {:else if deleting?.collection === historyKind && deleting.index === index}
            <p>Remove this history entry from the record?</p>
            <div class="button-row"><button class="danger-quiet" disabled={busy} onclick={() => { if (deleting) void execute({ action: 'removeComment', id: record.id, expectedRevision: deleting.revision, collection: deleting.collection, index: deleting.index }); }}>Confirm delete {historyLabel(index)}</button><button disabled={!!action} onclick={() => deleting = null}>Cancel history deletion</button></div>
          {:else}
            <div class="button-row"><button disabled={busy} onclick={() => { if (historyKind !== 'carryHistory') { deleting = null; editing = { collection: historyKind, index, revision: record.revision, text: entry.text }; } }}>Edit {historyLabel(index)}</button><button disabled={busy} onclick={() => { if (historyKind !== 'carryHistory') { editing = null; deleting = { collection: historyKind, index, revision: record.revision }; } }}>Delete {historyLabel(index)}</button></div>
          {/if}
        {/if}
      </article>
    {/each}{#if !history.length}<p class="subtle small">No history in this category.</p>{/if}</div>
    <Pagination label="Task history" total={history.length} page={historyPage} onchange={value => historyPage = value} />
    <h3>Carry forward</h3>
    <p class="small subtle">Current period: {record.fields.period || 'not scheduled'}. Choose a later period with the same granularity: YYYY-MM-DD, YYYY-Www, or YYYY-MM.</p>
    <label>Destination period<input aria-label="Carry-forward period" bind:value={destination} placeholder="2026-W48" disabled={busy || record.fields.status === 'Done'} /></label>
    <button disabled={busy || !destination.trim() || record.fields.status === 'Done'} onclick={() => void execute({ action: 'carryForward', id: record.id, expectedRevision: record.revision, period: destination.trim() })}>Carry task forward</button>
  {/if}
  {#if isContainer}
    <div class="section-heading"><h3>Progress rollup</h3><button disabled={busy} onclick={() => void execute({ action: 'rollup', id: record.id })}>Refresh rollup</button></div>
    <p class="small subtle">Container completion is derived from all descendant leaves. It never writes a misleading parent Done status.</p>
    {#if rollup}
      <p role="status">{rollup.completed} of {rollup.total} leaf items complete / {rollup.progress}% progress</p>
      <progress max="100" value={rollup.progress} aria-label="Derived completion progress"></progress>
      <p>{rollup.canComplete ? 'All descendant work is complete.' : 'Work remains before this container is complete.'}</p>
    {/if}
  {/if}
  {#if completable}
    <div class="button-row"><button class="primary" disabled={busy || record.fields.status === 'Done' || (isContainer && hasChildren)} onclick={() => void execute({ action: 'complete', id: record.id, expectedRevision: record.revision })}>Complete item</button></div>
    {#if isContainer && hasChildren}<p class="editor-notice">Complete the child items, then refresh the derived rollup. Containers with children are not completed by a separate write.</p>{/if}
  {/if}
  {#if action}<p role="status" class="small subtle">Running {action}...</p>{/if}
</section>
