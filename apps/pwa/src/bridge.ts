import type { CatPilotBridge } from '../../desktop/src/shared.js';
import type { Backup } from '../../../packages/core/types.js';
import { BrowserStorage, type BrowserDirectoryHandle } from './storage.js';
import { MAX_BACKUP_BYTES, MAX_FILE_BYTES, assetParts, digest, mimeType, toBase64, validateBackup } from './storage-codecs.js';

const AI_UNAVAILABLE = 'AI is unavailable in the offline browser app. A trusted backend is required; desktop credentials and native Copilot are never accessed from the browser.';
function unavailable(): never { throw new Error(AI_UNAVAILABLE); }
function chooseFile(accept: string): Promise<File | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.hidden = true;
    document.body.append(input);
    const cleanup = () => { input.remove(); window.removeEventListener('focus', focused); };
    const finish = (file: File | null) => { cleanup(); resolve(file); };
    // Chromium dispatches cancel. The focus fallback also handles older file pickers.
    const focused = () => { setTimeout(() => { if (!input.files?.length) finish(null); }, 1000); };
    input.addEventListener('change', () => finish(input.files?.[0] ?? null), { once: true });
    input.addEventListener('cancel', () => finish(null), { once: true });
    window.addEventListener('focus', focused, { once: true });
    try { input.click(); } catch (error) { cleanup(); reject(error); }
  });
}
function download(data: string | Uint8Array, filename: string, mime: string) {
  const blob = new Blob([typeof data === 'string' ? data : new Uint8Array(data)], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  // This trusted, adapter-created blob must not reach the renderer's external-link interceptor.
  anchor.addEventListener('click', event => event.stopPropagation(), { once: true });
  document.body.append(anchor);
  try {
    if (!anchor.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }))) {
      throw new Error('The download was canceled before it could start. Retry from the Export button and check browser download permissions.');
    }
  }
  finally { anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 60_000); }
}
export type BrowserBridge = CatPilotBridge & {
  platform: 'web';
  restoreWorkspaceAccess(workspaceId: string): Promise<boolean>;
};
export async function createBrowserBridge(): Promise<BrowserBridge> {
  const storage = await BrowserStorage.open();
  await storage.loadAccessHandles();
  const pendingImports = new Map<string, Backup>();
  const bridge: BrowserBridge = {
    platform: 'web',
    request: request => storage.execute(request),
    chooseDirectory() {
      const picker = (window as unknown as {
        showDirectoryPicker?: (options: { mode: 'readwrite'; id: string }) => Promise<BrowserDirectoryHandle>;
      }).showDirectoryPicker;
      if (!picker) return Promise.reject(new Error('Folder workspaces require Chrome/Chromium File System Access. Use a SQLite Browser storage workspace on this browser.'));
      // Do not await storage, permission queries, or a lock before opening this picker.
      return picker.call(window, { mode: 'readwrite', id: 'catpilot-workspace' })
        .then(directory => storage.rememberDirectory(directory))
        .catch(error => {
          if (error instanceof DOMException && error.name === 'AbortError') return null;
          throw error;
        });
    },
    restoreWorkspaceAccess: id => storage.requestWorkspaceAccess(id),
    async exportBackup(workspaceId) {
      const backup = await storage.execute({ action: 'export', workspaceId }) as Backup;
      download(JSON.stringify(backup, null, 2), `catpilot-${workspaceId}.json`, 'application/json');
      return true;
    },
    async importBackup(workspaceId, previewOnly) {
      if (previewOnly) {
        pendingImports.delete(workspaceId);
        const file = await chooseFile('.json,application/json');
        if (!file) return null;
        if (file.size > MAX_BACKUP_BYTES) throw new Error('Backup exceeds the 250 MB limit.');
        const backup = await validateBackup(JSON.parse(await file.text()));
        const preview = await storage.execute({ action: 'previewImport', backup });
        pendingImports.set(workspaceId, backup);
        return preview;
      }
      const backup = pendingImports.get(workspaceId);
      if (!backup) throw new Error('Preview a backup for this workspace before approving import.');
      const result = await storage.execute({ action: 'import', workspaceId, backup, approved: true });
      if (pendingImports.get(workspaceId) === backup) pendingImports.delete(workspaceId);
      return result;
    },
    async importLegacy() { throw new Error('Legacy vault migration is available only in the desktop app. Export a full CatPilot backup from desktop, then import that JSON backup here.'); },
    async importAsset(workspaceId) {
      const file = await chooseFile('*/*');
      if (!file) return null;
      if (file.size > MAX_FILE_BYTES) throw new Error('Asset exceeds the 20 MB limit.');
      let safeName = file.name.normalize('NFC').replace(/[\\/:<>"|?*\x00-\x1f]/g, '_').replace(/[ .]+$/g, '').slice(-180) || 'attachment';
      if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(safeName)) safeName = `_${safeName}`;
      const path = `attachments/${crypto.randomUUID()}/${safeName}`;
      assetParts(path);
      const bytes = new Uint8Array(await file.arrayBuffer());
      return await storage.execute({
        action: 'addAsset', workspaceId,
        asset: { path, data: toBase64(bytes), sha256: await digest(bytes) },
      }) as string;
    },
    async readAsset(workspaceId, path) {
      return await storage.execute({ action: 'readAsset', workspaceId, path }) as { data: Uint8Array; mime: string };
    },
    async exportAsset(workspaceId, path) {
      const { data } = await bridge.readAsset(workspaceId, path);
      download(data, assetParts(path).at(-1)!, mimeType(path));
      return true;
    },
    onAiChunk: () => () => {},
    async aiStatus() { return { authenticated: false, message: AI_UNAVAILABLE }; },
    async aiModels() { return []; },
    async aiLogin() { return unavailable(); },
    async copyLoginCode() { return unavailable(); },
    async aiDraft() { return unavailable(); },
    async aiPropose() { return unavailable(); },
    async aiApply() { return unavailable(); },
    async aiCancel() {},
    async openExternal(raw) {
      const url = new URL(raw);
      if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Only HTTP(S) links may be opened from the browser app.');
      window.open(url.href, '_blank', 'noopener,noreferrer');
    },
  };
  return bridge;
}
