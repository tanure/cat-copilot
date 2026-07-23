#!/usr/bin/env node

/**
 * CatPilot Knowledge Base — evolved memos.
 *
 * New documents live in a stable (non-partitioned) tree so folders + tags map
 * cleanly onto an Obsidian graph:
 *   <storage.root>/knowledge/<folder>/<slug>.md
 * with frontmatter: catpilot: memo, title, folder, tags[], created, updated.
 *
 * Legacy partitioned memos (<root>/<partition>/memos/*.md) remain fully
 * readable and are merged into list views under a virtual "Legacy" folder.
 * Editing a legacy memo migrates it into the knowledge tree.
 *
 * Every item is addressed by a POSIX `id` relative to storage.root WITHOUT the
 * `.md` extension, e.g. "knowledge/general/my-note" (new) or
 * "2026/2026-07/memos/2026-07-01_my-note" (legacy). This lets read/update/remove
 * resolve any item uniformly.
 */

import fs from 'fs';
import path from 'path';
import * as cliUtils from './cli-utils.js';
import { toFrontmatter, parseFrontmatter, slugify } from './domains.js';

const DEFAULT_FOLDER = 'General';
const LEGACY_FOLDER = 'Legacy';

function todayISO() {
  return new Date().toISOString().split('T')[0];
}

function storageRoot(config, projectRoot = process.cwd()) {
  const base = config.__baseDir || projectRoot;
  return path.resolve(base, config.storage.root);
}

function knowledgeRoot(config, projectRoot = process.cwd()) {
  return cliUtils.resolveStableDir('knowledge', config, projectRoot);
}

function toPosix(p) {
  return p.split(path.sep).join('/');
}

// id (relative to storageRoot, no extension) -> absolute .md path
function idToPath(id, config, projectRoot = process.cwd()) {
  const root = storageRoot(config, projectRoot);
  const clean = String(id).replace(/\\/g, '/').replace(/\.md$/i, '');
  const abs = path.resolve(root, clean + '.md');
  if (!abs.startsWith(path.resolve(root))) throw new Error('Invalid knowledge id');
  return abs;
}

function pathToId(absPath, config, projectRoot = process.cwd()) {
  const root = storageRoot(config, projectRoot);
  return toPosix(path.relative(root, absPath)).replace(/\.md$/i, '');
}

function isLegacyId(id) {
  return !String(id).replace(/\\/g, '/').startsWith('knowledge/');
}

function readDoc(absPath, config, projectRoot = process.cwd()) {
  const content = fs.readFileSync(absPath, 'utf8');
  const fm = parseFrontmatter(content);
  const id = pathToId(absPath, config, projectRoot);
  const legacy = isLegacyId(id);
  const rel = legacy ? '' : toPosix(path.relative(knowledgeRoot(config, projectRoot), absPath));
  const folder = fm.folder || (legacy ? LEGACY_FOLDER : (rel.includes('/') ? rel.split('/').slice(0, -1).join('/') : DEFAULT_FOLDER));
  const tags = Array.isArray(fm.tags) ? fm.tags : (fm.tags ? [fm.tags] : []);
  const title = fm.title || path.basename(absPath, '.md').replace(/^\d{4}-\d{2}-\d{2}_/, '');
  const stat = (() => { try { return fs.statSync(absPath); } catch { return null; } })();
  return {
    id,
    title,
    folder,
    tags,
    legacy,
    created: fm.created || fm.date || (stat ? stat.birthtime.toISOString().split('T')[0] : ''),
    updated: fm.updated || (stat ? stat.mtime.toISOString().split('T')[0] : ''),
    path: absPath,
    frontmatter: fm,
  };
}

