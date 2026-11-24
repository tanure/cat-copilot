import { contextBridge, ipcRenderer } from 'electron';
import type { Request } from '../../../../dist/core/types.js';
import type { CatPilotBridge } from '../shared.js';

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const result = await ipcRenderer.invoke(channel, ...args);
  if (!result.ok) throw new Error(result.error);
  return result.value as T;
}
const bridge: CatPilotBridge = {
  request: (request: Request) => invoke('catpilot:request', request),
  chooseDirectory: () => invoke('catpilot:directory'),
  exportBackup: workspaceId => invoke('catpilot:export', workspaceId),
  importBackup: (workspaceId, previewOnly) => invoke('catpilot:import', workspaceId, previewOnly),
  importLegacy: (workspaceId, previewOnly) => invoke('catpilot:legacy', workspaceId, previewOnly),
  importAsset: workspaceId => invoke('catpilot:asset-import', workspaceId),
  readAsset: (workspaceId, path) => invoke('catpilot:asset-read', workspaceId, path),
  exportAsset: (workspaceId, path) => invoke('catpilot:asset-export', workspaceId, path),
  onAiChunk: listener => {
    const handler = (_event: Electron.IpcRendererEvent, chunk: { workspaceId: string; text: string }) => listener(chunk);
    ipcRenderer.on('catpilot:ai-chunk', handler);
    return () => ipcRenderer.removeListener('catpilot:ai-chunk', handler);
  },
  aiStatus: () => invoke('catpilot:ai-status'),
  aiModels: () => invoke('catpilot:ai-models'),
  aiLogin: begin => invoke('catpilot:ai-login', begin),
  copyLoginCode: () => invoke('catpilot:ai-copy-code'),
  aiDraft: (workspaceId, prompt, context, model) => invoke('catpilot:ai-draft', workspaceId, prompt, context, model),
  aiPropose: (workspaceId, recordId, expectedRevision, prompt, model) => invoke('catpilot:ai-propose', workspaceId, recordId, expectedRevision, prompt, model),
  aiApply: (workspaceId, proposalId) => invoke('catpilot:ai-apply', workspaceId, proposalId),
  aiCancel: () => invoke('catpilot:ai-cancel'),
  openExternal: url => invoke('catpilot:external', url),
};
contextBridge.exposeInMainWorld('catpilot', bridge);
