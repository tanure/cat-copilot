<script lang="ts">
  import type { RecordEntry } from '../../shared.js';
  import { createRollup } from '../../../../../packages/core/management.js';
  import { Flag, FolderKanban } from './icons.js';
  let { projects, records, onopen }: {
    projects: RecordEntry[]; records: RecordEntry[]; onopen: (record: RecordEntry) => void;
  } = $props();
  const rollup = $derived(createRollup(records));
  function summarize(project: RecordEntry, derive: typeof rollup) {
    try {
      const progress = derive(project);
      const next = progress.children.filter(item => item.domain === 'milestones' && item.fields.status !== 'Done' && item.fields.due)
        .sort((a, b) => a.fields.due.localeCompare(b.fields.due))[0];
      return { progress, next, blockers: progress.children.filter(item => item.fields.status === 'Blocked').length, error: '' };
    } catch (error) { return { error: error instanceof Error ? error.message : String(error) }; }
  }
</script>

<div class="project-portfolio">
  {#each projects as project (project.id)}
    {@const data = summarize(project, rollup)}
    <article class="project-summary">
      <button class="project-title" onclick={() => onopen(project)}><span class="kind-badge" data-tone="blue"><FolderKanban size={18} aria-hidden="true" /></span><strong>{project.title}</strong></button>
      <p>{project.fields.goal || (typeof project.fields.summary === 'string' ? project.fields.summary : '') || 'No project goal yet.'}</p>
      {#if data.progress}
        <div class="project-progress"><span>{data.progress.total ? `${data.progress.completed} of ${data.progress.total} linked items complete` : 'No trackable linked work'}</span><strong>{data.progress.progress}%</strong></div>
        <progress value={data.progress.progress} max="100" aria-label={`${project.title} progress`}></progress>
        <div class="project-signals">
          <span><Flag size={14} aria-hidden="true" />{#if data.next}{data.next.title} / {data.next.fields.due}{:else}No dated milestone{/if}</span>
          {#if data.blockers}<span class="kind-badge" data-tone="amber">{data.blockers} blocked</span>{/if}
        </div>
      {:else}<p class="error">{data.error}</p>{/if}
    </article>
  {/each}
</div>
