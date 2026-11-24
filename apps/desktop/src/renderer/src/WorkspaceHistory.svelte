<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { Domain, RecordEntry } from '../../shared.js';
  import { dayKey, dateFromDay, journalDay, groupBy, activityEvents, kindNames, kindTones } from './workspace-views.js';
  import { NotebookPen, History } from './icons.js';
  import Pagination from './Pagination.svelte';
  import { pageWindow } from './pagination.js';

  let { view, records, today, month = '', navigation, onopen, oncreate, disabled }: {
    view: 'journal' | 'timeline'; records: RecordEntry[]; today: string;
    month?: string; navigation?: Snippet; onopen: (record: RecordEntry) => void; oncreate: (day: string) => void; disabled: boolean;
  } = $props();
  let chosen = $state(dayKey(new Date()));
  let from = $state('');
  let kind = $state('');
  let search = $state('');
  let page = $state(0);
  const kinds = $derived([...new Set(records.map(record => record.domain))].sort((a, b) => kindNames[a].localeCompare(kindNames[b])));
  const events = $derived(view === 'timeline' ? activityEvents(records) : []);
  const entries = $derived(view === 'journal' ? records.filter(record => record.domain === 'journal').map(record => ({ record, day: journalDay(record) }))
    .sort((a, b) => b.day.localeCompare(a.day) || Date.parse(b.record.created) - Date.parse(a.record.created)) : []);
  const query = $derived(search.trim().toLocaleLowerCase());
  const timeline = $derived(events.filter(event => (!kind || kind === event.record.domain) &&
    (!from || dayKey(new Date(event.at)) === from) && (!query || event.record.title.toLocaleLowerCase().includes(query))));
  const journal = $derived(entries.filter(entry => (!month || entry.day.startsWith(`${month}-`)) && (!from || entry.day === from) &&
    (!query || `${entry.record.title} ${entry.record.body} ${entry.record.fields.tags.join(' ')}`.toLocaleLowerCase().includes(query))));
  const count = $derived(view === 'timeline' ? timeline.length : journal.length);
  const range = $derived(pageWindow(count, page));
  const eventGroups = $derived(groupBy(timeline.slice(range.start, range.end), event => dayKey(new Date(event.at))));
  const entryGroups = $derived(groupBy(journal.slice(range.start, range.end), entry => entry.day));
  $effect(() => { if (month !== undefined) { from = ''; page = 0; } });
  function dayLabel(day: string) { return dateFromDay(day).toLocaleDateString(undefined, { dateStyle: 'full' }); }
  function excerpt(body: string) {
    return body.trim().replace(/\s+/g, ' ').slice(0, 170);
  }
  function tone(domain: Domain) { return kindTones[domain]; }
</script>

<section class="page-content history-page">
  <div class="page-intro"><div>
    <h1>{view === 'journal' ? 'Journal' : 'Timeline'}</h1>
    <p class="lead">{view === 'journal' ? 'Write about today or revisit a past date.' : 'Creations, latest edits, and recorded completions in this workspace.'}</p>
  </div></div>
  {@render navigation?.()}
  {#if view === 'journal'}
    <div class="journal-capture">
      <NotebookPen size={26} aria-hidden="true" />
      <div><h2>Capture a reflection</h2><p class="small">Entries are organized by their journal date, not the date you edit them.</p></div>
      <label>Entry date<input type="date" aria-label="New journal entry date" bind:value={chosen} /></label>
      <button class="primary" disabled={disabled || !chosen} onclick={() => oncreate(chosen)}>Write entry</button>
    </div>
  {/if}
  <div class="collection-filters history-filters" aria-label={`${view === 'journal' ? 'Journal' : 'Timeline'} filters`}>
    <label>Search<input type="search" aria-label={view === 'journal' ? 'Search journal' : 'Search timeline'} bind:value={search} oninput={() => page = 0} /></label>
    <label>On date<input type="date" aria-label="Filter by date" bind:value={from} onchange={() => page = 0} /></label>
    {#if view === 'timeline'}<label>Kind<select aria-label="Filter activity by kind" bind:value={kind} onchange={() => page = 0}><option value="">All kinds</option>{#each kinds as domain}<option value={domain}>{kindNames[domain]}</option>{/each}</select></label>{/if}
    {#if from || kind || search}<button onclick={() => { from = ''; kind = ''; search = ''; page = 0; }}>Clear filters</button>
    {:else if view === 'journal' && (!month || today.startsWith(`${month}-`))}<button onclick={() => { from = today; page = 0; }}>Today's entries</button>{/if}
  </div>
  {#if view === 'timeline'}
    <p class="small subtle"><History size={14} aria-hidden="true" /> Earlier edits and deletions are not recorded here.</p>
    {#each eventGroups as [day, group] (day)}
      <section class="history-day"><h2><time datetime={day}>{dayLabel(day)}</time></h2>
        {#each group as event (event.key)}
          <button class="recorded-event" onclick={() => onopen(event.record)}>
            <time datetime={new Date(event.at).toISOString()}>{new Date(event.at).toLocaleTimeString(undefined, { timeStyle: 'short' })}</time>
            <span class="kind-badge" data-tone={tone(event.record.domain)}>{kindNames[event.record.domain]}</span><strong>{event.record.title}</strong><span>{event.action}</span>
          </button>
        {/each}
      </section>
    {:else}<p class="section-empty subtle">No activity matches. Try clearing filters or create an item to get started.</p>{/each}
  {:else}
    {#each entryGroups as [day, group] (day)}
      <section class="history-day"><h2><time datetime={day}>{dayLabel(day)}</time></h2>
        {#each group as entry (entry.record.id)}
          <button class="journal-entry" onclick={() => onopen(entry.record)}><strong>{entry.record.title}</strong>{#if entry.record.body}<span>{excerpt(entry.record.body)}</span>{/if}</button>
        {/each}
      </section>
    {:else}<p class="section-empty subtle">No entries here. Write a reflection or choose another date.</p>{/each}
  {/if}
  {#if count}<Pagination label={view === 'journal' ? 'Journal entries' : 'Timeline events'} total={count} {page} onchange={value => page = value} />{/if}
</section>