/** Body (markdown after frontmatter). Falls back to legacy `# title\n\n` shape. */
function docBody(absPath) {
  const content = fs.readFileSync(absPath, 'utf8');
  if (/^---\n[\s\S]*?\n---/.test(content)) {
    return content.replace(/^---\n[\s\S]*?\n---\n?/, '').replace(/^\s*#\s+.*\n?/, '').trim();
  }
  // Legacy memo: "# Title\n\n<body>"
  const lines = content.split('\n');
  if (lines[0] && lines[0].startsWith('# ')) {
    return lines.slice(1).join('\n').trim();
  }
  return content.trim();
}

/** Collect legacy partitioned memo dirs and their notes. */
function listLegacyMemos(config, projectRoot = process.cwd()) {
  const root = storageRoot(config, projectRoot);
  const memoDirName = (config.storage.files && config.storage.files.memos) || 'memos';
  const dirs = cliUtils.walkFind(root, memoDirName, true);
  const out = [];
  for (const dir of dirs) {
    // Skip the new knowledge tree if it happened to match.
    if (toPosix(dir).includes('/knowledge/')) continue;
    let files = [];
    try { files = fs.readdirSync(dir).filter(f => f.endsWith('.md')); } catch { continue; }
    for (const f of files) {
      try { out.push(readDoc(path.join(dir, f), config, projectRoot)); } catch { /* ignore */ }
    }
  }
  return out;
}

/** List all knowledge docs (new tree + legacy), newest first. */
function listDocs(filter = {}, projectRoot = process.cwd()) {
  const config = cliUtils.loadConfig(projectRoot);
  const kroot = knowledgeRoot(config, projectRoot);
  const docs = [];

  // New tree (recursive)
  const walk = (dir) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith('.md')) {
        try { docs.push(readDoc(full, config, projectRoot)); } catch { /* ignore */ }
      }
    }
  };
  walk(kroot);

  // Legacy memos
  docs.push(...listLegacyMemos(config, projectRoot));

  let result = docs;
  if (filter.folder) result = result.filter(d => (d.folder || '').toLowerCase() === String(filter.folder).toLowerCase());
  if (filter.tag) result = result.filter(d => d.tags.map(t => t.toLowerCase()).includes(String(filter.tag).toLowerCase()));
  if (filter.q) {
    const q = String(filter.q).toLowerCase();
    result = result.filter(d => d.title.toLowerCase().includes(q) || d.tags.join(' ').toLowerCase().includes(q));
  }
  result.sort((a, b) => String(b.updated || b.created).localeCompare(String(a.updated || a.created)));
  return result;
}

/** Folder statistics: [{ folder, count }] sorted by count desc. */
function listFolders(projectRoot = process.cwd()) {
  const docs = listDocs({}, projectRoot);
  const counts = {};
  for (const d of docs) counts[d.folder] = (counts[d.folder] || 0) + 1;
  return Object.entries(counts).map(([folder, count]) => ({ folder, count }))
    .sort((a, b) => b.count - a.count || a.folder.localeCompare(b.folder));
}

