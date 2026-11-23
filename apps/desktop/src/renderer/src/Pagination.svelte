<script lang="ts">
  import { pageWindow } from './pagination.js';

  let { label, total, page, size, onchange }: {
    label: string; total: number; page: number; size?: number; onchange: (page: number) => void;
  } = $props();
  const range = $derived(pageWindow(total, page, size));
</script>

<div class="pagination" role="group" aria-label={`${label} pagination`}>
  <span class="pagination-range" role="status" aria-label={`${label} range`}>Showing {total ? range.start + 1 : 0}-{range.end} of {total}</span>
  {#if range.pages > 1}
    <div class="pagination-actions">
      <button aria-label={`${label}: previous page`} disabled={range.page === 0} onclick={() => onchange(range.page - 1)}>Previous</button>
      <label class="pagination-jump">Page
        <input aria-label={`${label}: page`} type="number" min="1" max={range.pages} step="1" value={range.page + 1} onchange={event => {
          const next = pageWindow(total, event.currentTarget.valueAsNumber - 1, size);
          event.currentTarget.value = String(next.page + 1);
          onchange(next.page);
        }} />
        <span>of {range.pages}</span>
      </label>
      <button aria-label={`${label}: next page`} disabled={range.page === range.pages - 1} onclick={() => onchange(range.page + 1)}>Next</button>
    </div>
  {/if}
</div>
