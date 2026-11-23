import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { z } from 'zod';
import { ManagementService } from '../../../packages/core/management.js';
import { editConceptFolders } from '../../../packages/core/concept-folders.js';
import { changeFolderFiles } from '../../../packages/core/folder-file-edits.js';
import {
  ConflictError, recordInputSchema, recordSchema, requestSchema, workspaceSchema,
  type Asset, type Backup, type RecordEntry, type RecordInput, type Repository, type Request, type Snapshot, type Workspace,
} from '../../../packages/core/types.js';
import {
  MAX_ASSET_BYTES, MAX_FILE_BYTES, MAX_FILES, assetBytes, assetParts, canonical, digest,
  mimeType, parseMarkdown, previewBackup, serializeMarkdown, toBase64, utf8, validateAssets, validateBackup,
} from './storage-codecs.js';

// Small structural interfaces avoid a runtime dependency on nonstandard DOM declarations.
export interface BrowserFileHandle {
  kind: 'file';
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(data: string | Uint8Array<ArrayBuffer>): Promise<void>; close(): Promise<void>; abort(): Promise<void> }>;
}
export interface BrowserDirectoryHandle {
  kind: 'directory';
  name: string;
  values(): AsyncIterableIterator<BrowserDirectoryHandle | BrowserFileHandle>;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<BrowserDirectoryHandle>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<BrowserFileHandle>;
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
  isSameEntry(other: BrowserDirectoryHandle): Promise<boolean>;
  resolve(other: BrowserDirectoryHandle): Promise<string[] | null>;
  queryPermission(options: { mode: 'readwrite' }): Promise<PermissionState>;
  requestPermission(options: { mode: 'readwrite' }): Promise<PermissionState>;
}
interface Registration { workspace: Workspace; directory?: BrowserDirectoryHandle }
interface StoredWorkspace { database: Uint8Array; assets: Asset[] }
const REGISTRY_LOCK = 'catpilot:pwa:registry:v1';
const RECOVERY_FILE = '.catpilot-browser-recovery.json';
const recoveryMessage = 'An interrupted Markdown import needs recovery. Retry the original backup using Preview import, then approve it. If files were edited externally, keep this folder and its recovery journal and import into a different empty folder; do not delete recovery files until you have recovered your data.';
const missing = (error: unknown) => error instanceof DOMException && error.name === 'NotFoundError';
const uuid = () => crypto.randomUUID();

function idbResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Browser storage request failed.'));
  });
}
function completed(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('Browser storage commit was aborted. Free space and retry.'));
    transaction.onerror = () => reject(transaction.error ?? new Error('Browser storage transaction failed.'));
  });
}
async function optionalDirectory(root: BrowserDirectoryHandle, name: string) {
  try { return await root.getDirectoryHandle(name); }
  catch (error) { if (missing(error)) return undefined; throw error; }
}
async function optionalFile(root: BrowserDirectoryHandle, name: string) {
  try { return await root.getFileHandle(name); }
  catch (error) { if (missing(error)) return undefined; throw error; }
}
async function writeFile(handle: BrowserFileHandle, data: string | Uint8Array) {
  const writer = await handle.createWritable();
  try { await writer.write(typeof data === 'string' ? data : new Uint8Array(data)); await writer.close(); }
  catch (error) { try { await writer.abort(); } catch { /* The original write error is actionable. */ } throw error; }
}
async function directoryEmpty(root: BrowserDirectoryHandle | undefined) {
  if (root) for await (const _entry of root.values()) return false;
  return true;
}
function sameInput(existing: RecordEntry, input: RecordInput) {
  return canonical({ domain: existing.domain, title: existing.title, body: existing.body, fields: existing.fields }) === canonical(input);
}
function nextRecord(input: RecordInput, existing?: RecordEntry): RecordEntry {
  const now = new Date().toISOString();
  return { ...input, id: existing?.id ?? uuid(), created: existing?.created ?? now, updated: now, revision: uuid() };
}

