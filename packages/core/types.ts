import { z } from 'zod';
import { managementRequestSchema } from './management-types.js';
import { folderCommandSchema } from './folder-command.js';

export const domains = ['tasks', 'knowledge', 'journal', 'projects', 'learning', 'milestones', 'growth', 'achievements', 'pomodoro', 'reports'] as const;
export const domainSchema = z.enum(domains);
export type Domain = z.infer<typeof domainSchema>;
export const folderDomain = 'concept-folders' as const;
export const workspaceSchema = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1).max(80),
  backend: z.enum(['sqlite', 'markdown']),
  location: z.string().min(1),
  created: z.iso.datetime(),
});
export type Workspace = z.infer<typeof workspaceSchema>;
export const fieldsSchema = z.object({
  status: z.enum(['Open', 'In Progress', 'Blocked', 'Done']).default('Open'),
  priority: z.enum(['P0', 'P1', 'P2', 'P3']).default('P2'),
  due: z.union([z.literal(''), z.iso.date()]).default(''),
  folder: z.string().max(200).default('General'),
  tags: z.array(z.string().max(80)).max(100).default([]),
  project: z.string().default(''),
  goal: z.string().default(''),
  measure: z.string().default(''),
  steps: z.string().default(''),
  why: z.string().default(''),
  importance: z.enum(['', 'High', 'Low']).default(''),
  urgency: z.enum(['', 'High', 'Low']).default(''),
  progress: z.number().int().min(0).max(100).default(0),
  parent: z.string().default(''),
  period: z.string().default(''),
  minutes: z.number().int().min(1).max(1440).default(25),
  started: z.union([z.literal(''), z.iso.datetime()]).default(''),
  completed: z.union([z.literal(''), z.iso.datetime()]).default(''),
}).passthrough();
export const recordInputSchema = z.object({
  domain: domainSchema,
  title: z.string().trim().min(1).max(500),
  body: z.string().max(5_000_000).default(''),
  fields: fieldsSchema.prefault({}),
});
export type RecordInput = z.infer<typeof recordInputSchema>;
export const recordSchema = recordInputSchema.extend({
  domain: z.union([domainSchema, z.literal(folderDomain)]),
  id: z.uuid(),
  created: z.iso.datetime(),
  updated: z.iso.datetime(),
  revision: z.string().min(1),
});
export type RecordEntry = z.infer<typeof recordSchema>;
export type DocumentEntry = RecordEntry & { domain: Domain };
export function isDocument(record: RecordEntry): record is DocumentEntry { return record.domain !== folderDomain; }
export interface Snapshot {
  records: RecordEntry[];
  revision: string;
}
export interface Repository {
  snapshot(): Promise<Snapshot>;
  changeFolders(plan: (records: RecordEntry[]) => Promise<FolderEdit[]>): Promise<Snapshot>;
  put(input: RecordInput, id?: string, expectedRevision?: string): Promise<RecordEntry>;
  remove(id: string, expectedRevision: string): Promise<void>;
  restore(records: RecordEntry[]): Promise<void>;
  close(): void;
}
export interface FolderEdit {
  before?: RecordEntry;
  after?: RecordEntry;
}
export class ConflictError extends Error {
  constructor() { super('This item changed in another window or process. Reload it before saving.'); this.name = 'ConflictError'; }
}
export const assetSchema = z.object({
  path: z.string().min(1).max(1000),
  data: z.string().max(28_000_000),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
export type Asset = z.infer<typeof assetSchema>;
export const backupSchema = z.object({
  format: z.literal('catpilot-workspace'),
  version: z.literal(1),
  workspace: workspaceSchema,
  exported: z.iso.datetime(),
  records: z.array(recordSchema),
  assets: z.array(assetSchema).default([]),
});
export type Backup = z.infer<typeof backupSchema>;
export interface Registry {
  version: 1;
  workspaces: Workspace[];
}
export const requestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('listWorkspaces') }),
  z.object({ action: z.literal('createWorkspace'), name: z.string().trim().min(1).max(80), backend: z.enum(['markdown', 'sqlite']), location: z.string().optional() }),
  z.object({ action: z.literal('renameWorkspace'), workspaceId: z.uuid(), name: z.string().trim().min(1).max(80) }),
  z.object({ action: z.literal('unregisterWorkspace'), workspaceId: z.uuid() }),
  z.object({ action: z.literal('snapshot'), workspaceId: z.uuid() }),
  z.object({ action: z.literal('conceptFolder'), workspaceId: z.uuid(), expected: z.string().regex(/^[0-9a-f]{64}$/), command: folderCommandSchema }),
  z.object({ action: z.literal('management'), workspaceId: z.uuid(), request: managementRequestSchema }),
  z.object({ action: z.literal('put'), workspaceId: z.uuid(), input: recordInputSchema, id: z.uuid().optional(), expectedRevision: z.string().optional() }),
  z.object({ action: z.literal('remove'), workspaceId: z.uuid(), id: z.uuid(), expectedRevision: z.string() }),
  z.object({ action: z.literal('export'), workspaceId: z.uuid() }),
  z.object({ action: z.literal('previewImport'), backup: backupSchema }),
  z.object({ action: z.literal('import'), workspaceId: z.uuid(), backup: backupSchema, approved: z.literal(true) }),
  z.object({ action: z.literal('readAsset'), workspaceId: z.uuid(), path: z.string() }),
  z.object({ action: z.literal('addAsset'), workspaceId: z.uuid(), asset: assetSchema }),
]);
export type Request = z.infer<typeof requestSchema>;
