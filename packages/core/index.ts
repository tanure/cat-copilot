import { WorkspaceRegistry } from './registry.js';
import { backupSchema, requestSchema, type Backup, type Repository, type Request, type Workspace } from './types.js';
import { addAsset, exportAssets, readAsset, validateAssets } from './assets.js';
import { restoreWorkspace } from './transfer.js';
import { withWorkspaceWrite } from './files.js';
import { ManagementService } from './management.js';
import { editConceptFolders } from './concept-folders.js';
export * from './types.js';
export * from './management-types.js';
export { WorkspaceRegistry } from './registry.js';
export { ManagementService } from './management.js';

export async function openRepository(workspace: Workspace): Promise<Repository> {
  if (workspace.backend === 'markdown') {
    const { MarkdownRepository } = await import('../storage-markdown/index.js');
    return new MarkdownRepository(workspace.location);
  }
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 13)) throw new Error('SQLite workspaces require Node 22.13 or newer. Legacy Markdown commands are unchanged.');
  const { SqliteRepository } = await import('../storage-sqlite/index.js');
  return new SqliteRepository(workspace.location);
}

export class WorkspaceService {
  readonly registry: WorkspaceRegistry;
  constructor(home?: string) { this.registry = new WorkspaceRegistry(home); }
  async execute(raw: Request): Promise<unknown> {
    const request = requestSchema.parse(raw);
    switch (request.action) {
      case 'listWorkspaces': return this.registry.list();
      case 'createWorkspace': return this.registry.create(request.name, request.backend, request.location);
      case 'renameWorkspace': return this.registry.rename(request.workspaceId, request.name);
      case 'unregisterWorkspace': return this.registry.unregister(request.workspaceId);
      case 'previewImport': {
        validateAssets(request.backup.assets);
        if (new Set(request.backup.records.map(record => record.id.toLowerCase())).size !== request.backup.records.length) throw new Error('Duplicate backup IDs.');
        return {
        workspace: request.backup.workspace.name,
        count: request.backup.records.length,
        assets: request.backup.assets.length,
        domains: Object.fromEntries([...new Set(request.backup.records.map(r => r.domain))].map(domain => [domain, request.backup.records.filter(r => r.domain === domain).length])),
        warning: 'Import only into an empty workspace. The source is not modified.',
        };
      }
    }
    const workspace = await this.registry.get(request.workspaceId);
    if (request.action === 'readAsset') return readAsset(workspace, request.path);
    if (request.action === 'addAsset') return addAsset(workspace, request.asset);
    const repository = await openRepository(workspace);
    try {
      switch (request.action) {
        case 'snapshot': return await repository.snapshot();
        case 'conceptFolder': return await withWorkspaceWrite(workspace.location, () => editConceptFolders(repository, request.expected, request.command));
        case 'management': {
          const execute = () => new ManagementService(repository).execute(request.request);
          return await (['prioritize', 'rollup', 'report', 'timerStatus', 'timerStats'].includes(request.request.action) ||
            (request.request.action === 'carryForward' && request.request.dryRun)
            ? execute()
            : withWorkspaceWrite(workspace.location, execute));
        }
        case 'put': return await withWorkspaceWrite(workspace.location, () => repository.put(request.input, request.id, request.expectedRevision));
        case 'remove': return await withWorkspaceWrite(workspace.location, () => repository.remove(request.id, request.expectedRevision));
        case 'export': return await withWorkspaceWrite(workspace.location, async () => ({
          format: 'catpilot-workspace', version: 1, workspace,
          exported: new Date().toISOString(), records: (await repository.snapshot()).records, assets: await exportAssets(workspace),
        } satisfies Backup));
        case 'import': {
          const backup = backupSchema.parse(request.backup);
          return await restoreWorkspace(workspace, repository, backup);
        }
      }
    } finally { repository.close(); }
  }
}
