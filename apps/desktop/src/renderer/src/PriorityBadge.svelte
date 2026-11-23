<script lang="ts">
  import { priorityNames, type Priority } from './presentation.js';
  let { value }: { value: Priority } = $props();
  const tones = { P0: 'rose', P1: 'amber', P2: 'blue', P3: 'slate' };
</script>

<span class="priority-marker" data-tone={tones[value]} title={`${value} - ${priorityNames[value]} priority`}>
  <span class="priority-code">{value}</span>{priorityNames[value]}
</span>
