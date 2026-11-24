<script module lang="ts">
  import { BookOpen, Flag, GraduationCap, TrendingUp } from './icons.js';
  export const conceptIcons = { knowledge: BookOpen, milestones: Flag, learning: GraduationCap, growth: TrendingUp };
</script>

<script lang="ts">
  import type { RecordEntry } from '../../shared.js';
  import { Plus } from './icons.js';
  import { conceptKinds, isConcept, type ConceptKind } from '../../../../../packages/core/concept-folders.js';
  import { kindNames, tones, type Tone } from './workspace-views.js';
  import Pagination from './Pagination.svelte';
  import { pageWindow } from './pagination.js';
  import TagList from './TagList.svelte';

  let { records, folder, kind, palette, disabled, oncolor, onopen, oncreate }: {
    records: RecordEntry[]; folder: string | null; kind: ConceptKind | '';
    palette: Record<ConceptKind, Tone>; disabled: boolean;
    oncolor: (kind: ConceptKind, tone: Tone) => void;
    onopen: (record: RecordEntry) => void; oncreate: (kind: ConceptKind) => void;
  } = $props();
  let scope = $state('');
  let page = $state(0);
  const matching = $derived(records.filter(record => (!kind || record.domain === kind) &&
    (folder === null || record.fields.folder === folder)));
  const range = $derived(pageWindow(matching.length, page));
  $effect(() => {
    const next = JSON.stringify([folder, kind]);
    if (scope !== next) { scope = next; page = 0; }
  });
</script>

  <section class="concept-items" aria-label="Concept items">
    <h2>{folder === null ? kind ? kindNames[kind] : 'All concepts' : `${folder || 'Unfiled'}${kind ? ` / ${kindNames[kind]}` : ''}`}</h2>
    <div class="concept-create button-row" aria-label="Create by kind">
      {#each conceptKinds as item}
        {@const Icon = conceptIcons[item]}
        <button aria-label={`New ${kindNames[item].toLowerCase()}`} data-tone={palette[item]} {disabled} onclick={() => oncreate(item)}><Plus size={14} aria-hidden="true" /><Icon size={16} aria-hidden="true" />{kindNames[item]}</button>
      {/each}
    </div>
    {#each matching.slice(range.start, range.end) as record (record.id)}
      {#if isConcept(record.domain)}
        {@const Icon = conceptIcons[record.domain]}
        <article class="concept-entry">
          <button class="overview-item" title={record.title} onclick={() => onopen(record)}>
            <span class="overview-task"><span class="kind-badge" data-tone={palette[record.domain]}><Icon size={16} aria-hidden="true" />{kindNames[record.domain]}</span><strong>{record.title}</strong></span>
            <span class="subtle small">{record.fields.folder}{#if record.domain === 'milestones' && record.fields.due} / {record.fields.due}{/if}</span>
          </button>
          <TagList tags={record.fields.tags} />
        </article>
      {/if}
    {:else}<p class="section-empty subtle">No matching concepts here. Choose a kind above to create one.</p>{/each}
    {#if matching.length}<Pagination label="Concepts" total={matching.length} {page} onchange={value => page = value} />{/if}
    <details class="concept-appearance"><summary>Kind colors</summary><p class="small subtle">These colors are remembered for this workspace on this device.</p><div class="button-row">
      {#each conceptKinds as item}
        <label>{kindNames[item]}<select aria-label={`${kindNames[item]} color`} value={palette[item]} onchange={event => {
          const tone = tones.find(value => value === event.currentTarget.value); if (tone) oncolor(item, tone);
        }}>{#each tones as tone}<option value={tone}>{tone[0].toUpperCase() + tone.slice(1)}</option>{/each}</select></label>
      {/each}
    </div></details>
  </section>
