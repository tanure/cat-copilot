import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { atomicWrite, missing, withLock } from './files.js';
import { digest, exportAssets, stageAssets, validateAssets } from './assets.js';
import { type Backup, type RecordEntry, type Repository, type Workspace } from './types.js';

const journalSchema = z.object({
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  stage: z.string().regex(/^\.catpilot-assets-[a-f0-9-]{36}$/),
});
const normalized = (records: RecordEntry[]) => JSON.stringify(records.map(({ revision: _revision, ...record }) => record).sort((a, b) => a.id.localeCompare(b.id)));

export async function restoreWorkspace(workspace: Workspace, repository: Repository, backup: Backup) {
  validateAssets(backup.assets);
  if (new Set(backup.records.map(record => record.id.toLowerCase())).size !== backup.records.length) throw new Error('Duplicate backup IDs (including filename case collisions).');
  const expected = normalized(backup.records);
  const fingerprint = digest(expected + JSON.stringify(backup.assets));
  const journalFile = path.join(workspace.location, 'catpilot-import.json');
  return withLock(path.join(workspace.location, 'catpilot-transfer'), async () => {
    let journal: z.infer<typeof journalSchema> | undefined;
    try { journal = journalSchema.parse(JSON.parse(await fs.readFile(journalFile, 'utf8'))); }
    catch (error) { if (!missing(error)) throw error; }
    const records = (await repository.snapshot()).records;
    if (journal && journal.digest !== fingerprint) throw new Error('An interrupted import exists. Retry its original backup before importing different data.');
    if (!journal) {
      if (records.length || (await exportAssets(workspace)).length) throw new Error('Import requires an empty destination workspace.');
      const stage = await stageAssets(workspace, backup.assets);
      journal = { digest: fingerprint, stage: path.basename(stage) };
      try { await atomicWrite(journalFile, JSON.stringify(journal)); }
      catch (error) { await fs.rm(stage, { recursive: true, force: true }); throw error; }
    }
    try {
      if (normalized(records) !== expected) {
        if (records.length) throw new Error('Destination records changed during import. The source is unchanged; retain the import journal for recovery.');
        await repository.restore(backup.records);
      }
      if (normalized((await repository.snapshot()).records) !== expected) throw new Error('Import record verification failed. Retain the journal and retry the same backup.');
      const stage = path.join(workspace.location, journal.stage);
      const destination = path.join(workspace.location, 'CatPilotAssets');
      let staged = true;
      try { await fs.lstat(stage); }
      catch (error) { if (missing(error)) staged = false; else throw error; }
      if (staged) {
        const stat = await fs.lstat(stage);
        if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Import staging directory is invalid or linked.');
        try { await fs.rmdir(destination); }
        catch (error) { if (!missing(error)) throw error; }
        await fs.rename(stage, destination);
      }
      const assets = await exportAssets(workspace);
      const assetSignature = (items: typeof assets) => JSON.stringify(items.map(({ path, sha256 }) => ({ path, sha256 })).sort((a, b) => a.path.localeCompare(b.path)));
      if (assetSignature(assets) !== assetSignature(backup.assets)) throw new Error('Import asset verification failed. Retain the journal and retry the original backup.');
      await fs.unlink(journalFile);
      return { count: backup.records.length, assets: assets.length };
    } catch (error) {
      throw new Error(`Import incomplete. Source is unchanged. Keep the import journal and staged files. Retry the same backup if the destination and staging are unchanged; otherwise import into a new empty workspace and retain this copy for recovery. ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
  });
}