class SqliteBrowserRepository implements Repository {
  dirty = false;
  constructor(readonly db: Database) {
    const applicationId = Number(db.exec('PRAGMA application_id')[0]?.values[0]?.[0] ?? 0);
    const version = Number(db.exec('PRAGMA user_version')[0]?.values[0]?.[0] ?? 0);
    const empty = Number(db.exec("SELECT count(*) FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'")[0]?.values[0]?.[0]) === 0;
    if (applicationId !== 1128354896 && !(applicationId === 0 && empty)) throw new Error('Not a CatPilot SQLite database.');
    if (version > 1) throw new Error('This database was created by a newer CatPilot version.');
    db.run(`CREATE TABLE IF NOT EXISTS records (
      id TEXT PRIMARY KEY, domain TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL,
      fields TEXT NOT NULL, created TEXT NOT NULL, updated TEXT NOT NULL, revision TEXT NOT NULL
    ); CREATE INDEX IF NOT EXISTS records_domain_updated ON records(domain, updated);
    PRAGMA application_id=1128354896; PRAGMA user_version=1;`);
  }
  private rows(): RecordEntry[] {
    const statement = this.db.prepare('SELECT * FROM records ORDER BY id');
    const records: RecordEntry[] = [];
    try {
      while (statement.step()) {
        const row = statement.getAsObject();
        records.push(recordSchema.parse({ ...row, fields: JSON.parse(String(row.fields)) }));
      }
    } finally { statement.free(); }
    return records;
  }
  async snapshot(): Promise<Snapshot> {
    const records = this.rows();
    return { records, revision: await digest(records.map(record => `${record.id}:${record.revision}`).join('|')) };
  }
  async changeFolders(plan: Parameters<Repository['changeFolders']>[0]): Promise<Snapshot> {
    const records = this.rows();
    const edits = await plan(records);
    if (records.length + edits.reduce((delta, edit) => delta + Number(!edit.before) - Number(!edit.after), 0) > MAX_FILES) {
      throw new Error('Workspace exceeds the 20,000 record limit.');
    }
    for (const { before, after } of edits) {
      if (after) {
        if (utf8(serializeMarkdown(after)).length > MAX_FILE_BYTES) throw new Error('Record exceeds 20 MB.');
        this.insert(after);
      } else if (before) await this.remove(before.id, before.revision);
    }
    return this.snapshot();
  }
  private insert(record: RecordEntry) {
    this.db.run(`INSERT INTO records(id,domain,title,body,fields,created,updated,revision)
      VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,
      body=excluded.body, fields=excluded.fields, updated=excluded.updated, revision=excluded.revision`,
    [record.id, record.domain, record.title, record.body, JSON.stringify(record.fields), record.created, record.updated, record.revision]);
    this.dirty = true;
  }
  async put(raw: RecordInput, id?: string, expectedRevision?: string): Promise<RecordEntry> {
    const input = recordInputSchema.parse(raw);
    const records = this.rows();
    const existing = id ? records.find(record => record.id === z.uuid().parse(id)) : undefined;
    if (id && (!existing || expectedRevision !== existing.revision)) throw new ConflictError();
    if (!id && expectedRevision !== undefined) throw new Error('A revision requires a record ID.');
    if (existing && existing.domain !== input.domain) throw new Error('Cannot change a record domain.');
    if (existing && sameInput(existing, input)) return existing;
    if (!existing && records.length >= MAX_FILES) throw new Error('Workspace exceeds the 20,000 record limit.');
    const record = nextRecord(input, existing);
    if (utf8(serializeMarkdown(record)).length > MAX_FILE_BYTES) throw new Error('Record exceeds 20 MB.');
    this.insert(record);
    return record;
  }
  async remove(id: string, expectedRevision: string) {
    this.db.run('DELETE FROM records WHERE id=? AND revision=?', [z.uuid().parse(id), expectedRevision]);
    if (this.db.getRowsModified() !== 1) throw new ConflictError();
    this.dirty = true;
  }
  async restore(records: RecordEntry[]) {
    records = z.array(recordSchema).parse(records);
    if (this.rows().length) throw new Error('Import requires an empty destination workspace.');
    if (new Set(records.map(record => record.id.toLowerCase())).size !== records.length) throw new Error('Duplicate backup IDs.');
    for (const record of records) this.insert(record);
  }
  close() { this.db.close(); }
}

