<script lang="ts">
  import { onMount, onDestroy, untrack } from 'svelte';
  import { Editor } from '@tiptap/core';
  import StarterKit from '@tiptap/starter-kit';
  import { Markdown } from '@tiptap/markdown';
  import TaskList from '@tiptap/extension-task-list';
  import TaskItem from '@tiptap/extension-task-item';
  import { TableKit } from '@tiptap/extension-table';
  import { EditorView, keymap } from '@codemirror/view';
  import { basicSetup } from 'codemirror';
  import { markdown } from '@codemirror/lang-markdown';
  import AssetPreview from './AssetPreview.svelte';
  import { importedAssetReference, assetPath, imagePath } from './assets.js';
  import { splitFrontmatter, richRestriction } from './document.js';
  import { moveBlockTransaction } from './blocks.js';
  import { Bold, Italic, Heading2, List, ListChecks, Code, Undo2, ArrowUp, ArrowDown, Eye, Pencil, FileCode, Paperclip, Plus } from './icons.js';

  let { value, workspaceId, onchange = () => {}, onsave = () => {}, disabled = false, readOnly = false,
    compact = false, label = 'Rich document editor', sourceLabel = 'Markdown source', attachments = true, maxLength }: {
    value: string; workspaceId: string; onchange?: (value: string) => void; onsave?: () => void; disabled?: boolean;
    readOnly?: boolean; compact?: boolean; label?: string; sourceLabel?: string; attachments?: boolean; maxLength?: number;
  } = $props();
  const editorId = $props.id();
  let mode = $state<'rich' | 'source' | 'preview'>(untrack(() => richRestriction(splitFrontmatter(value).body) ? 'source' : 'rich'));
  let host: HTMLDivElement;
  let rich: Editor | undefined;
  let source: EditorView | undefined;
  let mounted = $state(false);
  let editorError = $state('');
  let importing = $state(false);
  let alive = true;
  let renderedValue = '';
  let renderVersion = $state(0);
  let slash = $state<{ from: number; to: number; query: string } | null>(null);
  let slashIndex = $state(0);
  let dismissedSlash = '';
  let canMoveUp = $state(false);
  let canMoveDown = $state(false);
  let slashPosition = $state({ left: 0, top: 0 });
  let blockTop = $state(20);
  const blocks = [
    { id: 'paragraph', label: 'Paragraph' }, { id: 'heading', label: 'Heading 2' },
    { id: 'bullet', label: 'Bullet list' }, { id: 'numbered', label: 'Numbered list' },
    { id: 'task', label: 'Task list' }, { id: 'quote', label: 'Block quote' },
    { id: 'code', label: 'Code block' }, { id: 'table', label: 'Table' },
  ];
  const slashItems = $derived(blocks.filter(block => block.label.toLowerCase().includes(slash?.query.toLowerCase() ?? '')));
  const parts = $derived(splitFrontmatter(value));
  const restriction = $derived(richRestriction(parts.body));
  function refreshBlocks(editor: Editor) {
    canMoveUp = !!moveBlockTransaction(editor.state, -1);
    canMoveDown = !!moveBlockTransaction(editor.state, 1);
    const { $from: from, empty } = editor.state.selection;
    const coordinates = editor.view.coordsAtPos(from.pos);
    blockTop = Math.max(12, coordinates.top - editor.view.dom.getBoundingClientRect().top + 20);
    const text = from.parent.textContent;
    const signature = `${from.pos}:${text}`;
    if (empty && from.parent.type.name === 'paragraph' && /^\/[a-z ]*$/i.test(text) &&
        from.parentOffset === text.length && signature !== dismissedSlash) {
      const query = text.slice(1);
      if (slash?.query !== query) slashIndex = 0;
      slash = { from: from.start(), to: from.pos, query };
      slashPosition = {
        left: Math.max(12, Math.min(coordinates.left, window.innerWidth - 292)),
        top: coordinates.bottom + 280 < window.innerHeight ? coordinates.bottom + 8 : Math.max(12, coordinates.top - 280),
      };
    } else slash = null;
    editor.view.dom.setAttribute('aria-expanded', String(!!slash));
    if (slash && slashItems[slashIndex]) editor.view.dom.setAttribute('aria-activedescendant', `${editorId}-option-${slashIndex}`);
    else editor.view.dom.removeAttribute('aria-activedescendant');
  }
  function insertBlock(id: string) {
    if (!rich || disabled || readOnly || importing || restriction) return;
    let chain = rich.chain();
    if (slash) chain = chain.deleteRange({ from: slash.from, to: slash.to });
    slash = null; dismissedSlash = '';
    if (id === 'paragraph') chain.setParagraph();
    else if (id === 'heading') chain.setHeading({ level: 2 });
    else if (id === 'bullet') chain.toggleBulletList();
    else if (id === 'numbered') chain.toggleOrderedList();
    else if (id === 'task') chain.toggleTaskList();
    else if (id === 'quote') chain.toggleBlockquote();
    else if (id === 'code') chain.toggleCodeBlock();
    else if (id === 'table') chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true });
    chain.focus().run();
  }
  function moveBlock(direction: -1 | 1) {
    if (!rich || disabled || readOnly || importing || restriction) return;
    const transaction = moveBlockTransaction(rich.state, direction);
    if (transaction) { rich.view.dispatch(transaction); rich.commands.focus(); }
  }
  function openBlocks() {
    if (!rich || disabled || readOnly || importing || restriction) return;
    const from = rich.state.selection.$from;
    if (from.parent.type.name === 'paragraph' && !from.parent.textContent) {
      rich.chain().focus().insertContent('/').run();
    } else {
      const position = from.after(1);
      rich.chain().focus().insertContentAt(position, { type: 'paragraph', content: [{ type: 'text', text: '/' }] })
        .setTextSelection(position + 2).run();
    }
  }

  onMount(() => { mounted = true; });
  onDestroy(() => { alive = false; });
  async function importAsset() {
    if (disabled || readOnly || importing || !workspaceId) return;
    const ws = workspaceId;
    importing = true; editorError = '';
    try {
      const imported = await window.catpilot.importAsset(ws);
      if (!alive || ws !== workspaceId || !imported) return;
      const reference = importedAssetReference(imported);
      if (!reference) throw new Error('The importer returned a noncanonical asset reference.');
      const path = assetPath(reference)!;
      const isImage = imagePath(path);
      const label = (path.split('/').at(-1) || 'Attachment').replace(/[\[\]\\]/g, '\\$&');
      const addition = `${isImage ? '!' : ''}[${label}](${reference})`;
      onchange(`${value}${value && !value.endsWith('\n') ? '\n' : ''}\n${addition}\n`);
      mode = 'source';
    } catch (cause) { if (alive && ws === workspaceId) editorError = cause instanceof Error ? cause.message : String(cause); }
    finally { if (alive) importing = false; }
  }
  $effect(() => {
    const incoming = value;
    if (!mounted) return;
    untrack(() => { if (incoming !== renderedValue) { renderedValue = incoming; renderVersion++; } });
  });
  $effect(() => {
    if (!mounted || !host) return;
    const activeMode = mode;
    const locked = disabled || importing || readOnly;
    renderVersion;
    // Editor transactions own their content; tracking value would reset selection on every keystroke.
    return untrack(() => {
    renderedValue = value;
    const blocked = restriction;
    if (activeMode === 'source') {
      source = new EditorView({
        doc: value,
        parent: host,
        extensions: [
          basicSetup, markdown(), EditorView.lineWrapping,
          EditorView.editable.of(!locked),
          EditorView.contentAttributes.of({ 'aria-label': sourceLabel, 'aria-readonly': String(locked) }),
          keymap.of([{ key: 'Mod-s', run: () => { onsave(); return true; } }]),
          EditorView.updateListener.of(update => { if (update.docChanged) { renderedValue = update.state.doc.toString(); onchange(renderedValue); } }),
        ],
      });
    } else if (activeMode === 'rich' && !blocked) {
      try {
        const prefix = parts.prefix;
        rich = new Editor({
          element: host,
          extensions: [StarterKit, Markdown, TaskList, TaskItem.configure({ nested: true, HTMLAttributes: { 'data-type': 'taskItem' } }), TableKit],
          content: parts.body, contentType: 'markdown', editable: !locked,
          editorProps: {
            attributes: { 'aria-label': label, role: 'textbox', 'aria-multiline': 'true', 'aria-readonly': String(locked), class: 'rich-document', 'aria-controls': `${editorId}-commands`, 'aria-autocomplete': 'list' },
            handleKeyDown: (_view, event) => {
              if (!slash) return false;
              if (event.key === 'Escape') {
                dismissedSlash = `${rich?.state.selection.from}:${rich?.state.selection.$from.parent.textContent}`;
                slash = null; _view.dom.setAttribute('aria-expanded', 'false'); _view.dom.removeAttribute('aria-activedescendant'); return true;
              }
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                slashIndex = (slashIndex + (event.key === 'ArrowDown' ? 1 : -1) + slashItems.length) % Math.max(1, slashItems.length);
                rich?.view.dom.setAttribute('aria-activedescendant', `${editorId}-option-${slashIndex}`); return true;
              }
              if (event.key === 'Enter' && slashItems[slashIndex]) { insertBlock(slashItems[slashIndex].id); return true; }
              return false;
            },
          },
          onUpdate: ({ editor }) => { renderedValue = prefix + editor.getMarkdown(); onchange(renderedValue); refreshBlocks(editor); },
          onBlur: () => { slash = null; },
          onSelectionUpdate: ({ editor }) => refreshBlocks(editor),
        });
        refreshBlocks(rich);
      } catch (error) {
        editorError = error instanceof Error ? error.message : String(error);
      }
    }
    return () => { slash = null; rich?.destroy(); rich = undefined; source?.destroy(); source = undefined; host?.replaceChildren(); };
    });
  });
