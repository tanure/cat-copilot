#!/usr/bin/env node

/**
 * CatPilot Learning paths — goal/certification study plans with ordered steps.
 *
 *   <storage.root>/learning/<slug>/index.md          catpilot: learning
 *   <storage.root>/learning/<slug>/steps/<slug>.md   catpilot: learning-step
 *
 * Path frontmatter: title, goal, status, target_date, next_review, tags[], created, updated.
 * Step frontmatter: learning (parent slug), title, status (Todo|Done), order.
 * Progress is DERIVED from step completion. Completing a path records an achievement.
 *
 * Legacy flat learning notes (<root>/<partition>/learning/*.md) are merged into
 * list views (flagged legacy) so nothing is lost.
 */

import fs from 'fs';
import path from 'path';
import * as cliUtils from './cli-utils.js';
import { toFrontmatter, parseFrontmatter, slugify } from './domains.js';
import { addAchievement } from './achievements.js';

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
function resolveProgressStatus({ curProgress = 0, curStatus, patchProgress, patchStatus, zero = 'Todo' }) {
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
  return cliUtils.resolveStableDir('learning', config, projectRoot);
}

function normTags(tags) {
  if (Array.isArray(tags)) return tags.map(t => String(t).trim()).filter(Boolean);
  if (typeof tags === 'string') return tags.split(',').map(t => t.trim()).filter(Boolean);
  return [];
}

function pathDir(slug, config, projectRoot) {
  const dir = path.join(root(config, projectRoot), slug);
  if (!dir.startsWith(root(config, projectRoot))) throw new Error('Invalid learning slug');
  return dir;
}

function readIndex(slug, config, projectRoot) {
  const idx = path.join(pathDir(slug, config, projectRoot), 'index.md');
  if (!fs.existsSync(idx)) return null;
  const content = fs.readFileSync(idx, 'utf8');
  const fm = parseFrontmatter(content);
  const body = content.replace(/^---\n[\s\S]*?\n---\n?/, '').replace(/^\s*#\s+.*\n?/, '').trim();
  return { slug, path: idx, fm, body };
}

function listSteps(slug, config, projectRoot) {
  const dir = path.join(pathDir(slug, config, projectRoot), 'steps');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith('.md')).map(f => {
    const content = fs.readFileSync(path.join(dir, f), 'utf8');
    const fm = parseFrontmatter(content);
    const progress = childProgress(fm);
    return {
      id: f.replace(/\.md$/, ''),
      title: fm.title || f.replace(/\.md$/, ''),
      status: fm.status || statusFromPct(progress, 'Todo'),
      progress,
      due: fm.due || '',
      notes: noteBodyOf(content),
      order: parseInt(fm.order, 10) || 0,
    };
  }).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

function computeProgress(steps, fm) {
  if (steps.length) {
    return Math.round(steps.reduce((a, s) => a + childProgress(s), 0) / steps.length);
  }
  return String(fm.status || '').toLowerCase() === 'done' ? 100 : (parseInt(fm.progress, 10) || 0);
}

function toPathSummary(idx, steps) {
  const progress = computeProgress(steps, idx.fm);
  return {
    slug: idx.slug,
    legacy: false,
    title: idx.fm.title || idx.slug,
    goal: idx.fm.goal || '',
    status: idx.fm.status || 'In Progress',
    progress,
    targetDate: idx.fm.target_date || '',
    nextReview: idx.fm.next_review || '',
    tags: Array.isArray(idx.fm.tags) ? idx.fm.tags : (idx.fm.tags ? [idx.fm.tags] : []),
    stepCount: steps.length,
    doneCount: steps.filter(s => childProgress(s) >= 100).length,
    path: idx.path,
  };
}

/** Legacy flat learning notes, flagged legacy. */
function listLegacy(config, projectRoot) {
  const base = config.__baseDir || projectRoot;
  const storageRoot = path.resolve(base, config.storage.root);
  const dirName = (config.storage.files && config.storage.files.learning) || 'learning';
  const dirs = cliUtils.walkFind(storageRoot, dirName, true).filter(d => {
    // exclude the new stable tree (which has slug subdirs, not flat .md files)
    return path.resolve(d) !== path.resolve(root(config, projectRoot));
  });
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
          goal: fm.goal || '',
          status: fm.status || '',
          progress: String(fm.status || '').toLowerCase() === 'done' ? 100 : 0,
          targetDate: fm.target_date || '',
          nextReview: fm.next_review || '',
          tags: Array.isArray(fm.tags) ? fm.tags : (fm.tags ? [fm.tags] : []),
          stepCount: 0, doneCount: 0,
          path: path.join(dir, f),
        });
      } catch { /* ignore */ }
    }
  }
  return out;
}