/** All tags with counts. */
function listTags(projectRoot = process.cwd()) {
  const docs = listDocs({}, projectRoot);
  const counts = {};
  for (const d of docs) for (const t of d.tags) counts[t] = (counts[t] || 0) + 1;
  return Object.entries(counts).map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

function normTags(tags) {
  if (Array.isArray(tags)) return tags.map(t => String(t).trim()).filter(Boolean);
  if (typeof tags === 'string') return tags.split(',').map(t => t.trim()).filter(Boolean);
  return [];
}

function writeDoc(absPath, fm, body) {
  cliUtils.ensureDir(path.dirname(absPath));
  const content = `${toFrontmatter(fm)}\n\n# ${fm.title}\n\n${(body || '').trim()}\n`;
  fs.writeFileSync(absPath, content, 'utf8');
}

/** Create a knowledge doc. Returns the created doc descriptor. */
function addDoc(params = {}, projectRoot = process.cwd()) {
  if (!params.title) throw new Error('title is required');
  const config = cliUtils.loadConfig(projectRoot);
  const folder = (params.folder && String(params.folder).trim()) || DEFAULT_FOLDER;
  const kroot = knowledgeRoot(config, projectRoot);
  const folderDir = path.join(kroot, folder.split('/').map(slugify).join(path.sep));
  cliUtils.ensureDir(folderDir);
  let filePath = path.join(folderDir, `${slugify(params.title)}.md`);
  // Avoid clobbering an existing file
  if (fs.existsSync(filePath)) filePath = path.join(folderDir, `${slugify(params.title)}-${Date.now().toString(36)}.md`);

  const fm = {
    catpilot: 'memo',
    title: params.title,
    folder,
    tags: normTags(params.tags),
    created: todayISO(),
    updated: todayISO(),
  };
  writeDoc(filePath, fm, params.body || '');
  return readDoc(filePath, config, projectRoot);
}

/** Read a doc (with body) by id. */
function readById(id, projectRoot = process.cwd()) {
  const config = cliUtils.loadConfig(projectRoot);
  const abs = idToPath(id, config, projectRoot);
  if (!fs.existsSync(abs)) throw new Error(`Knowledge doc not found: ${id}`);
  const doc = readDoc(abs, config, projectRoot);
  doc.body = docBody(abs);
  return doc;
}

/**
 * Update a doc. Editing a legacy memo migrates it into the knowledge tree
 * (writes the new file, deletes the old one).
 */
function updateDoc(id, patch = {}, projectRoot = process.cwd()) {
  const config = cliUtils.loadConfig(projectRoot);
  const abs = idToPath(id, config, projectRoot);
  if (!fs.existsSync(abs)) throw new Error(`Knowledge doc not found: ${id}`);
  const current = readDoc(abs, config, projectRoot);
  const body = patch.body !== undefined ? patch.body : docBody(abs);
  const title = patch.title !== undefined ? patch.title : current.title;
  const folder = patch.folder !== undefined ? (String(patch.folder).trim() || DEFAULT_FOLDER) : (current.legacy ? DEFAULT_FOLDER : current.folder);
  const tags = patch.tags !== undefined ? normTags(patch.tags) : current.tags;

  const fm = {
    catpilot: 'memo',
    title,
    folder,
    tags,
    created: current.created || todayISO(),
    updated: todayISO(),
  };

  const kroot = knowledgeRoot(config, projectRoot);
  const folderDir = path.join(kroot, folder.split('/').map(slugify).join(path.sep));
  const migrating = current.legacy || (patch.folder !== undefined && folder !== current.folder) || (patch.title !== undefined && slugify(title) !== path.basename(abs, '.md'));

  if (migrating) {
    cliUtils.ensureDir(folderDir);
    let dest = path.join(folderDir, `${slugify(title)}.md`);
    if (fs.existsSync(dest) && path.resolve(dest) !== path.resolve(abs)) {
      dest = path.join(folderDir, `${slugify(title)}-${Date.now().toString(36)}.md`);
    }
    writeDoc(dest, fm, body);
    if (path.resolve(dest) !== path.resolve(abs)) { try { fs.unlinkSync(abs); } catch { /* ignore */ } }
    return readById(pathToId(dest, config, projectRoot), projectRoot);
  }

  writeDoc(abs, fm, body);
  return readById(id, projectRoot);
}

/** Move a doc to a different folder. */
function moveDoc(id, folder, projectRoot = process.cwd()) {
  return updateDoc(id, { folder }, projectRoot);
}

/** Remove a doc by id. */
function removeDoc(id, projectRoot = process.cwd()) {
  const config = cliUtils.loadConfig(projectRoot);
  const abs = idToPath(id, config, projectRoot);
  if (!fs.existsSync(abs)) throw new Error(`Knowledge doc not found: ${id}`);
  const doc = readDoc(abs, config, projectRoot);
  fs.unlinkSync(abs);
  return doc;
}

export {
  DEFAULT_FOLDER,
  LEGACY_FOLDER,
  listDocs,
  listFolders,
  listTags,
  addDoc,
  readById,
  updateDoc,
  moveDoc,
  removeDoc,
};
