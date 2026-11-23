<script lang="ts">
  import { marked } from 'marked';
  import DOMPurify from 'dompurify';
  import { assetPath, imageMime, imagePath } from './assets.js';

  let { value, workspaceId }: { value: string; workspaceId: string } = $props();
  let root = $state<HTMLDivElement>();
  let error = $state('');
  let exporting = $state(false);
  let generation = 0;
  const safeHtml = $derived(sanitize(value));

  function sanitize(markdown: string): string {
    const html = DOMPurify.sanitize(marked.parse(markdown, { async: false }) as string, {
      ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|catpilot-asset:[^\s<>]+$|#)/i,
      FORBID_TAGS: ['video', 'audio', 'iframe', 'source', 'svg', 'math', 'style', 'link', 'object', 'embed'],
      FORBID_ATTR: ['srcset', 'style', 'poster', 'background'],
      ALLOW_DATA_ATTR: false,
    });
    const template = document.createElement('template');
    template.innerHTML = html;
    for (const image of template.content.querySelectorAll('img')) {
      const path = assetPath(image.getAttribute('src') ?? '');
      image.removeAttribute('src');
      if (path && !imagePath(path)) {
        const button = document.createElement('button');
        button.type = 'button'; button.dataset.catpilotExport = path;
        button.textContent = `Export attachment: ${image.alt || path.split('/').at(-1)}`;
        image.replaceWith(button);
      } else if (path) {
        image.dataset.catpilotAsset = path;
        image.loading = 'lazy';
      } else {
        const blocked = document.createElement('span');
        blocked.textContent = `[Image blocked: ${image.alt || 'only workspace assets are supported'}]`;
        image.replaceWith(blocked);
      }
    }
    for (const link of template.content.querySelectorAll('a')) {
      const reference = link.getAttribute('href') ?? '';
      if (!reference.startsWith('catpilot-asset:')) continue;
      const path = assetPath(reference);
      link.removeAttribute('href');
      if (!path) { link.replaceWith(document.createTextNode(`${link.textContent ?? 'Attachment'} [invalid asset reference]`)); continue; }
      const button = document.createElement('button');
      button.type = 'button'; button.dataset.catpilotExport = path;
      button.textContent = `Export attachment: ${link.textContent || path.split('/').at(-1)}`;
      link.replaceWith(button);
    }
    return template.innerHTML;
  }
  $effect(() => {
    const html = safeHtml; const ws = workspaceId; const element = root;
    void html;
    if (!element || !ws) return;
    const version = ++generation;
    const urls: string[] = [];
    let active = true;
    error = '';
    const images = [...element.querySelectorAll<HTMLImageElement>('img[data-catpilot-asset]')];
    // Load sequentially to bound simultaneous IPC buffers for attachment-heavy documents.
    void (async () => {
      for (const image of images) {
        const path = image.dataset.catpilotAsset!;
        try {
          const asset = await window.catpilot.readAsset(ws, path);
          if (!active || version !== generation || ws !== workspaceId) return;
          if (!imageMime(asset.mime)) throw new Error('This asset is not a supported passive image. Use an attachment link to export it.');
          const url = URL.createObjectURL(new Blob([new Uint8Array(asset.data).buffer], { type: asset.mime }));
          urls.push(url); image.src = url;
        } catch (cause) {
          if (!active || version !== generation || ws !== workspaceId) return;
          error = cause instanceof Error ? cause.message : String(cause);
          image.alt = `Asset unavailable: ${path}`;
        }
      }
    })();
    return () => { active = false; generation++; for (const url of urls) URL.revokeObjectURL(url); };
  });
  async function exportAttachment(event: MouseEvent) {
    const button = (event.target as Element).closest<HTMLButtonElement>('button[data-catpilot-export]');
    if (!button) return;
    event.preventDefault(); event.stopPropagation();
    if (exporting) return;
    const ws = workspaceId; const version = generation;
    exporting = true;
    try {
      const exported = await window.catpilot.exportAsset(ws, button.dataset.catpilotExport!);
      if (ws === workspaceId && version === generation) error = exported ? '' : 'Attachment export canceled.';
    } catch (cause) { if (ws === workspaceId && version === generation) error = cause instanceof Error ? cause.message : String(cause); }
    finally { exporting = false; }
  }
  function attachmentActions(element: HTMLDivElement) {
    // Native buttons activate on Enter/Space too; delegation handles dynamically sanitized content.
    const listener = (event: MouseEvent) => { void exportAttachment(event); };
    element.addEventListener('click', listener);
    return { destroy: () => element.removeEventListener('click', listener) };
  }
</script>

<!-- Only sanitized inert placeholders enter HTML; native bytes become scoped, revocable Blob URLs afterward. -->
<div class="markdown-preview" bind:this={root} use:attachmentActions role="group" aria-label="Document preview">{@html safeHtml}</div>
{#if exporting}<p class="small subtle" role="status">Exporting attachment...</p>{/if}
{#if error}<p class="editor-notice" role="status">{error}</p>{/if}
