<script lang="ts">
  import { tagTone } from './presentation.js';
  let { tags, limit = 3 }: { tags: readonly string[]; limit?: number } = $props();
</script>

{#if tags.length}
  <span class="tag-list" role="list" aria-label="Tags">
    {#each tags.slice(0, limit) as tag}
      <span class="tag-chip" role="listitem" data-tone={tagTone(tag)} title={tag}>{tag}</span>
    {/each}
    {#if tags.length > limit}
      <span class="tag-chip tag-more" role="listitem" title={tags.slice(limit).join(', ')}>
        <span aria-hidden="true">+{tags.length - limit}</span><span class="sr-only">More tags: {tags.slice(limit).join(', ')}</span>
      </span>
    {/if}
  </span>
{/if}
