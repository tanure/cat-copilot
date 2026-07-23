#!/usr/bin/env node

/**
 * CatPilot Projects — goal-oriented containers with plans and sub-items.
 *
 *   <storage.root>/projects/<slug>/index.md          catpilot: project
 *   <storage.root>/projects/<slug>/items/<slug>.md   catpilot: project-item
 *
 * Project frontmatter: title, status, start, due, owner, tags[], summary, created, updated.
 * Item frontmatter: project (slug), type (task|milestone|requirement), status, title, due, order.
 *
 * readProject() rolls up: sub-items grouped by type, main tasks linked via their
 * `project` field, linked achievements, and a derived progress percentage.
 * Legacy flat project notes are merged into the portfolio list.
 */

import fs from 'fs';
import path from 'path';
import * as cliUtils from './cli-utils.js';
import { toFrontmatter, parseFrontmatter, slugify } from './domains.js';
import { addAchievement, listAchievements } from './achievements.js';

const ITEM_TYPES = ['requirement', 'task', 'milestone'];

function todayISO() { return new Date().toISOString().split('T')[0]; }

// Shared step/item progress helpers (mirror catpilot-store.mjs)
function clampPct(v) { const n = parseInt(v, 10); return isNaN(n) ? 0 : Math.max(0, Math.min(100, n)); }
function statusFromPct(p, zero) { return p >= 100 ? 'Done' : p > 0 ? 'In Progress' : zero; }
function childProgress(fm) {
  if (fm.progress !== undefined && fm.progress !== '') return clampPct(fm.progress);
  return String(fm.status || '').toLowerCase() === 'done' ? 100 : 0;
}
function noteBodyOf(content) {
  return content.replace(/^---\n[\s\S]*?\n---\n?/, '').replace(/^\s*#\s+.*\n?/, '').trim();
}
function resolveProgressStatus({ curProgress = 0, curStatus, patchProgress, patchStatus, zero = 'Open' }) {
  let progress = curProgress;
  let status = curStatus || zero;
  const hasP = patchProgress !== undefined && patchProgress !== null && patchProgress !== '';
  const hasS = patchStatus !== undefined && patchStatus !== null && patchStatus !== '';
  if (hasP) {
    progress = clampPct(patchProgress);
    status = hasS ? patchStatus : statusFromPct(progress, zero);
  } else if (hasS) {
    status = patchStatus;
    const k = String(patchStatus).toLowerCase().replace(/\s/g, '');
    if (k === 'done') progress = 100;
    else if (k === 'inprogress' || k === 'blocked') progress = curProgress > 0 && curProgress < 100 ? curProgress : (curProgress >= 100 ? 99 : 50);
    else progress = 0;
  }
  return { progress, status };
}

function root(config, projectRoot = process.cwd()) {
  return cliUtils.resolveStableDir('projects', config, projectRoot);
}

function normTags(tags) {
  if (Array.isArray(tags)) return tags.map(t => String(t).trim()).filter(Boolean);
  if (typeof tags === 'string') return tags.split(',').map(t => t.trim()).filter(Boolean);
  return [];
}

function projDir(slug, config, projectRoot) {
  const dir = path.join(root(config, projectRoot), slug);
  if (!dir.startsWith(root(config, projectRoot))) throw new Error('Invalid project slug');
  return dir;
}

function readIndex(slug, config, projectRoot) {
  const idx = path.join(projDir(slug, config, projectRoot), 'index.md');
  if (!fs.existsSync(idx)) return null;
  const content = fs.readFileSync(idx, 'utf8');
  const fm = parseFrontmatter(content);
  const body = content.replace(/^---\n[\s\S]*?\n---\n?/, '').replace(/^\s*#\s+.*\n?/, '').trim();
  return { slug, path: idx, fm, body };
}

function listItems(slug, config, projectRoot) {
  const dir = path.join(projDir(slug, config, projectRoot), 'items');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith('.md')).map(f => {
    const content = fs.readFileSync(path.join(dir, f), 'utf8');
    const fm = parseFrontmatter(content);
    const progress = childProgress(fm);
    return {
      id: f.replace(/\.md$/, ''),
      type: ITEM_TYPES.includes((fm.type || '').toLowerCase()) ? fm.type.toLowerCase() : 'task',
      title: fm.title || f.replace(/\.md$/, ''),
      status: fm.status || statusFromPct(progress, 'Open'),
      progress,
      due: fm.due || '',
      notes: noteBodyOf(content),
      order: parseInt(fm.order, 10) || 0,
    };
  }).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

/** Main tasks linked to this project via their `project` field. */
function linkedTasks(slug, config) {
  try {
    const p = cliUtils.resolveFilePath('tasks', config);
    const tasks = cliUtils.parseTasksTable(cliUtils.readFileOrCreate(p));
    return tasks.filter(t => (t.project || '').toLowerCase() === slug.toLowerCase());
  } catch { return []; }
}

function computeProgress(items, tasks) {
  // Requirements describe scope (not progress). Progress = avg of task/milestone
  // item progress plus linked main tasks (done=100 else 0).
  const parts = [
    ...items.filter(i => i.type === 'task' || i.type === 'milestone').map(i => childProgress(i)),
    ...tasks.map(t => (String(t.status).toLowerCase() === 'done' ? 100 : 0)),
  ];
  if (!parts.length) return 0;
  return Math.round(parts.reduce((a, p) => a + p, 0) / parts.length);
}

function toSummary(idx, items, tasks) {
  return {
    slug: idx.slug,
    legacy: false,
    title: idx.fm.title || idx.slug,
    status: idx.fm.status || 'Active',
    start: idx.fm.start || '',
    due: idx.fm.due || '',
    owner: idx.fm.owner || '',
    summary: idx.fm.summary || '',
    tags: Array.isArray(idx.fm.tags) ? idx.fm.tags : (idx.fm.tags ? [idx.fm.tags] : []),
    itemCount: items.length,
    taskCount: tasks.length,
    progress: computeProgress(items, tasks),
    path: idx.path,
  };
}

function listLegacy(config, projectRoot) {
  const base = config.__baseDir || projectRoot;
  const storageRoot = path.resolve(base, config.storage.root);
  const dirName = (config.storage.files && config.storage.files.projects) || 'projects';
  const dirs = cliUtils.walkFind(storageRoot, dirName, true).filter(d => path.resolve(d) !== path.resolve(root(config, projectRoot)));
  const out = [];
  for (const dir of dirs) {
    let files = [];
    try { files = fs.readdirSync(dir).filter(f => f.endsWith('.md')); } catch { continue; }
    for (const f of files) {
      try {
        const fm = parseFrontmatter(fs.readFileSync(path.join(dir, f), 'utf8'));
        out.push({
          slug: 'legacy:' + f.replace(/\.md$/, ''),
          legacy: true,
          title: fm.title || f.replace(/\.md$/, ''),
          status: fm.status || '',
          start: fm.start || '', due: fm.due || '', owner: fm.owner || '',
          summary: fm.summary || '',
          tags: Array.isArray(fm.tags) ? fm.tags : (fm.tags ? [fm.tags] : []),
          itemCount: 0, taskCount: 0, progress: String(fm.status || '').toLowerCase() === 'done' ? 100 : 0,
          path: path.join(dir, f),
        });
      } catch { /* ignore */ }
    }
  }
  return out;
}

/** Portfolio list (new tree + legacy). */
function listProjects(filter = {}, projectRoot = process.cwd()) {
  const config = cliUtils.loadConfig(projectRoot);
  const r = root(config, projectRoot);
  const out = [];
  if (fs.existsSync(r)) {
    for (const entry of fs.readdirSync(r, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const idx = readIndex(entry.name, config, projectRoot);
      if (!idx) continue;
      out.push(toSummary(idx, listItems(entry.name, config, projectRoot), linkedTasks(entry.name, config)));
    }
  }
  out.push(...listLegacy(config, projectRoot));
  let result = out;
  if (filter.status) result = result.filter(p => (p.status || '').toLowerCase() === String(filter.status).toLowerCase());
  result.sort((a, b) => a.title.localeCompare(b.title));
  return result;
}

/** Read one project with full dashboard rollup. */
function readProject(slug, projectRoot = process.cwd()) {
  const config = cliUtils.loadConfig(projectRoot);
  const idx = readIndex(slug, config, projectRoot);
  if (!idx) throw new Error(`Project not found: ${slug}`);
  const items = listItems(slug, config, projectRoot);
  const tasks = linkedTasks(slug, config);
  let achievements = [];
  try { achievements = listAchievements({ sourceType: 'project', source: slug }, projectRoot); } catch { /* ignore */ }
  return {
    ...toSummary(idx, items, tasks),
    body: idx.body,
    requirements: items.filter(i => i.type === 'requirement'),
    milestones: items.filter(i => i.type === 'milestone'),
    tasks: items.filter(i => i.type === 'task'),
    linkedTasks: tasks,
    achievements,
  };
}

/** Create a project. */
function addProject(params = {}, projectRoot = process.cwd()) {
  if (!params.title) throw new Error('title is required');
  const config = cliUtils.loadConfig(projectRoot);
  let slug = slugify(params.title);
  const r = root(config, projectRoot);
  cliUtils.ensureDir(r);
  if (fs.existsSync(path.join(r, slug))) slug = `${slug}-${Date.now().toString(36)}`;
  const dir = path.join(r, slug);
  cliUtils.ensureDir(dir);
  const fm = {
    catpilot: 'project',
    title: params.title,
    status: params.status || 'Active',
    start: params.start || todayISO(),
    due: params.due || '',
    owner: params.owner || '',
    summary: params.summary || '',
    tags: normTags(params.tags),
    created: todayISO(),
    updated: todayISO(),
  };
  fs.writeFileSync(path.join(dir, 'index.md'), `${toFrontmatter(fm)}\n\n# ${params.title}\n\n${(params.body || params.summary || '').trim()}\n`, 'utf8');
  return readProject(slug, projectRoot);
}

/** Update project index. */
function updateProject(slug, patch = {}, projectRoot = process.cwd()) {
  const config = cliUtils.loadConfig(projectRoot);
  const idx = readIndex(slug, config, projectRoot);
  if (!idx) throw new Error(`Project not found: ${slug}`);
  const fm = { ...idx.fm, catpilot: 'project', updated: todayISO() };
  for (const k of ['title', 'status', 'start', 'due', 'owner', 'summary']) if (patch[k] !== undefined) fm[k] = patch[k];
  if (patch.tags !== undefined) fm.tags = normTags(patch.tags);
  const body = patch.body !== undefined ? patch.body : idx.body;
  fs.writeFileSync(idx.path, `${toFrontmatter(fm)}\n\n# ${fm.title || slug}\n\n${(body || '').trim()}\n`, 'utf8');
  return readProject(slug, projectRoot);
}

/** Add a sub-item (requirement | task | milestone). */
function addItem(slug, params = {}, projectRoot = process.cwd()) {
  if (!params.title) throw new Error('item title is required');
  const config = cliUtils.loadConfig(projectRoot);
  if (!readIndex(slug, config, projectRoot)) throw new Error(`Project not found: ${slug}`);
  const type = ITEM_TYPES.includes((params.type || '').toLowerCase()) ? params.type.toLowerCase() : 'task';
  const dir = path.join(projDir(slug, config, projectRoot), 'items');
  cliUtils.ensureDir(dir);
  const existing = listItems(slug, config, projectRoot);
  const order = params.order !== undefined ? parseInt(params.order, 10) : (existing.length + 1);
  let id = slugify(params.title);
  if (fs.existsSync(path.join(dir, id + '.md'))) id = `${id}-${Date.now().toString(36)}`;
  const { progress, status } = resolveProgressStatus({ patchProgress: params.progress, patchStatus: params.status, zero: 'Open' });
  const fm = { catpilot: 'project-item', project: slug, type, title: params.title, status, progress, due: params.due || '', order };
  const notes = (params.notes !== undefined ? params.notes : params.body) || '';
  fs.writeFileSync(path.join(dir, id + '.md'), `${toFrontmatter(fm)}\n\n# ${params.title}\n\n${String(notes).trim()}\n`, 'utf8');
  return readProject(slug, projectRoot);
}

/** Update a sub-item (status, progress, due, notes, type, title, order). */
function updateItem(slug, itemId, patch = {}, projectRoot = process.cwd()) {
  const config = cliUtils.loadConfig(projectRoot);
  const file = path.join(projDir(slug, config, projectRoot), 'items', path.basename(itemId) + '.md');
  if (!fs.existsSync(file)) throw new Error(`Item not found: ${itemId}`);
  const content = fs.readFileSync(file, 'utf8');
  const fm = parseFrontmatter(content);
  fm.catpilot = 'project-item'; fm.project = slug;
  if (patch.type !== undefined) fm.type = patch.type;
  if (patch.title !== undefined) fm.title = patch.title;
  if (patch.due !== undefined) fm.due = patch.due;
  if (patch.order !== undefined) fm.order = parseInt(patch.order, 10);
  const cur = resolveProgressStatus({ curProgress: childProgress(fm), curStatus: fm.status, patchProgress: patch.progress, patchStatus: patch.status, zero: 'Open' });
  fm.progress = cur.progress; fm.status = cur.status;
  const body = (patch.notes !== undefined ? patch.notes : (patch.body !== undefined ? patch.body : noteBodyOf(content))) || '';
  fs.writeFileSync(file, `${toFrontmatter(fm)}\n\n# ${fm.title}\n\n${String(body).trim()}\n`, 'utf8');
  return readProject(slug, projectRoot);
}

/** Remove a sub-item. */
function removeItem(slug, itemId, projectRoot = process.cwd()) {
  const config = cliUtils.loadConfig(projectRoot);
  const file = path.join(projDir(slug, config, projectRoot), 'items', path.basename(itemId) + '.md');
  if (!fs.existsSync(file)) throw new Error(`Item not found: ${itemId}`);
  fs.unlinkSync(file);
  return readProject(slug, projectRoot);
}

/** Mark a project complete and record an achievement. */
function completeProject(slug, projectRoot = process.cwd()) {
  const config = cliUtils.loadConfig(projectRoot);
  const idx = readIndex(slug, config, projectRoot);
  if (!idx) throw new Error(`Project not found: ${slug}`);
  updateProject(slug, { status: 'Done' }, projectRoot);
  try {
    addAchievement({ title: `Completed project: ${idx.fm.title || slug}`, sourceType: 'project', source: slug, tags: Array.isArray(idx.fm.tags) ? idx.fm.tags : [] }, projectRoot);
  } catch { /* best effort */ }
  return readProject(slug, projectRoot);
}

/** Remove a project tree. */
function removeProject(slug, projectRoot = process.cwd()) {
  const config = cliUtils.loadConfig(projectRoot);
  const dir = projDir(slug, config, projectRoot);
  if (!fs.existsSync(dir)) throw new Error(`Project not found: ${slug}`);
  fs.rmSync(dir, { recursive: true, force: true });
  return { slug, removed: true };
}

export {
  ITEM_TYPES,
  listProjects, readProject, addProject, updateProject, removeProject,
  addItem, updateItem, removeItem, completeProject,
};
