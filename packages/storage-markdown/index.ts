import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { atomicWrite, ensureRealDirectory, isWithin, missing, withLock } from '../core/files.js';
import { ConflictError, recordInputSchema, recordSchema, type RecordEntry, type RecordInput, type Repository, type Snapshot } from '../core/types.js';
import { z } from 'zod';
import { changeFolderFiles } from '../core/folder-file-edits.js';

const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const header = /^---\r?\ncatpilot: ([^\r\n]+)\r?\n---\r?\n/;
export class MarkdownRepository implements Repository {
  private readonly root: string;
  constructor(location: string) { this.root = path.join(location, 'CatPilot'); }
  private async prepare() {
    const parent = await fs.realpath(path.dirname(this.root));
    const real = await ensureRealDirectory(this.root);
    if (!isWithin(parent, real) || real === parent) throw new Error('The CatPilot data directory must not be a symlink outside the workspace.');
    return real;
  }
  private file(id: string) { return path.join(this.root, `${z.uuid().parse(id)}.md`); }
  private async readRaw(id: string): Promise<string> {
    const file = this.file(id);
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Linked or non-file records are not supported.');
    return fs.readFile(file, 'utf8');
  }
  private async read(id: string): Promise<RecordEntry> {
    const raw = await this.readRaw(id);
    const match = raw.match(header);
    if (!match) throw new Error(`Invalid CatPilot metadata in ${id}.md. Source was not modified.`);
    const metadata: unknown = JSON.parse(match[1]);
    if (typeof metadata !== 'object' || metadata === null) throw new Error('Invalid record metadata.');
    const record = recordSchema.parse({ ...metadata, body: raw.slice(match[0].length), revision: hash(raw) });
    if (record.id !== id) throw new Error('Record ID does not match its filename.');
    return record;
  }
  async snapshot(): Promise<Snapshot> {
    return withLock(this.root, () => this.readSnapshot());
  }
  private async readSnapshot(): Promise<Snapshot> {
    await this.prepare();
    const entries = await fs.readdir(this.root);
    const records: RecordEntry[] = [];
    for (const name of entries.sort()) {
      if (!name.endsWith('.md')) continue;
      const id = name.slice(0, -3);
      if (!z.uuid().safeParse(id).success) throw new Error(`Unrecognized Markdown file in the CatPilot data directory: ${name}`);
      try { records.push(await this.read(id)); }
      catch (error) { if (!missing(error)) throw error; }
    }
    return { records, revision: hash(records.map(r => `${r.id}:${r.revision}`).join('\n')) };
  }
  async changeFolders(plan: Parameters<Repository['changeFolders']>[0]): Promise<Snapshot> {
    return withLock(this.root, async () => {
      await changeFolderFiles(await plan((await this.readSnapshot()).records), {
        read: async id => {
          try { const raw = await this.readRaw(id); return { raw, revision: hash(raw) }; }
          catch (error) { if (!missing(error)) throw error; return undefined; }
        },
        serialize: (record, previous) => this.serialize(record, previous),
        write: (id, raw) => atomicWrite(this.file(id), raw),
        remove: id => fs.unlink(this.file(id)),
      });
      return this.readSnapshot();
    });
  }
  private serialize(record: RecordEntry, original?: string): string {
    const { body, revision: _revision, ...metadata } = record;
    const match = original?.match(header);
    if (match) return match[0].replace(match[1], () => JSON.stringify({ ...JSON.parse(match[1]), ...metadata })) + body;
    return `---\ncatpilot: ${JSON.stringify(metadata)}\n---\n${body}`;
  }
  async put(input: RecordInput, id?: string, expectedRevision?: string): Promise<RecordEntry> {
    input = recordInputSchema.parse(input);
    return withLock(this.root, async () => {
      await this.prepare();
      let existing: RecordEntry | undefined;
      if (id) {
        try { existing = await this.read(id); }
        catch (error) { if (!missing(error)) throw error; }
        if (!existing || expectedRevision !== existing.revision) throw new ConflictError();
        if (existing.domain !== input.domain) throw new Error('Cannot change a record domain.');
      } else if (expectedRevision) throw new Error('A revision requires a record ID.');
      const now = new Date().toISOString();
      const record = { ...input, id: existing?.id || randomUUID(), created: existing?.created || now, updated: now, revision: 'new' };
      const original = existing ? await this.readRaw(existing.id) : undefined;
      if (original !== undefined && hash(original) !== expectedRevision) throw new ConflictError();
      const raw = this.serialize(record, original);
      await atomicWrite(this.file(record.id), raw);
      return { ...record, revision: hash(raw) };
    });
  }
  async remove(id: string, expectedRevision: string): Promise<void> {
    await withLock(this.root, async () => {
      await this.prepare();
      let existing: RecordEntry;
      try { existing = await this.read(id); }
      catch (error) { if (missing(error)) throw new ConflictError(); throw error; }
      if (existing.revision !== expectedRevision) throw new ConflictError();
      await fs.unlink(this.file(id));
    });
  }
  async restore(records: RecordEntry[]): Promise<void> {
    records = z.array(recordSchema).parse(records);
    if (new Set(records.map(r => r.id.toLowerCase())).size !== records.length) throw new Error('Duplicate backup IDs (including filename case collisions).');
    await withLock(this.root, async () => {
      await this.prepare();
      const existing = await fs.readdir(this.root);
      if (existing.length) throw new Error('Import requires an empty destination workspace.');
      const stage = path.join(path.dirname(this.root), `.catpilot-import-${randomUUID()}`);
      await fs.mkdir(stage, { mode: 0o700 });
      try {
        for (const record of records) await atomicWrite(path.join(stage, `${record.id}.md`), this.serialize(record));
        await fs.rmdir(this.root);
        try { await fs.rename(stage, this.root); }
        catch (error) { await fs.mkdir(this.root); throw error; }
      } catch (error) {
        await fs.rm(stage, { recursive: true, force: true });
        throw error;
      }
    });
  }
  close() {}
}
