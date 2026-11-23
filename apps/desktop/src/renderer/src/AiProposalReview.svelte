<script lang="ts">
  import type { AiProposal } from '../../shared.js';
  import { changedMetadata } from './proposal.js';

  let { proposal, disabled, onapprove, ondiscard }: {
    proposal: AiProposal; disabled: boolean; onapprove: () => void; ondiscard: () => void;
  } = $props();
  const changes = $derived(changedMetadata(proposal.before.fields, proposal.after.fields));
  const labels: Record<string, string> = {
    status: 'Status', priority: 'Priority', due: 'Due date', goal: 'SMART goal', measure: 'SMART measure',
    steps: 'SMART steps', why: 'SMART purpose', importance: 'Importance', urgency: 'Urgency',
    progress: 'Progress (%)', tags: 'Tags', folder: 'Folder', project: 'Project', parent: 'Parent', period: 'Period',
  };
  function display(value: unknown): string {
    if (value === undefined || value === null || value === '') return '(not set)';
    return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  }
</script>

<section class="ai-proposal-review" aria-label="Structured AI edit review">
  <h3>Review structured AI edit</h3>
  <p role="status">Nothing has been changed. Approval saves this edit directly to the selected record using its original revision.</p>
  <div class="ai-comparison-grid">
    {#each [{ label: 'Before', input: proposal.before }, { label: 'After', input: proposal.after }] as side}
      <div>
        <h4>{side.label}</h4>
        <p class="small subtle">Domain: {side.input.domain}</p>
        <label>{side.label} title<input aria-label={`${side.label} AI edit title`} readonly value={side.input.title} /></label>
        <label>{side.label} Markdown source<textarea aria-label={`${side.label} AI edit Markdown source`} rows="8" readonly value={side.input.body}></textarea></label>
      </div>
    {/each}
  </div>
  <h4>Changed task and SMART metadata</h4>
  {#if changes.length}
    <div class="ai-metadata-scroll">
      <table class="ai-metadata-diff">
        <caption class="sr-only">Structured AI edit metadata changes</caption>
        <thead><tr><th scope="col">Field</th><th scope="col">Before</th><th scope="col">After</th></tr></thead>
        <tbody>{#each changes as change}<tr><th scope="row">{labels[change.key] ?? change.key}</th><td><pre>{display(change.before)}</pre></td><td><pre>{display(change.after)}</pre></td></tr>{/each}</tbody>
      </table>
    </div>
  {:else}<p class="small subtle">No metadata changes proposed.</p>{/if}
  <div class="button-row">
    <button class="primary" {disabled} onclick={onapprove}>Approve and save AI edit</button>
    <button {disabled} onclick={ondiscard}>Discard AI edit</button>
  </div>
</section>