class MarkdownBrowserRepository implements Repository {
  constructor(readonly directory: BrowserDirectoryHandle) {}
  private async entries() {
    const root = await optionalDirectory(this.directory, 'CatPilot');
    const entries: BrowserFileHandle[] = [];
    if (root) for await (const entry of root.values()) {
      if (entry.kind !== 'file' || !entry.name.endsWith('.md') || !z.uuid().safeParse(entry.name.slice(0, -3)).success) {
        throw new Error(`Unrecognized file in CatPilot/: ${entry.name}. Source was not modified.`);
      }
      if (entries.length >= MAX_FILES) throw new Error('Workspace exceeds the 20,000 record limit.');
      entries.push(entry);
    }
    const ids = entries.map(entry => entry.name.toLowerCase());
    if (new Set(ids).size !== ids.length) throw new Error('Record filename case collision.');
    return entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  }
  private async read(handle: BrowserFileHandle) {
    const file = await handle.getFile();
    if (file.size > MAX_FILE_BYTES) throw new Error(`Record exceeds 20 MB: ${handle.name}`);
    return parseMarkdown(handle.name.slice(0, -3), await file.text());
  }
  async snapshot(): Promise<Snapshot> {
    const records: RecordEntry[] = [];
    for (const handle of await this.entries()) records.push((await this.read(handle)).record);
    return { records, revision: await digest(records.map(record => `${record.id}:${record.revision}`).join('\n')) };
  }
  async changeFolders(plan: Parameters<Repository['changeFolders']>[0]): Promise<Snapshot> {
    const { records } = await this.snapshot();
    const edits = await plan(records);
    if (records.length + edits.reduce((delta, edit) => delta + Number(!edit.before) - Number(!edit.after), 0) > MAX_FILES) {
      throw new Error('Workspace exceeds the 20,000 record limit.');
    }
    if (edits.length) {
      const root = await this.directory.getDirectoryHandle('CatPilot', { create: true });
      await changeFolderFiles(edits, {
        read: async id => {
          const handle = await optionalFile(root, `${id}.md`);
          if (!handle) return undefined;
          const file = await handle.getFile();
          if (file.size > MAX_FILE_BYTES) throw new Error(`Record exceeds 20 MB: ${handle.name}`);
          const raw = await file.text();
          return { raw, revision: await digest(raw) };
        },
        serialize: async (record, previous) => {
          const metadata = previous === undefined ? undefined : (await parseMarkdown(record.id, previous)).metadata;
          const text = serializeMarkdown(record, metadata);
          if (utf8(text).length > MAX_FILE_BYTES) throw new Error('Record exceeds 20 MB.');
          return text;
        },
        write: async (id, raw) => {
          const name = `${id}.md`;
          const existing = await optionalFile(root, name);
          try { await writeFile(existing ?? await root.getFileHandle(name, { create: true }), raw); }
          catch (error) {
            const created = !existing && await optionalFile(root, name);
            if (created && (await created.getFile()).size === 0) await root.removeEntry(name);
            throw error;
          }
        },
        remove: id => root.removeEntry(`${id}.md`),
      });
    }
    return this.snapshot();
  }
  async put(raw: RecordInput, id?: string, expectedRevision?: string): Promise<RecordEntry> {
    const input = recordInputSchema.parse(raw);
    const entries = await this.entries();
    const handle = id ? entries.find(entry => entry.name === `${z.uuid().parse(id)}.md`) : undefined;
    const current = handle ? await this.read(handle) : undefined;
    const existing = current?.record;
    if (id && (!existing || expectedRevision !== existing.revision)) throw new ConflictError();
    if (!id && expectedRevision !== undefined) throw new Error('A revision requires a record ID.');
    if (existing && existing.domain !== input.domain) throw new Error('Cannot change a record domain.');
    if (existing && sameInput(existing, input)) return existing;
    if (!existing && entries.length >= MAX_FILES) throw new Error('Workspace exceeds the 20,000 record limit.');
    const record = nextRecord(input, existing);
    const text = serializeMarkdown(record, current?.metadata);
    if (utf8(text).length > MAX_FILE_BYTES) throw new Error('Record exceeds 20 MB.');
    const root = await this.directory.getDirectoryHandle('CatPilot', { create: true });
    if (handle && (await this.read(handle)).record.revision !== expectedRevision) throw new ConflictError();
    if (!handle && await optionalFile(root, `${record.id}.md`)) throw new ConflictError();
    await writeFile(handle ?? await root.getFileHandle(`${record.id}.md`, { create: true }), text);
    return { ...record, revision: await digest(text) };
  }
  async remove(id: string, expectedRevision: string) {
    const root = await optionalDirectory(this.directory, 'CatPilot');
    const handle = root && await optionalFile(root, `${z.uuid().parse(id)}.md`);
    if (!root || !handle || (await this.read(handle)).record.revision !== expectedRevision) throw new ConflictError();
    await root.removeEntry(handle.name);
  }
  async restore(_records: RecordEntry[]): Promise<void> {
    throw new Error('Markdown restore must use the journaled workspace import operation.');
  }
  close() {}
}

