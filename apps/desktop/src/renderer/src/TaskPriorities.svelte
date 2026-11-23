<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { RecordEntry } from '../../../../../packages/core/types.js';
  import type { ManagementPriority } from '../../../../../packages/core/management-types.js';
  import Pagination from './Pagination.svelte';
  import { pageWindow } from './pagination.js';
  let { workspaceId, onselect, onerror }: { workspaceId: string; onselect: (record: RecordEntry) => void; onerror: (message: string) => void } = $props();
  let asOf = $state(new Date().toISOString().slice(0, 10));
  let items = $state.raw<ManagementPriority[] | null>(null);
  let busy = $state(false);
  let page = $state(0);
  let alive = true;
  const range = $derived(pageWindow(items?.length ?? 0, page));
  const quadrantNames = { q1: 'Do first', q2: 'Schedule', q3: 'Delegate', q4: 'Consider dropping' };
  async function prioritize() {
    if (busy || !asOf) return;
    const ws = workspaceId;
    busy = true;
    try {
      const result = await window.catpilot.request({ action: 'management', workspaceId: ws, request: { action: 'prioritize', asOf } }) as ManagementPriority[];
      if (alive && ws === workspaceId) { items = result; page = 0; }
    } catch (cause) { if (alive && ws === workspaceId) onerror(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (alive) busy = false; }
  }
  onDestroy(() => { alive = false; });
</script>
<details class="card" aria-label="Task prioritization">
  <summary>SMART & focus prioritization</summary>
  <p class="small subtle">Computes priorities from all open tasks. Existing tasks are not rewritten.</p>
  <label>Prioritize as of<input aria-label="Prioritize as of" type="date" bind:value={asOf} disabled={busy} /></label>
  <div class="button-row"><button disabled={busy || !asOf} onclick={() => void prioritize()}>{busy ? 'Prioritizing...' : 'Prioritize tasks'}</button></div>
  {#if items}
    <p role="status">{items.length} open tasks ranked</p>
    {#each items.slice(range.start, range.end) as item}
      <button class="overview-item stacked" onclick={() => onselect(item.record)}><strong>{item.record.title}</strong><span>{quadrantNames[item.quadrant]} / SMART {item.smart.score}/{item.smart.max} ({item.smart.percent}%)</span><span class="small subtle">{item.smart.missing.length ? `Missing: ${item.smart.missing.join(', ')}` : item.smart.label}</span></button>
    {/each}
    <Pagination label="Prioritized tasks" total={items.length} page={page} onchange={value => page = value} />
  {/if}
</details>