</script>

<div class:compact-editor={compact} class="editor-control" role="group" aria-label={`${label} editor`}>
<fieldset disabled={disabled || importing}><div class="editor-toolbar" role="toolbar" aria-label={`${label} mode`}>
  {#each ['rich', 'source'] as tab}
    <button class:active={mode === tab || (tab === 'source' && mode === 'preview')} aria-pressed={mode === tab || (tab === 'source' && mode === 'preview')} onclick={() => mode = tab as typeof mode} disabled={tab === 'rich' && !!restriction}>{#if tab === 'rich'}<Pencil size={15} aria-hidden="true" />{:else}<FileCode size={15} aria-hidden="true" />{/if}{tab === 'rich' ? readOnly ? 'Read' : 'Write' : 'Markdown'}</button>
  {/each}
  {#if mode !== 'rich'}<button aria-label="Preview Markdown" aria-pressed={mode === 'preview'} title="Preview rendered Markdown" onclick={() => mode = mode === 'preview' ? 'source' : 'preview'}><Eye size={15} aria-hidden="true" />Preview Markdown</button>{/if}
  {#if attachments && !readOnly}<button onclick={() => void importAsset()} disabled={!workspaceId}><Paperclip size={15} aria-hidden="true" />{importing ? 'Importing...' : 'Import image / attachment'}</button>{/if}
  {#if mode === 'rich' && !readOnly}
    <span class="toolbar-divider"></span>
    <button aria-label="Bold" title="Bold" onclick={() => rich?.chain().focus().toggleBold().run()}><Bold size={16} aria-hidden="true" /></button>
    <button aria-label="Italic" title="Italic" onclick={() => rich?.chain().focus().toggleItalic().run()}><Italic size={16} aria-hidden="true" /></button>
    <button aria-label="Heading" title="Heading" onclick={() => rich?.chain().focus().toggleHeading({ level: 2 }).run()}><Heading2 size={16} aria-hidden="true" /></button>
    <button aria-label="Bullet list" title="Bullet list" onclick={() => rich?.chain().focus().toggleBulletList().run()}><List size={16} aria-hidden="true" /></button>
    <button aria-label="Task list" title="Task list" onclick={() => rich?.chain().focus().toggleTaskList().run()}><ListChecks size={16} aria-hidden="true" /></button>
    <button aria-label="Code block" title="Code block" onclick={() => rich?.chain().focus().toggleCodeBlock().run()}><Code size={16} aria-hidden="true" /></button>
    <button aria-label="Undo" title="Undo" onclick={() => rich?.chain().focus().undo().run()}><Undo2 size={16} aria-hidden="true" /></button>
  {/if}
</div></fieldset>
{#if mode === 'rich' && slash}
  <div id={`${editorId}-commands`} class="slash-commands" style:left={`${slashPosition.left}px`} style:top={`${slashPosition.top}px`} role="listbox" aria-label="Slash block commands">
    <p class="slash-heading">Turn ideas into blocks</p>
    {#each slashItems as block, index}<button id={`${editorId}-option-${index}`} role="option" aria-selected={index === slashIndex} onmousedown={event => event.preventDefault()} onclick={() => insertBlock(block.id)}>{block.label}</button>{/each}
    {#if !slashItems.length}<p>No matching blocks. Press Escape to keep typing.</p>{/if}
  </div>
{/if}
{#if parts.prefix}<p class="editor-notice">Raw frontmatter is preserved. Edit it in Markdown mode.</p>{/if}
{#if restriction}<p class="editor-notice">{restriction} Use Markdown or Preview to avoid losing content.</p>{/if}
{#if editorError}<p class="error">{editorError} Use Markdown mode.</p>{/if}
{#if maxLength !== undefined && value.length > maxLength}<p class="error" role="alert">{label} exceeds the {maxLength.toLocaleString()} character limit. Shorten it before continuing.</p>{/if}
<div class="editor-surface" class:source-mode={mode === 'source'}>
  {#if mode === 'rich' && !restriction && !readOnly}
    <div class="block-actions" style:top={`${blockTop}px`} role="toolbar" aria-label="Current block">
      <button aria-label="Add block" title="Add a block (/)" disabled={disabled || importing} onmousedown={event => event.preventDefault()} onclick={openBlocks}><Plus size={17} aria-hidden="true" /></button>
      <button aria-label="Move current block up" title="Move block up" disabled={disabled || importing || !canMoveUp} onmousedown={event => event.preventDefault()} onclick={() => moveBlock(-1)}><ArrowUp size={15} aria-hidden="true" /></button>
      <button aria-label="Move current block down" title="Move block down" disabled={disabled || importing || !canMoveDown} onmousedown={event => event.preventDefault()} onclick={() => moveBlock(1)}><ArrowDown size={15} aria-hidden="true" /></button>
    </div>
  {/if}
  {#if mode === 'preview'}
    <AssetPreview value={parts.body} {workspaceId} />
    {#if !parts.body}<p class="empty-editor">A little space for your next idea. Choose Write or Markdown to begin.</p>{/if}
  {/if}
  <div bind:this={host} hidden={mode === 'preview' || (mode === 'rich' && !!restriction)}></div>
</div>
{#if mode === 'rich' && !readOnly}<p class="editor-hint">Start writing, or type <kbd>/</kbd> for headings, checklists, tables and more.</p>{/if}
</div>
