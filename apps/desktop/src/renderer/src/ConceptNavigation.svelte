<script lang="ts">
  import { tick, untrack } from 'svelte';
  import { SvelteMap } from 'svelte/reactivity';
  import { FolderOpen, ChevronRight, Ellipsis, FolderInput, FolderPlus, Plus, Trash2 } from './icons.js';
  import { conceptIcons } from './ConceptExplorer.svelte';
  import { kindNames, type Tone } from './workspace-views.js';
  import { conceptKinds, folderParent, inFolder, type ConceptFolder, type ConceptKind } from '../../../../../packages/core/concept-folders.js';

  let { tree, folder, kind, palette, disabled, onfolder, onkind, oncreate, onmanage, onmove }: {
    tree: ConceptFolder[]; folder: string | null; kind: ConceptKind | '';
    palette: Record<ConceptKind, Tone>; disabled: boolean;
    onfolder: (folder: string | null) => void; onkind: (kind: ConceptKind | '') => void;
    oncreate: (parent: string) => void;
    onmanage: (action: 'move' | 'delete', path: string) => void;
    onmove: (path: string, parent: string) => void;
  } = $props();
  const expand = new SvelteMap<string, boolean>();
  $effect(() => {
    const selection = folder;
    untrack(() => {
      for (let path = selection; path; path = folderParent(path)) expand.set(path, true);
    });
  });
  let dragged = $state('');
  let target = $state<string | null>(null);
  let menu = $state<HTMLDivElement>();
  let menuPath = $state('');
  let menuTrigger: HTMLButtonElement | undefined;
  type MenuRequest = { trigger: HTMLButtonElement; path: string; point: { x: number; y: number } };
  let pendingMenu: MenuRequest | undefined;

  function dragStart(event: DragEvent, path: string) {
    if (disabled || !event.dataTransfer) { event.preventDefault(); return; }
    dragged = path;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('application/x-catpilot-folder', path);
  }
  function clearDrag() { dragged = ''; target = null; }
  function canDrop(parent: string) {
    return !disabled && !!dragged && parent !== folderParent(dragged) && (!parent || !inFolder(parent, dragged));
  }
  function dragOver(event: DragEvent, parent: string) {
    if (!canDrop(parent)) { target = null; return; }
    event.preventDefault();
    target = parent;
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  }
  function drop(event: DragEvent, parent: string) {
    if (!canDrop(parent) || event.dataTransfer?.getData('application/x-catpilot-folder') !== dragged) return;
    event.preventDefault();
    const path = dragged;
    clearDrag();
    if (parent) expand.set(parent, true);
    onmove(path, parent);
  }
  function showMenu(event: MouseEvent | KeyboardEvent, path: string) {
    if (disabled || !menu) return;
    event.preventDefault();
    const trigger = event.currentTarget as HTMLButtonElement;
    const anchor = trigger.getBoundingClientRect();
    const contextClick = event instanceof MouseEvent && event.type === 'contextmenu';
    const point = contextClick && (event.clientX || event.clientY)
      ? { x: event.clientX, y: event.clientY } : { x: anchor.left, y: anchor.bottom + 3 };
    const request = { trigger, path, point };
    // macOS can fire contextmenu on mouse-down; opening then lets the release light-dismiss the popover.
    if (contextClick && event.buttons && (!(event instanceof PointerEvent) || event.pointerType === 'mouse')) {
      pendingMenu = request;
    } else void openMenu(request);
  }
  function clearPendingMenu() { pendingMenu = undefined; }
  function openPendingMenu() {
    const request = pendingMenu;
    clearPendingMenu();
    if (request?.trigger.isConnected) void openMenu(request);
  }
  async function openMenu({ trigger, path, point }: MenuRequest) {
    if (disabled || !menu) return;
    menuTrigger = trigger;
    menuPath = path;
    if (!menu.matches(':popover-open')) menu.showPopover();
    await tick();
    if (!menu.matches(':popover-open')) return;
    menu.style.left = `${Math.max(8, Math.min(point.x, window.innerWidth - menu.offsetWidth - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(point.y, window.innerHeight - menu.offsetHeight - 8))}px`;
    menu.querySelector('button')?.focus();
  }
  function menuAction(action: 'create' | 'move' | 'delete') {
    menu?.hidePopover();
    menuTrigger?.focus({ preventScroll: true });
    if (action === 'create') {
      expand.set(menuPath, true);
      oncreate(menuPath);
    } else onmanage(action, menuPath);
  }
  function closeMenuOnEscape(event: KeyboardEvent) {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    menu?.hidePopover();
    menuTrigger?.focus({ preventScroll: true });
  }