/** List all learning paths (new tree + legacy). */
function listPaths(filter = {}, projectRoot = process.cwd()) {
  const config = cliUtils.loadConfig(projectRoot);
  const r = root(config, projectRoot);
  const out = [];
  if (fs.existsSync(r)) {
    for (const entry of fs.readdirSync(r, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const idx = readIndex(entry.name, config, projectRoot);
      if (!idx) continue;
      out.push(toPathSummary(idx, listSteps(entry.name, config, projectRoot)));
    }
  }
  out.push(...listLegacy(config, projectRoot));
  let result = out;
  if (filter.status) result = result.filter(p => (p.status || '').toLowerCase() === String(filter.status).toLowerCase());
  if (filter.reviewDue) {
    const today = todayISO();
    result = result.filter(p => p.nextReview && p.nextReview <= today && p.progress < 100);
  }
  result.sort((a, b) => a.progress - b.progress || a.title.localeCompare(b.title));
  return result;
}

/** Read one path with steps + progress. */
function readPath(slug, projectRoot = process.cwd()) {
  const config = cliUtils.loadConfig(projectRoot);
  const idx = readIndex(slug, config, projectRoot);
  if (!idx) throw new Error(`Learning path not found: ${slug}`);
  const steps = listSteps(slug, config, projectRoot);
  return { ...toPathSummary(idx, steps), body: idx.body, steps };
}

/** Create a learning path. */
function addPath(params = {}, projectRoot = process.cwd()) {
  if (!params.title) throw new Error('title is required');
  const config = cliUtils.loadConfig(projectRoot);
  let slug = slugify(params.title);
  const r = root(config, projectRoot);
  cliUtils.ensureDir(r);
  if (fs.existsSync(path.join(r, slug))) slug = `${slug}-${Date.now().toString(36)}`;
  const dir = path.join(r, slug);
  cliUtils.ensureDir(dir);
  const fm = {
    catpilot: 'learning',
    title: params.title,
    goal: params.goal || '',
    status: params.status || 'In Progress',
    target_date: params.target_date || params.targetDate || '',
    next_review: params.next_review || params.nextReview || '',
    tags: normTags(params.tags),
    created: todayISO(),
    updated: todayISO(),
  };
  fs.writeFileSync(path.join(dir, 'index.md'), `${toFrontmatter(fm)}\n\n# ${params.title}\n\n${(params.body || '').trim()}\n`, 'utf8');
  // Optional initial steps
  if (Array.isArray(params.steps)) params.steps.forEach((s, i) => addStep(slug, typeof s === 'string' ? { title: s, order: i + 1 } : { ...s, order: s.order || i + 1 }, projectRoot));
  return readPath(slug, projectRoot);
}

/** Update a path's index frontmatter/body. */
function updatePath(slug, patch = {}, projectRoot = process.cwd()) {
  const config = cliUtils.loadConfig(projectRoot);
  const idx = readIndex(slug, config, projectRoot);
  if (!idx) throw new Error(`Learning path not found: ${slug}`);
  const fm = { ...idx.fm, catpilot: 'learning', updated: todayISO() };
  const map = { title: 'title', goal: 'goal', status: 'status', targetDate: 'target_date', target_date: 'target_date', nextReview: 'next_review', next_review: 'next_review' };
  for (const [k, key] of Object.entries(map)) if (patch[k] !== undefined) fm[key] = patch[k];
  if (patch.tags !== undefined) fm.tags = normTags(patch.tags);
  const body = patch.body !== undefined ? patch.body : idx.body;
  const title = fm.title || slug;
  fs.writeFileSync(idx.path, `${toFrontmatter(fm)}\n\n# ${title}\n\n${(body || '').trim()}\n`, 'utf8');
  return readPath(slug, projectRoot);
}

/** Add a step to a path. */
function addStep(slug, params = {}, projectRoot = process.cwd()) {
  if (!params.title) throw new Error('step title is required');
  const config = cliUtils.loadConfig(projectRoot);
  if (!readIndex(slug, config, projectRoot)) throw new Error(`Learning path not found: ${slug}`);
  const dir = path.join(pathDir(slug, config, projectRoot), 'steps');
  cliUtils.ensureDir(dir);
  const existing = listSteps(slug, config, projectRoot);
  const order = params.order !== undefined ? parseInt(params.order, 10) : (existing.length + 1);
  let id = slugify(params.title);
  if (fs.existsSync(path.join(dir, id + '.md'))) id = `${id}-${Date.now().toString(36)}`;
  const { progress, status } = resolveProgressStatus({ patchProgress: params.progress, patchStatus: params.status, zero: 'Todo' });
  const fm = { catpilot: 'learning-step', learning: slug, title: params.title, status, progress, due: params.due || '', order };
  const notes = (params.notes !== undefined ? params.notes : params.body) || '';
  fs.writeFileSync(path.join(dir, id + '.md'), `${toFrontmatter(fm)}\n\n# ${params.title}\n\n${String(notes).trim()}\n`, 'utf8');
  return maybeComplete(slug, projectRoot);
}

/** Update a step (status, progress, due, notes, title, order). */
function updateStep(slug, stepId, patch = {}, projectRoot = process.cwd()) {
  const config = cliUtils.loadConfig(projectRoot);
  const file = path.join(pathDir(slug, config, projectRoot), 'steps', path.basename(stepId) + '.md');
  if (!fs.existsSync(file)) throw new Error(`Step not found: ${stepId}`);
  const content = fs.readFileSync(file, 'utf8');
  const fm = parseFrontmatter(content);
  fm.catpilot = 'learning-step'; fm.learning = slug;
  if (patch.title !== undefined) fm.title = patch.title;
  if (patch.order !== undefined) fm.order = parseInt(patch.order, 10);
  if (patch.due !== undefined) fm.due = patch.due;
  const cur = resolveProgressStatus({ curProgress: childProgress(fm), curStatus: fm.status, patchProgress: patch.progress, patchStatus: patch.status, zero: 'Todo' });
  fm.progress = cur.progress; fm.status = cur.status;
  const body = (patch.notes !== undefined ? patch.notes : (patch.body !== undefined ? patch.body : noteBodyOf(content))) || '';
  fs.writeFileSync(file, `${toFrontmatter(fm)}\n\n# ${fm.title}\n\n${String(body).trim()}\n`, 'utf8');
  return maybeComplete(slug, projectRoot);
}

/** Auto-complete a path when every step reaches 100%. */
function maybeComplete(slug, projectRoot) {
  const result = readPath(slug, projectRoot);
  if (result.stepCount > 0 && result.doneCount === result.stepCount && String(result.status).toLowerCase() !== 'done') {
    return completePath(slug, projectRoot);
  }
  return result;
}

/** Remove a step. */
function removeStep(slug, stepId, projectRoot = process.cwd()) {
  const config = cliUtils.loadConfig(projectRoot);
  const file = path.join(pathDir(slug, config, projectRoot), 'steps', path.basename(stepId) + '.md');
  if (!fs.existsSync(file)) throw new Error(`Step not found: ${stepId}`);
  fs.unlinkSync(file);
  return readPath(slug, projectRoot);
}

/** Mark a path complete and record an achievement. */
function completePath(slug, projectRoot = process.cwd()) {
  const config = cliUtils.loadConfig(projectRoot);
  const idx = readIndex(slug, config, projectRoot);
  if (!idx) throw new Error(`Learning path not found: ${slug}`);
  updatePath(slug, { status: 'Done' }, projectRoot);
  try {
    addAchievement({
      title: `Completed learning path: ${idx.fm.title || slug}`,
      sourceType: 'learning',
      source: slug,
      tags: Array.isArray(idx.fm.tags) ? idx.fm.tags : [],
    }, projectRoot);
  } catch { /* achievement best-effort */ }
  return readPath(slug, projectRoot);
}

/** Remove a whole path. */
function removePath(slug, projectRoot = process.cwd()) {
  const config = cliUtils.loadConfig(projectRoot);
  const dir = pathDir(slug, config, projectRoot);
  if (!fs.existsSync(dir)) throw new Error(`Learning path not found: ${slug}`);
  fs.rmSync(dir, { recursive: true, force: true });
  return { slug, removed: true };
}

export {
  listPaths, readPath, addPath, updatePath, removePath,
  addStep, updateStep, removeStep, completePath,
};
