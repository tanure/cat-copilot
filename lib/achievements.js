#!/usr/bin/env node

/**
 * CatPilot Achievements — a dedicated, stable-root log of wins.
 *
 *   <storage.root>/achievements/<YYYY-MM-DD_slug>.md
 * frontmatter: catpilot: achievement, title, date, source_type, source, tags[]
 *
 * Achievements can be linked to a Learning path or Project via source_type +
 * source (slug) and are surfaced on their dashboards. Auto-recorded when a
 * learning path or project completes.
 */

import fs from 'fs';
import path from 'path';
import * as cliUtils from './cli-utils.js';
import { toFrontmatter, parseFrontmatter, slugify } from './domains.js';

function todayISO() {
  return new Date().toISOString().split('T')[0];
}

function root(config, projectRoot = process.cwd()) {
  return cliUtils.resolveStableDir('achievements', config, projectRoot);
}

function normTags(tags) {
  if (Array.isArray(tags)) return tags.map(t => String(t).trim()).filter(Boolean);
  if (typeof tags === 'string') return tags.split(',').map(t => t.trim()).filter(Boolean);
  return [];
}

function readAchievement(absPath) {
  const content = fs.readFileSync(absPath, 'utf8');
  const fm = parseFrontmatter(content);
  const body = content.replace(/^---\n[\s\S]*?\n---\n?/, '').replace(/^\s*#\s+.*\n?/, '').trim();
  return {
    filename: path.basename(absPath),
    path: absPath,
    title: fm.title || path.basename(absPath, '.md').replace(/^\d{4}-\d{2}-\d{2}_/, ''),
    date: fm.date || '',
    sourceType: fm.source_type || '',
    source: fm.source || '',
    tags: Array.isArray(fm.tags) ? fm.tags : (fm.tags ? [fm.tags] : []),
    body,
  };
}

/** Add an achievement. */
function addAchievement(params = {}, projectRoot = process.cwd()) {
  if (!params.title) throw new Error('title is required');
  const config = cliUtils.loadConfig(projectRoot);
  const dir = root(config, projectRoot);
  cliUtils.ensureDir(dir);
  const date = params.date || todayISO();
  let filePath = path.join(dir, `${date}_${slugify(params.title)}.md`);
  if (fs.existsSync(filePath)) filePath = path.join(dir, `${date}_${slugify(params.title)}-${Date.now().toString(36)}.md`);
  const fm = {
    catpilot: 'achievement',
    title: params.title,
    date,
    source_type: params.sourceType || params.source_type || '',
    source: params.source || '',
    tags: normTags(params.tags),
  };
  const content = `${toFrontmatter(fm)}\n\n# ${params.title}\n\n${(params.body || '').trim()}\n`;
  fs.writeFileSync(filePath, content, 'utf8');
  return readAchievement(filePath);
}

/** List achievements (newest first), optionally filtered by source. */
function listAchievements(filter = {}, projectRoot = process.cwd()) {
  const config = cliUtils.loadConfig(projectRoot);
  const dir = root(config, projectRoot);
  if (!fs.existsSync(dir)) return [];
  let items = fs.readdirSync(dir).filter(f => f.endsWith('.md'))
    .map(f => { try { return readAchievement(path.join(dir, f)); } catch { return null; } })
    .filter(Boolean);
  if (filter.sourceType) items = items.filter(a => a.sourceType === filter.sourceType);
  if (filter.source) items = items.filter(a => a.source === filter.source);
  items.sort((a, b) => String(b.date).localeCompare(String(a.date)) || b.filename.localeCompare(a.filename));
  return items;
}

/** Remove an achievement by filename. */
function removeAchievement(filename, projectRoot = process.cwd()) {
  const config = cliUtils.loadConfig(projectRoot);
  const dir = root(config, projectRoot);
  const abs = path.join(dir, path.basename(filename));
  if (!fs.existsSync(abs)) throw new Error(`Achievement not found: ${filename}`);
  const item = readAchievement(abs);
  fs.unlinkSync(abs);
  return item;
}

export { addAchievement, listAchievements, removeAchievement };
