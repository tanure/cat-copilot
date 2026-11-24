import { z } from 'zod';
import { assetSchema, backupSchema, recordSchema, type Asset, type Backup, type RecordEntry } from '../../../packages/core/types.js';

export const MAX_BACKUP_BYTES = 250_000_000;
export const MAX_FILE_BYTES = 20_000_000;
export const MAX_ASSET_BYTES = 50_000_000;
export const MAX_FILES = 20_000;
const encoder = new TextEncoder();
export const utf8 = (text: string) => encoder.encode(text);
export async function digest(value: string | Uint8Array): Promise<string> {
  const bytes = typeof value === 'string' ? utf8(value) : value;
  const hash = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
export function assetParts(relative: string): string[] {
  if (!relative || relative.length > 1000) throw new Error('Invalid asset path.');
  const parts = relative.split('/');
  if (parts.length > 40 || parts.some(part => !part || part === '.' || part === '..' ||
    /[\\:<>"|?*\x00-\x1f]/.test(part) || /[ .]$/.test(part) ||
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) {
    throw new Error(`Nonportable or unsafe asset path: ${relative}`);
  }
  return parts;
}
export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 32_768) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
  }
  return btoa(binary);
}
export async function assetBytes(raw: Asset): Promise<Uint8Array> {
  const asset = assetSchema.parse(raw);
  assetParts(asset.path);
  let binary: string;
  try { binary = atob(asset.data); }
  catch { throw new Error(`Invalid base64 asset: ${asset.path}`); }
  if (binary.length > MAX_FILE_BYTES) throw new Error(`Asset exceeds 20 MB: ${asset.path}`);
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  if (toBase64(bytes) !== asset.data || await digest(bytes) !== asset.sha256) {
    throw new Error(`Invalid asset content or SHA-256 checksum: ${asset.path}`);
  }
  return bytes;
}
export async function validateAssets(assets: Asset[]): Promise<void> {
  if (assets.length > MAX_FILES) throw new Error('Assets exceed the 20,000 file transfer limit.');
  const names = new Set<string>();
  const segments = new Map<string, string>();
  let total = 0;
  for (const asset of assets) {
    const key = asset.path.normalize('NFC').toLowerCase();
    if (names.has(key)) throw new Error(`Asset filename case collision: ${asset.path}`);
    names.add(key);
    const parts = assetParts(asset.path);
    for (let depth = 1; depth <= parts.length; depth++) {
      const prefix = parts.slice(0, depth).join('/');
      const folded = prefix.normalize('NFC').toLowerCase();
      const previous = segments.get(folded);
      if (previous && previous !== prefix) throw new Error(`Asset directory case collision: ${prefix}`);
      segments.set(folded, prefix);
    }
    total += (await assetBytes(asset)).length;
    if (total > MAX_ASSET_BYTES) throw new Error('Assets exceed the 50 MB transfer limit.');
  }
  for (const name of names) {
    const parts = name.split('/');
    if (parts.some((_, index) => index > 0 && names.has(parts.slice(0, index).join('/')))) {
      throw new Error(`An asset is also used as a directory: ${name}`);
    }
  }
}
export async function validateBackup(raw: unknown): Promise<Backup> {
  if (utf8(JSON.stringify(raw)).length > MAX_BACKUP_BYTES) throw new Error('Backup exceeds the 250 MB limit.');
  const backup = backupSchema.parse(raw);
  if (backup.records.length + backup.assets.length > MAX_FILES) throw new Error('Backup exceeds the 20,000 file transfer limit.');
  if (new Set(backup.records.map(record => record.id.toLowerCase())).size !== backup.records.length) {
    throw new Error('Duplicate backup IDs (including filename case collisions).');
  }
  for (const record of backup.records) {
    if (utf8(serializeMarkdown(record)).length > MAX_FILE_BYTES) throw new Error(`Record exceeds 20 MB: ${record.id}`);
  }
  await validateAssets(backup.assets);
  return backup;
}
export function previewBackup(backup: Backup) {
  return {
    workspace: backup.workspace.name, count: backup.records.length, assets: backup.assets.length,
    domains: Object.fromEntries([...new Set(backup.records.map(record => record.domain))]
      .map(domain => [domain, backup.records.filter(record => record.domain === domain).length])),
    warning: 'Import only into an empty workspace. The source is not modified.',
  };
}
export function serializeMarkdown(record: RecordEntry, original: object = {}): string {
  const { body, revision: _revision, ...metadata } = record;
  return `---\ncatpilot: ${JSON.stringify({ ...original, ...metadata })}\n---\n${body}`;
}
export async function parseMarkdown(id: string, raw: string): Promise<{ record: RecordEntry; metadata: object }> {
  z.uuid().parse(id);
  const match = raw.match(/^---\r?\ncatpilot: ([^\r\n]+)\r?\n---\r?\n/);
  if (!match) throw new Error(`Invalid CatPilot metadata in ${id}.md. Source was not modified.`);
  const metadata: unknown = JSON.parse(match[1]);
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw new Error('Invalid record metadata.');
  const record = recordSchema.parse({ ...metadata, body: raw.slice(match[0].length), revision: await digest(raw) });
  if (record.id !== id) throw new Error('Record ID does not match its filename.');
  return { record, metadata };
}
export function mimeType(path: string): string {
  const types: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
    webp: 'image/webp', pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown',
  };
  return types[path.split('.').at(-1)?.toLowerCase() ?? ''] ?? 'application/octet-stream';
}
