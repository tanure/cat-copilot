import type { Request } from '../../../packages/core/types.js';
import type { DocumentEntry } from '../../../packages/core/types.js';
import type { AiProposal } from '../../../packages/core/ai.js';
export type { AiProposal } from '../../../packages/core/ai.js';

export type { Request, Workspace, DocumentEntry as RecordEntry, RecordInput, Domain, Snapshot, Backup } from '../../../packages/core/types.js';

export interface AIStatus {
  authenticated: boolean;
  message: string;
}

export interface AIModel {
  id: string;
  name: string;
}

export interface AILogin {
  kind: string;
  message: string;
  url?: string;
  code?: string;
  complete: boolean;
}

export interface CatPilotBridge {
  platform?: 'desktop' | 'web';
  request(request: Request): Promise<unknown>;
  chooseDirectory(): Promise<string | null>;
  restoreWorkspaceAccess?(workspaceId: string): Promise<boolean>;
  exportBackup(workspaceId: string): Promise<boolean>;
  importBackup(workspaceId: string, previewOnly: boolean): Promise<unknown>;
  importLegacy(workspaceId: string, previewOnly: boolean): Promise<unknown>;
  importAsset(workspaceId: string): Promise<string | null>;
  readAsset(workspaceId: string, path: string): Promise<{ data: Uint8Array; mime: string }>;
  exportAsset(workspaceId: string, path: string): Promise<boolean>;
  onAiChunk(listener: (chunk: { workspaceId: string; text: string }) => void): () => void;
  aiStatus(): Promise<AIStatus>;
  aiModels(): Promise<AIModel[]>;
  aiLogin(begin: boolean): Promise<AILogin>;
  copyLoginCode(): Promise<void>;
  aiDraft(workspaceId: string, prompt: string, context: string, model?: string): Promise<string>;
  aiPropose(workspaceId: string, recordId: string, expectedRevision: string, prompt: string, model?: string): Promise<AiProposal>;
  aiApply(workspaceId: string, proposalId: string): Promise<DocumentEntry>;
  aiCancel(): Promise<void>;
  openExternal(url: string): Promise<void>;
}

declare global {
  interface Window {
    catpilot: CatPilotBridge;
  }
}
