import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { assetSchema, type Asset, type Workspace } from './types.js';
import { ensureRealDirectory, isWithin, missing, withWorkspaceWrite } from './files.js';

export const digest = (data: Uint8Array | string) => createHash('sha256').update(data).digest('hex');
export function assetParts(relative: string): string[] {
  const parts = relative.split('/');
  if (parts.some(part => !part || part === '.' || part === '..' || /[\\:<>"|?*\x00-\x1f]/.test(part) || /[ .]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw new Error(`Nonportable or unsafe asset path: ${relative}`);
  return parts;
}
export function assetBytes(asset: Asset): Buffer {
  assetSchema.parse(asset);
  assetParts(asset.path);
  const bytes = Buffer.from(asset.data, 'base64');
  if (bytes.length > 20_000_000 || bytes.toString('base64') !== asset.data || digest(bytes) !== asset.sha256) throw new Error(`Invalid asset content or checksum: ${asset.path}`);
  return bytes;
}
export function validateAssets(assets: Asset[]) {
  const names = new Set<string>();
  const segments = new Map<string, string>();
  let total = 0;
  if (assets.length > 20_000) throw new Error('Assets exceed the 20,000 file transfer limit.');
  for (const asset of assets) {
    const key = asset.path.normalize('NFC').toLowerCase();
    if (names.has(key)) throw new Error(`Asset filename case collision: ${asset.path}`);
    names.add(key);
    const parts = assetParts(asset.path);
    if (parts.length > 40) throw new Error('Asset directory nesting exceeds the transfer limit.');
    for (let depth = 1; depth <= parts.length; depth++) {
      const prefix = parts.slice(0, depth).join('/');
      const folded = prefix.normalize('NFC').toLowerCase();
      const previous = segments.get(folded);
      if (previous && previous !== prefix) throw new Error(`Asset directory case collision: ${prefix}`);
      segments.set(folded, prefix);
    }
    total += assetBytes(asset).length;
  }
  for (const name of names) {
    const parts = name.split('/');
    if (parts.some((_part, index) => index > 0 && names.has(parts.slice(0, index).join('/')))) throw new Error(`An asset is also used as a directory: ${name}`);
  }
  if (total > 50_000_000) throw new Error('Assets exceed the 50 MB transfer limit. Split the source into smaller workspaces.');
}
export async function collectFiles(root: string, excluded: string[] = []): Promise<Array<{ path: string; bytes: Buffer; modified: Date; created: Date }>> {
  const real = await fs.realpath(root);
  const files: Array<{ path: string; bytes: Buffer; modified: Date; created: Date }> = [];
  let size = 0;
  const walk = async (directory: string, prefix: string, depth: number) => {
    if (depth > 40) throw new Error('Directory nesting exceeds the import limit.');
    const directoryBefore = await fs.stat(directory);
    for (const entry of (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = prefix + entry.name;
      if (excluded.includes(entry.name) && (entry.isDirectory() || entry.name === '.git')) continue;
      assetParts(relative);
      const file = path.join(directory, entry.name);
      const before = await fs.lstat(file);
      if (before.isSymbolicLink() || !isWithin(real, await fs.realpath(file))) throw new Error(`Linked files/directories cannot be transferred: ${relative}`);
      if (before.isDirectory()) { await walk(file, relative + '/', depth + 1); continue; }
      if (!before.isFile()) throw new Error(`Unsupported filesystem entry: ${relative}`);
      size += before.size;
      if (before.size > 20_000_000 || size > 50_000_000 || files.length >= 20_000) throw new Error('Vault exceeds transfer limits (20 MB/file, 50 MB total, 20,000 files). Split the source first.');
      const bytes = await fs.readFile(file);
      const after = await fs.stat(file);
      if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ino !== after.ino || before.dev !== after.dev) throw new Error(`Source changed during preview: ${relative}. Retry after saving external edits.`);
      files.push({ path: relative, bytes, modified: before.mtime, created: before.birthtime });
    }
    if ((await fs.stat(directory)).mtimeMs !== directoryBefore.mtimeMs) throw new Error('Source directories changed during preview. Retry after saving external edits.');
  };
  await walk(real, '', 0);
  return files;
}
export async function exportAssets(workspace: Workspace): Promise<Asset[]> {
  const root = path.join(workspace.location, 'CatPilotAssets');
  let stat;
  try {
    stat = await fs.lstat(root);
  } catch (error) { if (missing(error)) return []; throw error; }
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('The asset directory must be an ordinary directory, not a symbolic link.');
  const assets = (await collectFiles(root)).map(file => ({ path: file.path, data: file.bytes.toString('base64'), sha256: digest(file.bytes) }));
  validateAssets(assets);
  return assets;
}
export async function stageAssets(workspace: Workspace, assets: Asset[]): Promise<string> {
  validateAssets(assets);
  const stage = path.join(workspace.location, `.catpilot-assets-${randomUUID()}`);
  await fs.mkdir(stage, { mode: 0o700 });
  try {
    for (const asset of assets) {
      const file = path.join(stage, ...assetParts(asset.path));
      await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
      await fs.writeFile(file, assetBytes(asset), { flag: 'wx', mode: 0o600 });
    }
    return stage;
  } catch (error) { await fs.rm(stage, { recursive: true, force: true }); throw error; }
}
export async function readAsset(workspace: Workspace, relative: string) {
  const root = path.join(workspace.location, 'CatPilotAssets');
  if ((await fs.lstat(root)).isSymbolicLink()) throw new Error('Linked asset directories are not supported.');
  let directory = root;
  for (const part of assetParts(relative)) {
    directory = path.join(directory, part);
    if ((await fs.lstat(directory)).isSymbolicLink()) throw new Error('Linked assets are not supported.');
  }
  if (!isWithin(await fs.realpath(root), await fs.realpath(directory))) throw new Error('Asset escapes the workspace.');
  const stat = await fs.stat(directory);
  if (!stat.isFile() || stat.size > 20_000_000) throw new Error('Invalid or oversized asset.');
  const types: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.pdf': 'application/pdf', '.txt': 'text/plain', '.md': 'text/markdown' };
  return { data: await fs.readFile(directory), mime: types[path.extname(relative).toLowerCase()] || 'application/octet-stream' };
}
export async function addAsset(workspace: Workspace, asset: Asset) {
  const bytes = assetBytes(asset);
  return withWorkspaceWrite(workspace.location, async () => {
    validateAssets([...(await exportAssets(workspace)), asset]);
    const root = path.join(workspace.location, 'CatPilotAssets');
    const real = await ensureRealDirectory(root);
    if (real !== path.join(await fs.realpath(workspace.location), 'CatPilotAssets')) throw new Error('The asset directory must not be linked.');
    let directory = root;
    const parts = assetParts(asset.path);
    for (const part of parts.slice(0, -1)) {
      directory = path.join(directory, part);
      await fs.mkdir(directory, { recursive: true, mode: 0o700 });
      if ((await fs.lstat(directory)).isSymbolicLink()) throw new Error('Linked asset directories are not supported.');
    }
    await fs.writeFile(path.join(directory, parts.at(-1)!), bytes, { flag: 'wx', mode: 0o600 });
    return `catpilot-asset:${asset.path}`;
  });
}
