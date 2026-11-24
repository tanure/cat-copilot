<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { RecordEntry } from '../../../../../packages/core/types.js';
  import type { ManagementReport } from '../../../../../packages/core/management-types.js';
  import Pagination from './Pagination.svelte';
  import MarkdownEditor from './MarkdownEditor.svelte';
  import { pageWindow } from './pagination.js';
  let { workspaceId, onselect, oncreate, onerror }: {
    workspaceId: string; onselect: (record: RecordEntry) => void;
    oncreate: (report: ManagementReport) => void; onerror: (message: string) => void;
  } = $props();
  const today = new Date().toISOString().slice(0, 10);
  let from = $state(`${today.slice(0, 7)}-01`);
  let to = $state(today);
  let busy = $state(false);
  let report = $state.raw<ManagementReport | null>(null);
  let page = $state(0);
  let achievementPage = $state(0);
  let alive = true;
  const range = $derived(pageWindow(report?.records.length ?? 0, page));
  const achievementRange = $derived(pageWindow(report?.achievements.length ?? 0, achievementPage));
  async function generate() {
    if (busy || !workspaceId || !from || !to || from > to) return;
    const ws = workspaceId;
    busy = true;
    try {
      const result = await window.catpilot.request({ action: 'management', workspaceId: ws, request: { action: 'report', from, to } }) as ManagementReport;
      if (alive && workspaceId === ws) { report = result; page = 0; achievementPage = 0; }
    } catch (cause) { if (alive && ws === workspaceId) onerror(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (alive) busy = false; }
  }
  onDestroy(() => { alive = false; });
</script>

<section class="card" aria-label="Report generator">
  <h2>Generate a workspace report</h2>
  <p class="subtle small">Read-only until you explicitly create and save a report document. Completion achievements are derived, not additional records.</p>
  <div class="metadata-grid"><label>Report from<input aria-label="Report from" type="date" bind:value={from} disabled={busy} /></label><label>Report to<input aria-label="Report to" type="date" bind:value={to} disabled={busy} /></label></div>
  <div class="button-row"><button disabled={busy || !from || !to || from > to} onclick={() => void generate()}>{busy ? 'Generating...' : 'Generate report'}</button></div>
  {#if from > to}<p class="error" role="alert">The report start must be on or before its end.</p>{/if}
  {#if report}
    <h3>Report: {report.from} to {report.to}</h3>
    <p role="status">{report.records.length} records / {report.achievements.length} derived completion achievements</p>
    <div class="report-counts">{#each Object.entries(report.counts) as [domain, count]}<span>{domain}: {count}</span>{/each}</div>
    <details><summary>Included records ({report.records.length})</summary>
      {#each report.records.slice(range.start, range.end) as record}<button class="overview-item" onclick={() => onselect(record)}>{record.title}<span class="subtle small">{record.domain}</span></button>{/each}
      <Pagination label="Report records" total={report.records.length} page={page} onchange={value => page = value} />
    </details>
    <details><summary>Derived achievements ({report.achievements.length})</summary>
      {#each report.achievements.slice(achievementRange.start, achievementRange.end) as achievement}<p class="history-entry">{achievement.title} / {achievement.completed}</p>{/each}
      <Pagination label="Report achievements" total={report.achievements.length} page={achievementPage} onchange={value => achievementPage = value} />
    </details>
    <div class="rich-field"><span class="field-label">Generated report</span><MarkdownEditor value={report.markdown} {workspaceId} label="Generated report" sourceLabel="Generated report Markdown" readOnly /></div>
    <div class="button-row"><button class="primary" onclick={() => report && oncreate(report)}>Create report document</button></div>
  {/if}
</section>
