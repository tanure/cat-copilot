import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export async function atomicWrite(file: string, text: string | Uint8Array): Promise<void> {
  const tmp = `${file}.${randomUUID()}.tmp`;
  const handle = await fs.open(tmp, 'wx', 0o600);
  try {
    try {
      await handle.writeFile(text, 'utf8');
      await handle.sync();
    } finally { await handle.close(); }
  } catch (error) {
    await fs.rm(tmp, { force: true });
    throw error;
  }
  try { await fs.rename(tmp, file); }
  catch (error) { await fs.rm(tmp, { force: true }); throw error; }
}

export async function withLock<T>(file: string, callback: () => Promise<T>): Promise<T> {
  const lock = `${file}.lock`;
  let handle;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { handle = await fs.open(lock, 'wx', 0o600); break; }
    catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }
  if (!handle) throw new Error(`Storage is locked: ${lock}. If a previous process crashed, close all CatPilot processes and remove this lock file.`);
  try {
    await handle.writeFile(String(process.pid));
    return await callback();
  } finally {
    await handle.close();
    await fs.unlink(lock);
  }
}

export function isWithin(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

export async function ensureRealDirectory(directory: string): Promise<string> {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const real = await fs.realpath(directory);
  await fs.access(real, fs.constants.R_OK | fs.constants.W_OK);
  return real;
}

export function missing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

export async function withWorkspaceWrite<T>(location: string, callback: () => Promise<T>): Promise<T> {
  return withLock(path.join(location, 'catpilot-transfer'), async () => {
    let pending = true;
    try { await fs.lstat(path.join(location, 'catpilot-import.json')); }
    catch (error) { if (missing(error)) pending = false; else throw error; }
    if (pending) throw new Error('An interrupted import is pending. Retry the original backup before editing this workspace.');
    return callback();
  });
}