async function exportDirectoryAssets(directory: BrowserDirectoryHandle): Promise<Asset[]> {
  const root = await optionalDirectory(directory, 'CatPilotAssets');
  const assets: Asset[] = [];
  let total = 0;
  const walk = async (parent: BrowserDirectoryHandle, prefix = '', depth = 0) => {
    if (depth > 40) throw new Error('Asset directory nesting exceeds the transfer limit.');
    const entries: Array<BrowserDirectoryHandle | BrowserFileHandle> = [];
    for await (const entry of parent.values()) entries.push(entry);
    entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    for (const entry of entries) {
      const path = prefix + entry.name;
      assetParts(path);
      if (entry.kind === 'directory') { await walk(entry, path + '/', depth + 1); continue; }
      const file = await entry.getFile();
      total += file.size;
      if (file.size > MAX_FILE_BYTES || total > MAX_ASSET_BYTES || assets.length >= MAX_FILES) {
        throw new Error('Assets exceed transfer limits (20 MB/file, 50 MB total, 20,000 files).');
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      const after = await entry.getFile();
      if (file.size !== after.size || file.lastModified !== after.lastModified) throw new Error(`Asset changed while reading: ${path}`);
      assets.push({ path, data: toBase64(bytes), sha256: await digest(bytes) });
    }
  };
  if (root) await walk(root);
  await validateAssets(assets);
  return assets;
}
async function assetHandle(directory: BrowserDirectoryHandle, path: string, create: boolean) {
  const parts = assetParts(path);
  let parent = await directory.getDirectoryHandle('CatPilotAssets', { create });
  for (const part of parts.slice(0, -1)) parent = await parent.getDirectoryHandle(part, { create });
  return { parent, name: parts.at(-1)! };
}
const journalSchema = z.object({ version: z.literal(1), fingerprint: z.string().regex(/^[a-f0-9]{64}$/) });
async function readJournal(directory: BrowserDirectoryHandle) {
  const handle = await optionalFile(directory, RECOVERY_FILE);
  if (!handle) return undefined;
  const file = await handle.getFile();
  if (file.size > 4096) throw new Error(recoveryMessage);
  try { return journalSchema.parse(JSON.parse(await file.text())); }
  catch { throw new Error(recoveryMessage); }
}
async function importMarkdown(directory: BrowserDirectoryHandle, backup: Backup) {
  const fingerprint = await digest(canonical(backup));
  const journal = await readJournal(directory);
  if (journal && journal.fingerprint !== fingerprint) throw new Error(recoveryMessage);
  if (!journal) {
    if (!await directoryEmpty(await optionalDirectory(directory, 'CatPilot')) ||
      !await directoryEmpty(await optionalDirectory(directory, 'CatPilotAssets'))) {
      throw new Error('Import requires an empty destination workspace (records and assets).');
    }
    await writeFile(await directory.getFileHandle(RECOVERY_FILE, { create: true }), JSON.stringify({ version: 1, fingerprint }));
  }
  try {
    const expected = new Map<string, string | Uint8Array>();
    for (const record of backup.records) expected.set(`CatPilot/${record.id}.md`, serializeMarkdown(record));
    for (const asset of backup.assets) expected.set(`CatPilotAssets/${asset.path}`, await assetBytes(asset));
    const directories = new Set<string>();
    for (const path of expected.keys()) {
      const parts = path.split('/');
      for (let depth = 1; depth < parts.length; depth++) directories.add(parts.slice(0, depth).join('/'));
    }
    // On recovery, only byte-identical completed files are accepted. Never overwrite an external edit.
    const verify = async (complete: boolean) => {
      const found = new Set<string>();
      const visit = async (root: BrowserDirectoryHandle, prefix: string, depth: number) => {
        if (depth > 42) throw new Error('Unexpected nested recovery files.');
        for await (const entry of root.values()) {
          const path = `${prefix}/${entry.name}`;
          if (entry.kind === 'directory') {
            if (!directories.has(path)) throw new Error(`Unexpected recovery directory: ${path}`);
            await visit(entry, path, depth + 1);
          } else {
            const value = expected.get(path);
            const file = await entry.getFile();
            if (value === undefined || file.size > MAX_FILE_BYTES || await digest(new Uint8Array(await file.arrayBuffer())) !== await digest(value)) {
              throw new Error(`Recovery file differs from the original backup: ${path}`);
            }
            found.add(path);
          }
        }
      };
      for (const name of ['CatPilot', 'CatPilotAssets']) {
        const root = await optionalDirectory(directory, name);
        if (root) await visit(root, name, 0);
      }
      if (complete && found.size !== expected.size) throw new Error('Import verification found missing files.');
      return found;
    };
    const existing = await verify(false);
    for (const [path, content] of expected) {
      if (existing.has(path)) continue;
      const parts = path.split('/');
      let parent = directory;
      for (const part of parts.slice(0, -1)) parent = await parent.getDirectoryHandle(part, { create: true });
      if (await optionalFile(parent, parts.at(-1)!)) throw new Error(`Destination changed during import: ${path}`);
      await writeFile(await parent.getFileHandle(parts.at(-1)!, { create: true }), content);
    }
    await verify(true);
    await directory.removeEntry(RECOVERY_FILE);
    return { count: backup.records.length, assets: backup.assets.length };
  } catch (error) {
    throw new Error(`${recoveryMessage} ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}

export class BrowserStorage {
  private sql?: Promise<SqlJsStatic>;
  private constructor(private readonly db: IDBDatabase) {}
  static async open(): Promise<BrowserStorage> {
    if (!globalThis.indexedDB || !navigator.locks || !crypto.subtle) {
      throw new Error('Offline storage requires IndexedDB, Web Locks, and Web Crypto in a secure Chromium browser (HTTPS or localhost).');
    }
    const request = indexedDB.open('catpilot-offline-v1', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('registry', { keyPath: 'workspace.id' });
      request.result.createObjectStore('workspaces');
    };
    const db = await idbResult(request);
    db.onversionchange = () => db.close();
    return new BrowserStorage(db);
  }
  private sqlRuntime(): Promise<SqlJsStatic> {
    return this.sql ??= initSqlJs({ locateFile: () => wasmUrl }).catch(error => {
      this.sql = undefined;
      throw new Error('The SQLite engine could not load. Reopen the app online once to cache its local WASM engine, then retry. Existing workspace data has not been changed.', { cause: error });
    });
  }
  private async registrations(): Promise<Registration[]> {
    const transaction = this.db.transaction('registry', 'readonly');
    const done = completed(transaction);
    const result = await idbResult<Registration[]>(transaction.objectStore('registry').getAll());
    await done;
    return result.map(item => ({ ...item, workspace: workspaceSchema.parse(item.workspace) }));
  }
  private async registration(id: string) {
    const item = (await this.registrations()).find(item => item.workspace.id === id);
    if (!item) throw new Error('Workspace is not registered in this browser.');
    return item;
  }
  private async saveRegistration(item: Registration) {
    const transaction = this.db.transaction('registry', 'readwrite');
    const done = completed(transaction);
    transaction.objectStore('registry').put(item);
    await done;
  }
  private readonly chosenDirectories = new Map<string, BrowserDirectoryHandle>();
  private readonly accessDirectories = new Map<string, BrowserDirectoryHandle>();
  async loadAccessHandles() {
    for (const item of await this.registrations()) if (item.directory) this.accessDirectories.set(item.workspace.id, item.directory);
  }
  requestWorkspaceAccess(id: string): Promise<boolean> {
    const handle = this.accessDirectories.get(id);
    if (!handle) return Promise.reject(new Error('No saved directory handle. Choose the original folder again.'));
    // Invoked before any await so the browser retains the caller's activation.
    return handle.requestPermission({ mode: 'readwrite' }).then(state => {
      if (state !== 'granted') throw new Error('Folder permission was not granted. Click Restore folder access and allow read/write access.');
      return true;
    });
  }
  async rememberDirectory(directory: BrowserDirectoryHandle) {
    const token = `browser-folder:${uuid()}`;
    this.chosenDirectories.set(token, directory);
    await navigator.locks.request(REGISTRY_LOCK, async () => {
      for (const item of await this.registrations()) {
        if (item.directory && await directory.isSameEntry(item.directory)) {
          await this.saveRegistration({ ...item, directory });
          this.accessDirectories.set(item.workspace.id, directory);
        }
      }
    });
    return token;
  }
  private async requireDirectory(item: Registration) {
    const directory = item.directory;
    if (!directory || await directory.queryPermission({ mode: 'readwrite' }) !== 'granted') {
      throw new Error('Folder access is required. Click Restore folder access, or Choose folder and select the original folder again, then retry. No files were read or changed.');
    }
    return directory;
  }
  private async loadState(id: string): Promise<StoredWorkspace | undefined> {
    const transaction = this.db.transaction('workspaces', 'readonly');
    const done = completed(transaction);
    const state = await idbResult<StoredWorkspace | undefined>(transaction.objectStore('workspaces').get(id));
    await done;
    return state;
  }
  private async saveState(id: string, state: StoredWorkspace) {
    const transaction = this.db.transaction('workspaces', 'readwrite');
    const done = completed(transaction);
    transaction.objectStore('workspaces').put(state, id);
    await done;
  }
  async execute(raw: Request): Promise<unknown> {
    if (raw.action === 'previewImport' || raw.action === 'import') await validateBackup(raw.backup);
    const request = requestSchema.parse(raw);
    if (request.action === 'previewImport') return previewBackup(request.backup);
    if (['listWorkspaces', 'createWorkspace', 'renameWorkspace', 'unregisterWorkspace'].includes(request.action)) {
      return navigator.locks.request(REGISTRY_LOCK, () => this.registryRequest(request));
    }
    if (!('workspaceId' in request)) throw new Error('Invalid workspace action.');
    return navigator.locks.request(REGISTRY_LOCK, { mode: 'shared' }, () =>
      navigator.locks.request(`catpilot:pwa:workspace:${request.workspaceId}`, async () => {
        const item = await this.registration(request.workspaceId);
        if (item.workspace.backend === 'markdown') {
          const directory = await this.requireDirectory(item);
          if (request.action === 'import') return importMarkdown(directory, request.backup);
          if (await optionalFile(directory, RECOVERY_FILE)) throw new Error(recoveryMessage);
          return this.repositoryRequest(item.workspace, new MarkdownBrowserRepository(directory), request, undefined, directory);
        }
        const state = await this.loadState(item.workspace.id);
        if (!state) throw new Error('SQLite workspace data is missing. Restore a backup into a new workspace; this workspace has not been silently recreated.');
        const sql = await this.sqlRuntime();
        const db = new sql.Database(new Uint8Array(state.database));
        try {
          const repository = new SqliteBrowserRepository(db);
          db.run('BEGIN IMMEDIATE');
          const result = await this.repositoryRequest(item.workspace, repository, request, state);
          db.run('COMMIT');
          if (repository.dirty || request.action === 'addAsset' || request.action === 'import') {
            await this.saveState(item.workspace.id, { database: db.export(), assets: state.assets });
          }
          return result;
        } catch (error) {
          try { db.run('ROLLBACK'); } catch { /* A committed in-memory database is discarded on failed IDB commits. */ }
          throw error;
        } finally { db.close(); }
      }));
  }
  private async registryRequest(request: Request): Promise<unknown> {
    const items = await this.registrations();
    switch (request.action) {
      case 'listWorkspaces': return items.map(item => item.workspace).sort((a, b) => a.created.localeCompare(b.created));
      case 'createWorkspace': {
        if (items.some(item => item.workspace.name.toLowerCase() === request.name.toLowerCase())) {
          throw new Error('A workspace with this name already exists.');
        }
        let directory: BrowserDirectoryHandle | undefined;
        if (request.backend === 'markdown') {
          directory = request.location ? this.chosenDirectories.get(request.location) : undefined;
          if (!directory) throw new Error('Markdown workspaces require a selected folder. Click Choose folder before creating the workspace.');
          if (await directory.queryPermission({ mode: 'readwrite' }) !== 'granted') throw new Error('Choose the folder again and grant read/write access.');
          for (const item of items) {
            if (!item.directory) continue;
            if (await directory.isSameEntry(item.directory)) throw new Error(`This folder is already registered as "${item.workspace.name}". Select that workspace; its folder access has been refreshed.`);
            if (await directory.resolve(item.directory) !== null || await item.directory.resolve(directory) !== null) {
              throw new Error('Workspace directories must not overlap. Select a separate folder.');
            }
          }
        } else if (request.location) throw new Error('SQLite PWA workspaces use Browser storage, not a local filesystem folder.');
        const workspace = workspaceSchema.parse({
          id: uuid(), name: request.name, backend: request.backend,
          location: directory?.name ?? 'Browser storage', created: new Date().toISOString(),
        });
        const item = { workspace, ...(directory ? { directory } : {}) };
        let state: StoredWorkspace | undefined;
        if (workspace.backend === 'sqlite') {
          const sql = await this.sqlRuntime();
          const database = new sql.Database();
          try { new SqliteBrowserRepository(database); state = { database: database.export(), assets: [] }; }
          finally { database.close(); }
        }
        const transaction = this.db.transaction(['registry', 'workspaces'], 'readwrite');
        const done = completed(transaction);
        transaction.objectStore('registry').add(item);
        if (state) transaction.objectStore('workspaces').add(state, workspace.id);
        await done;
        if (directory) {
          this.accessDirectories.set(workspace.id, directory);
          this.chosenDirectories.delete(request.location!);
        }
        return workspace;
      }
      case 'renameWorkspace': {
        if (items.some(item => item.workspace.id !== request.workspaceId && item.workspace.name.toLowerCase() === request.name.toLowerCase())) {
          throw new Error('A workspace with this name already exists.');
        }
        const item = await this.registration(request.workspaceId);
        const workspace = workspaceSchema.parse({ ...item.workspace, name: request.name });
        await this.saveRegistration({ ...item, workspace });
        return workspace;
      }
      case 'unregisterWorkspace': {
        await this.registration(request.workspaceId);
        const transaction = this.db.transaction('registry', 'readwrite');
        const done = completed(transaction);
        transaction.objectStore('registry').delete(request.workspaceId);
        await done;
        this.accessDirectories.delete(request.workspaceId);
        return { removed: true };
      }
      default: throw new Error('Invalid registry action.');
    }
  }
  private async repositoryRequest(
    workspace: Workspace, repository: Repository, request: Request,
    state?: StoredWorkspace, directory?: BrowserDirectoryHandle,
  ): Promise<unknown> {
    const assets = () => directory ? exportDirectoryAssets(directory) : Promise.resolve(state!.assets);
    switch (request.action) {
      case 'snapshot': return repository.snapshot();
      case 'conceptFolder': return editConceptFolders(repository, request.expected, request.command);
      case 'put': return repository.put(request.input, request.id, request.expectedRevision);
      case 'remove': return repository.remove(request.id, request.expectedRevision);
      case 'management': return new ManagementService(repository).execute(request.request);
      case 'export': return validateBackup({
        format: 'catpilot-workspace', version: 1, workspace, exported: new Date().toISOString(),
        records: (await repository.snapshot()).records, assets: await assets(),
      });
      case 'import': {
        if ((await repository.snapshot()).records.length || (await assets()).length) throw new Error('Import requires an empty destination workspace (records and assets).');
        await repository.restore(request.backup.records);
        state!.assets = request.backup.assets;
        return { count: request.backup.records.length, assets: request.backup.assets.length };
      }
      case 'addAsset': {
        const bytes = await assetBytes(request.asset);
        const current = await assets();
        await validateAssets([...current, request.asset]);
        if (directory) {
          const { parent, name } = await assetHandle(directory, request.asset.path, true);
          if (await optionalFile(parent, name)) throw new Error('An asset already exists at that path. Nothing was overwritten.');
          await writeFile(await parent.getFileHandle(name, { create: true }), bytes);
        } else state!.assets = [...current, request.asset];
        return `catpilot-asset:${request.asset.path}`;
      }
      case 'readAsset': {
        assetParts(request.path);
        if (directory) {
          const { parent, name } = await assetHandle(directory, request.path, false);
          const file = await (await parent.getFileHandle(name)).getFile();
          if (file.size > MAX_FILE_BYTES) throw new Error('Asset exceeds 20 MB.');
          return { data: new Uint8Array(await file.arrayBuffer()), mime: mimeType(request.path) };
        }
        const asset = state!.assets.find(asset => asset.path === request.path);
        if (!asset) throw new Error('Asset not found in this workspace.');
        return { data: await assetBytes(asset), mime: mimeType(asset.path) };
      }
      default: throw new Error('Unsupported workspace action.');
    }
  }
  close() { this.db.close(); }
}