</script>

<svelte:window onpointerdown={clearPendingMenu} onpointercancel={clearPendingMenu} onblur={clearPendingMenu} onmouseup={openPendingMenu} />

{#snippet folders(nodes: ConceptFolder[], depth = 0)}
  <ul class="concept-folders">
    {#each nodes as node (node.path)}
      {@const expanded = expand.get(node.path) ?? false}
      <li><div class="folder-row" style:--folder-depth={Math.min(depth, 5)}>
        {#if node.children.length}
          <button type="button" class="folder-toggle" aria-label={`${expanded ? 'Collapse' : 'Expand'} ${node.path}`} aria-expanded={expanded} onclick={() => expand.set(node.path, !expanded)}><ChevronRight size={14} aria-hidden="true" /></button>
        {:else}<span class="folder-toggle-spacer" aria-hidden="true"></span>{/if}
        <button type="button" class="folder-link folder-tree-link" class:folder-drop-target={target === node.path} data-folder-path={node.path} aria-pressed={folder === node.path} title={node.path}
          draggable={!disabled} ondragstart={event => dragStart(event, node.path)} ondragend={clearDrag}
          ondragover={event => dragOver(event, node.path)} ondragleave={() => { if (target === node.path) target = null; }}
          ondrop={event => drop(event, node.path)} oncontextmenu={event => void showMenu(event, node.path)}
          onkeydown={event => { if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) void showMenu(event, node.path); }}
          onclick={() => { onfolder(node.path); expand.set(node.path, true); }}><FolderOpen size={16} aria-hidden="true" /><span>{node.name}</span></button>
        <button type="button" class="folder-action folder-more" aria-label={`Actions for ${node.path}`} title="Folder actions" disabled={disabled} onclick={event => void showMenu(event, node.path)}><Ellipsis size={16} aria-hidden="true" /></button>
      </div>
      {#if expanded && node.children.length}{@render folders(node.children, depth + 1)}{/if}</li>
    {/each}
  </ul>
{/snippet}

<div class="context-groups">
  <div role="group" aria-label="Concept kinds">
    <h3>Kind</h3>
    <button class="folder-link" aria-pressed={!kind} onclick={() => onkind('')}>All kinds</button>
    {#each conceptKinds as item}
      {@const Icon = conceptIcons[item]}
      <button class="folder-link" data-tone={palette[item]} aria-pressed={kind === item} onclick={() => onkind(item)}><Icon size={16} aria-hidden="true" />{kindNames[item]}</button>
    {/each}
  </div>
  <div role="group" aria-label="Concept folders">
    <div class="folder-group-heading"><h3>Folders</h3><button type="button" class="folder-action" aria-label="New folder" title="New folder" disabled={disabled} onclick={() => oncreate('')}><Plus size={17} aria-hidden="true" /></button></div>
    <button class="folder-link" class:folder-drop-target={target === ''} aria-pressed={folder === null}
      title="Drop a folder here to move it to the top level" ondragover={event => dragOver(event, '')}
      ondragleave={() => { if (target === '') target = null; }} ondrop={event => drop(event, '')}
      onclick={() => onfolder(null)}><FolderOpen size={16} aria-hidden="true" />All folders</button>
    <button class="folder-link" aria-pressed={folder === ''} onclick={() => onfolder('')}>Unfiled</button>
    {@render folders(tree)}
  </div>
</div>
<div class="folder-menu" popover="auto" role="group" aria-label={`Folder actions for ${menuPath}`} bind:this={menu}>
  <button type="button" onkeydown={closeMenuOnEscape} onclick={() => menuAction('create')}><FolderPlus size={16} aria-hidden="true" />New subfolder</button>
  <button type="button" onkeydown={closeMenuOnEscape} onclick={() => menuAction('move')}><FolderInput size={16} aria-hidden="true" />Move folder…</button>
  <button type="button" class="folder-menu-delete" onkeydown={closeMenuOnEscape} onclick={() => menuAction('delete')}><Trash2 size={16} aria-hidden="true" />Delete folder…</button>
</div>
