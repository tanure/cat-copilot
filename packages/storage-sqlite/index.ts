import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { ConflictError, recordInputSchema, recordSchema, type RecordEntry, type RecordInput, type Repository, type Snapshot } from '../core/types.js';

export class SqliteRepository implements Repository {
  private readonly db: DatabaseSync;
  constructor(location: string) {
    const file = path.join(location, 'catpilot.sqlite');
    if (!fs.lstatSync(file, { throwIfNoEntry: false })) {
      try { fs.writeFileSync(file, '', { flag: 'wx', mode: 0o600 }); }
      catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
      }
    }
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('The database file must be a regular file, not a symbolic link.');
    this.db = new DatabaseSync(file);
    try {
      this.db.exec('PRAGMA busy_timeout=5000;');
      const applicationId = Number(this.db.prepare('PRAGMA application_id').get()?.application_id);
      const empty = Number(this.db.prepare("SELECT count(*) AS count FROM sqlite_master WHERE name NOT GLOB 'sqlite_*'").get()?.count) === 0;
      if (applicationId !== 1128354896 && !(applicationId === 0 && empty)) throw new Error('This is not a CatPilot workspace database. It has not been adopted.');
      const version = this.db.prepare('PRAGMA user_version').get();
      if (Number(version?.user_version) > 1) throw new Error('This database was created by a newer CatPilot version.');
      this.db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;');
      this.db.exec(`
        BEGIN IMMEDIATE;
        CREATE TABLE IF NOT EXISTS records (
          id TEXT PRIMARY KEY, domain TEXT NOT NULL, title TEXT NOT NULL,
          body TEXT NOT NULL, fields TEXT NOT NULL, created TEXT NOT NULL,
          updated TEXT NOT NULL, revision TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS records_domain_updated ON records(domain, updated);
        PRAGMA user_version=1;
        PRAGMA application_id=1128354896;
        COMMIT;
      `);
    } catch (error) { this.db.close(); throw error; }
  }
  private decode(row: Record<string, unknown>): RecordEntry {
    return recordSchema.parse({ ...row, fields: JSON.parse(String(row.fields)) });
  }
  async snapshot(): Promise<Snapshot> {
    const rows = this.db.prepare('SELECT * FROM records ORDER BY id').all();
    const records = rows.map(row => this.decode(row));
    return { records, revision: createHash('sha256').update(records.map(r => `${r.id}:${r.revision}`).join('|')).digest('hex') };
  }
  async changeFolders(plan: Parameters<Repository['changeFolders']>[0]): Promise<Snapshot> {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const { before, after } of await plan((await this.snapshot()).records)) {
        if (after) this.insert(after);
        else if (before) await this.remove(before.id, before.revision);
      }
      const result = await this.snapshot();
      this.db.exec('COMMIT');
      return result;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  async put(input: RecordInput, id?: string, expectedRevision?: string): Promise<RecordEntry> {
    input = recordInputSchema.parse(input);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const row = id ? this.db.prepare('SELECT * FROM records WHERE id=?').get(z.uuid().parse(id)) : undefined;
      const old = row ? this.decode(row) : undefined;
      if (id && (!old || old.revision !== expectedRevision)) throw new ConflictError();
      if (!id && expectedRevision) throw new Error('A revision requires a record ID.');
      if (old && old.domain !== input.domain) throw new Error('Cannot change a record domain.');
      const now = new Date().toISOString();
      const record = { ...input, id: old?.id || randomUUID(), created: old?.created || now, updated: now, revision: randomUUID() };
      this.insert(record);
      this.db.exec('COMMIT');
      return record;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  private insert(record: RecordEntry) {
    this.db.prepare(`INSERT INTO records(id,domain,title,body,fields,created,updated,revision)
      VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
      title=excluded.title,body=excluded.body,fields=excluded.fields,updated=excluded.updated,revision=excluded.revision`)
      .run(record.id, record.domain, record.title, record.body, JSON.stringify(record.fields), record.created, record.updated, record.revision);
  }
  async remove(id: string, expectedRevision: string): Promise<void> {
    const result = this.db.prepare('DELETE FROM records WHERE id=? AND revision=?').run(z.uuid().parse(id), expectedRevision);
    if (result.changes !== 1) throw new ConflictError();
  }
  async restore(records: RecordEntry[]): Promise<void> {
    records = z.array(recordSchema).parse(records);
    if (new Set(records.map(r => r.id.toLowerCase())).size !== records.length) throw new Error('Duplicate backup IDs (including filename case collisions).');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (Number(this.db.prepare('SELECT count(*) AS count FROM records').get()?.count)) throw new Error('Import requires an empty destination workspace.');
      for (const record of records) this.insert({ ...record, revision: randomUUID() });
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  close() { this.db.close(); }
}
