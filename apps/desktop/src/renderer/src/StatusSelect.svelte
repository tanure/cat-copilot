<script lang="ts">
  import { Circle, CircleDashed, CirclePause, CircleCheck, ChevronDown } from './icons.js';
  import { statusNames, type Status } from './presentation.js';

  let { value, label, disabled = false, onchange }: {
    value: Status; label: string; disabled?: boolean; onchange: (value: Status) => void;
  } = $props();
  const icons = { Open: Circle, 'In Progress': CircleDashed, Blocked: CirclePause, Done: CircleCheck };
  const tones = { Open: 'slate', 'In Progress': 'blue', Blocked: 'amber', Done: 'teal' };
  const StatusIcon = $derived(icons[value]);

  function change(event: Event & { currentTarget: HTMLSelectElement }) {
    const next = statusNames.find(status => status === event.currentTarget.value);
    event.currentTarget.value = value;
    if (next) onchange(next);
  }
</script>

<span class="status-control" data-tone={tones[value]} data-status={value}>
  <StatusIcon class="status-icon" size={14} strokeWidth={1.8} aria-hidden="true" />
  <select aria-label={label} {value} {disabled} onchange={change}>
    {#each statusNames as status}<option>{status}</option>{/each}
  </select>
  <ChevronDown class="select-chevron" size={12} aria-hidden="true" />
</span>
