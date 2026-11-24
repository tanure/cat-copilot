import { ConflictError, type FolderEdit, type RecordEntry } from './types.js';

interface FolderFiles {
  read(id: string): Promise<{ raw: string; revision: string } | undefined>;
  serialize(record: RecordEntry, previous?: string): Promise<string> | string;
  write(id: string, raw: string): Promise<void>;
  remove(id: string): Promise<void>;
}

export async function changeFolderFiles(edits: FolderEdit[], files: FolderFiles) {
  const changes = [];
  for (const { before, after } of edits) {
    const id = (before ?? after)!.id;
    const current = await files.read(id);
    if (current?.revision !== before?.revision) throw new ConflictError();
    changes.push({ id, before: current?.raw, after: after ? await files.serialize(after, current?.raw) : undefined });
  }
  const applied: typeof changes = [];
  try {
    for (const change of changes) {
      const { id, before, after } = change;
      if ((await files.read(id))?.raw !== before) throw new ConflictError();
      if (after === undefined) await files.remove(id);
      else await files.write(id, after);
      applied.push(change);
    }
  } catch (error) {
    const rollbackErrors: unknown[] = [];
    for (const change of applied.reverse()) {
      const { id, before, after } = change;
      try {
        if ((await files.read(id))?.raw !== after) throw new ConflictError();
        if (before === undefined) await files.remove(id);
        else await files.write(id, before);
      } catch (rollbackError) { rollbackErrors.push(rollbackError); }
    }
    if (rollbackErrors.length) throw new AggregateError([error, ...rollbackErrors], 'The folder change stopped and some Markdown writes could not be rolled back. Refresh the workspace and check the affected folder before retrying.');
    throw error;
  }
}
