<script lang="ts">
  import { onDestroy } from 'svelte';

  let { label, value, min, max, onresize, oncommit }: {
    label: string; value: number; min: number; max: number;
    onresize: (value: number) => void; oncommit: (value: number) => void;
  } = $props();
  let cleanup = () => {};
  const clamp = (width: number) => Math.max(min, Math.min(max, width));

  function pointerdown(event: PointerEvent) {
    if (event.button !== 0) return;
    event.preventDefault();
    cleanup();
    const start = event.clientX;
    const width = value;
    let next = width;
    const move = (event: PointerEvent) => { next = clamp(width + event.clientX - start); onresize(next); };
    const stop = () => { cleanup(); oncommit(next); };
    cleanup = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
      window.removeEventListener('blur', stop);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop, { once: true });
    window.addEventListener('pointercancel', stop, { once: true });
    window.addEventListener('blur', stop, { once: true });
  }
  function keydown(event: KeyboardEvent) {
    const next = event.key === 'Home' ? min : event.key === 'End' ? max
      : event.key === 'ArrowLeft' ? clamp(value - 16) : event.key === 'ArrowRight' ? clamp(value + 16) : null;
    if (next === null) return;
    event.preventDefault();
    onresize(next); oncommit(next);
  }
  onDestroy(() => cleanup());
</script>

<div role="slider" aria-label={label} aria-orientation="horizontal" aria-valuenow={value}
  aria-valuemin={min} aria-valuemax={max} aria-valuetext={`${value} pixels`}
  tabindex="0" class="resize-handle" onpointerdown={pointerdown} onkeydown={keydown}></div>
