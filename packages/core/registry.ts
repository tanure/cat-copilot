import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { atomicWrite, ensureRealDirectory, isWithin, missing, withLock } from './files.js';
import { workspaceSchema, type Registry, type Workspace } from './types.js';

const schema = z.object({ version: z.literal(1), workspaces: z.array(workspaceSchema) });
export class WorkspaceRegistry {
  readonly root: string;
  constructor(root = process.env.CATPILOT_HOME || path.join(os.homedir(), '.catpilot')) { this.root = path.resolve(root); }
  private get file() { return path.join(this.root, 'workspaces.json'); }
  async list(): Promise<Workspace[]> {
    try { return schema.parse(JSON.parse(await fs.readFile(this.file, 'utf8'))).workspaces; }
    catch (error) { if (missing(error)) return []; throw error; }
  }
  async get(id: string): Promise<Workspace> {
    const workspaces = await this.list();
    const matches = workspaces.filter(w => w.id === id || w.name === id);
    if (matches.length !== 1) throw new Error(`Workspace not found or ambiguous: ${id}`);
    const workspace = matches[0];
    const real = await fs.realpath(workspace.location);
    const canonical = (value: string) => process.platform === 'win32' ? value.toLowerCase() : value;
    if (canonical(real) !== canonical(workspace.location)) throw new Error('The registered workspace directory was replaced by a link. Restore its original directory before accessing it.');
    return workspace;
  }
  private async change<T>(update: (registry: Registry) => Promise<T>): Promise<T> {
    await ensureRealDirectory(this.root);
    return withLock(this.file, async () => {
      const registry: Registry = { version: 1, workspaces: await this.list() };
      const result = await update(registry);
      await atomicWrite(this.file, JSON.stringify(registry, null, 2) + '\n');
      return result;
    });
  }
  async create(name: string, backend: Workspace['backend'], location?: string): Promise<Workspace> {
    name = z.string().trim().min(1).max(80).parse(name);
    backend = z.enum(['markdown', 'sqlite']).parse(backend);
    return this.change(async registry => {
      if (registry.workspaces.some(w => w.name.toLowerCase() === name.toLowerCase())) throw new Error('A workspace with this name already exists.');
      const id = randomUUID();
      const selected = path.resolve(location || path.join(this.root, 'workspaces', id));
      const root = await ensureRealDirectory(selected);
      for (const other of registry.workspaces) {
        const existing = await fs.realpath(other.location);
        if (isWithin(existing, root) || isWithin(root, existing)) throw new Error('Workspace directories must not overlap.');
      }
      const workspace = workspaceSchema.parse({ id, name, backend, location: root, created: new Date().toISOString() });
      registry.workspaces.push(workspace);
      return workspace;
    });
  }
  async rename(id: string, name: string): Promise<void> {
    name = z.string().trim().min(1).max(80).parse(name);
    await this.change(async registry => {
      const workspace = registry.workspaces.find(w => w.id === id);
      if (!workspace) throw new Error('Workspace not found.');
      if (registry.workspaces.some(w => w.id !== id && w.name.toLowerCase() === name.toLowerCase())) throw new Error('A workspace with this name already exists.');
      workspace.name = name;
    });
  }
  async unregister(id: string): Promise<void> {
    await this.change(async registry => {
      if (!registry.workspaces.some(w => w.id === id)) throw new Error('Workspace not found.');
      registry.workspaces = registry.workspaces.filter(w => w.id !== id);
    });
  }
}
