import { ConflictError, fieldsSchema, folderDomain, type FolderEdit, type RecordEntry, type Repository } from './types.js';
import type { FolderCommand } from './folder-command.js';

export const conceptKinds = ['knowledge', 'milestones', 'learning', 'growth'] as const;
export type ConceptKind = typeof conceptKinds[number];
export function isConcept(kind: string): kind is ConceptKind {
  return conceptKinds.some(value => value === kind);
}
export function isFolderRecord(record: RecordEntry) {
  return record.domain === folderDomain || isConcept(record.domain);
}
export function folderTrail(folder: string) {
  const parts = folder.split('/');
  return parts.every(part => part.trim() && part !== '.' && part !== '..') ? parts : folder ? [folder] : [];
}
export function folderParent(folder: string) {
  return folderTrail(folder).slice(0, -1).join('/');
}
export function inFolder(path: string, root: string) {
  return path === root || (folderTrail(path).length > folderTrail(root).length && path.startsWith(`${root}/`));
}
export function joinFolder(parent: string, name: string) {
  return parent ? `${parent}/${name}` : name;
}
export interface ConceptFolder { path: string; name: string; children: ConceptFolder[] }
export function conceptFolderTree(records: readonly RecordEntry[]): ConceptFolder[] {
  const children = new Map<string, Map<string, string>>();
  function add(parent: string, path: string, name: string) {
    if (!children.has(parent)) children.set(parent, new Map());
    children.get(parent)!.set(path, name);
  }
  for (const record of records) {
    if (!isFolderRecord(record)) continue;
    let parent = '';
    for (const name of folderTrail(record.fields.folder)) {
      const path = joinFolder(parent, name);
      add(parent, path, name);
      parent = path;
    }
  }
  const collator = new Intl.Collator(undefined, { sensitivity: 'base' });
  function nodes(parent: string): ConceptFolder[] {
    return [...children.get(parent) ?? []].sort(([a, first], [b, second]) =>
      collator.compare(first, second) || (a < b ? -1 : a === b ? 0 : 1))
      .map(([path, name]) => ({ path, name, children: nodes(path) }));
  }
  return nodes('');
}
export function flattenFolders(tree: ConceptFolder[]): string[] {
  return tree.flatMap(node => [node.path, ...flattenFolders(node.children)]);
}
export async function folderVersion(records: readonly RecordEntry[]) {
  const data = records.filter(isFolderRecord).map(record => `${record.id}:${record.revision}`).sort().join('\n');
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data)));
  return Array.from(hash, byte => byte.toString(16).padStart(2, '0')).join('');
}

function planFolders(records: RecordEntry[], command: FolderCommand): FolderEdit[] {
  const paths = flattenFolders(conceptFolderTree(records));
  const parent = command.type === 'delete' ? folderParent(command.path) : command.parent;
  if (parent && !paths.includes(parent)) throw new Error('That destination folder no longer exists.');
  const checkPath = (path: string) => {
    if (path.length > 200) throw new Error('The resulting folder path is too long. Use a shorter name or choose a shallower destination.');
    if (path && /(^|\/)(?:\.{1,2}|\s*)(?:\/|$)|[\\\x00-\x1f]/u.test(path)) {
      throw new Error('This legacy folder path cannot be nested. Choose another destination or remove the folder and keep its contents.');
    }
  };
  const collisionKey = (path: string) => path.normalize('NFC').toLowerCase();
  const marker = (path: string): RecordEntry => {
    const now = new Date().toISOString();
    return { domain: folderDomain, id: crypto.randomUUID(), title: folderTrail(path).at(-1) ?? path, body: '',
      fields: fieldsSchema.parse({ folder: path }), revision: crypto.randomUUID(), created: now, updated: now };
  };
  if (command.type === 'create') {
    if (/[/\\\x00-\x1f]/u.test(command.name) || command.name === '.' || command.name === '..') {
      throw new Error('Enter a folder name without slashes, dots-only names, or control characters.');
    }
    const path = joinFolder(parent, command.name);
    checkPath(path);
    if (paths.some(other => collisionKey(other) === collisionKey(path))) throw new Error('A folder with that name already exists here.');
    return [{ after: marker(path) }];
  }

  const source = command.path;
  if (!paths.includes(source)) throw new Error('That folder no longer exists.');
  if (command.type === 'move' && (parent && inFolder(parent, source))) throw new Error('A folder cannot be moved into itself or one of its subfolders.');
  if (command.type === 'move' && parent === folderParent(source)) return [];
  const keep = command.type === 'delete' && command.contents === 'keep';
  const destination = command.type === 'move' ? joinFolder(parent, folderTrail(source).at(-1)!) : parent;
  const remap = (path: string) => path === source ? destination : joinFolder(destination, path.slice(source.length + 1));
  const outside = new Set(paths.filter(path => !inFolder(path, source)).map(collisionKey));
  if (keep || command.type === 'move') {
    for (const path of paths.filter(path => inFolder(path, source))) {
      if (keep && path === source) continue;
      const next = remap(path);
      checkPath(next);
      if (outside.has(collisionKey(next))) throw new Error(`“${next}” already exists. Move the conflicting folder first.`);
    }
  }
  const edits: FolderEdit[] = [];
  for (const record of records) {
    if (!isFolderRecord(record) || !inFolder(record.fields.folder, source)) continue;
    if ((command.type === 'delete' && !keep) || (keep && record.domain === folderDomain && record.fields.folder === source)) {
      edits.push({ before: record });
    } else {
      edits.push({ before: record, after: { ...record, fields: { ...record.fields, folder: remap(record.fields.folder) },
        revision: crypto.randomUUID(), updated: new Date().toISOString() } });
    }
  }
  if (command.type === 'move' && !records.some(record => record.domain === folderDomain && record.fields.folder === source)) {
    edits.push({ after: marker(destination) });
  }
  // An implied legacy parent should not disappear just because its last child was moved or deleted.
  const oldParent = folderParent(source);
  if (oldParent && !records.some(record => isFolderRecord(record) && record.fields.folder === oldParent)) {
    edits.push({ after: marker(oldParent) });
  }
  return edits;
}

export async function editConceptFolders(repository: Repository, expected: string, command: FolderCommand) {
  return repository.changeFolders(async records => {
    if (await folderVersion(records) !== expected) throw new ConflictError();
    return planFolders(records, command);
  });
}
