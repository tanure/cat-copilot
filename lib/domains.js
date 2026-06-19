#!/usr/bin/env node

/**
 * CatPilot domain helpers for per-file note domains: learning, growth, projects.
 *
 * These domains store ONE markdown note per item under
 *   <storage.root>/<partition>/<domainDir>/<YYYY-MM-DD_slug>.md
 * with YAML frontmatter so Obsidian Dataview can query them. They reuse cli-utils
 * for config loading and path resolution, mirroring how memos already work.
 */

import fs from 'fs';
import path from 'path';
import * as cliUtils from './cli-utils.js';

// Map a storage domain (folder key) to the singular `catpilot:` frontmatter tag
// used by the Obsidian dashboards.
const DOMAIN_TAG = {
  learning: 'learning',
  growth: 'growth',
  projects: 'project'
};

function assertDomain(domain) {
  if (!(domain in DOMAIN_TAG)) {
    throw new Error(`Unknown domain: ${domain}. Expected one of ${Object.keys(DOMAIN_TAG).join(', ')}`);
  }
}

function slugify(title) {
  return String(title)
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 50) || 'note';
}

function todayISO() {
  return new Date().toISOString().split('T')[0];
}

/**
 * Serialize a frontmatter object to YAML (flat, with array support).
 */
function toFrontmatter(obj) {
  const lines = ['---'];
  for (const [key, value] of Object.entries(obj)) {
    if (Array.isArray(value)) {
      lines.push(`${key}: [${value.map(v => JSON.stringify(String(v))).join(', ')}]`);
    } else {
      lines.push(`${key}: ${JSON.stringify(value == null ? '' : String(value))}`);
    }
  }
  lines.push('---');
  return lines.join('\n');
}

/**
 * Parse the YAML frontmatter block at the top of a note (flat keys only).
 */
function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const data = {};
  for (const line of match[1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let raw = line.slice(idx + 1).trim();
    if (raw.startsWith('[') && raw.endsWith(']')) {
      raw = raw.slice(1, -1).split(',').map(s => s.trim().replace(/^"|"$/g, '')).filter(Boolean);
    } else {
      raw = raw.replace(/^"|"$/g, '');
    }
    data[key] = raw;
  }
  return data;
}

function resolveDomainDir(domain, config, projectRoot = process.cwd()) {
  // resolveFilePath already knows defaults for learning/growth/projects.
  return cliUtils.resolveFilePath(domain, config, projectRoot);
}

/**
 * Add a note to a per-file domain.
 * @param {string} domain - 'learning' | 'growth' | 'projects'
 * @param {object} params - { title (required), frontmatter?, body? }
 * @param {string} projectRoot
 * @returns {{ filename, path, frontmatter }}
 */
function addNote(domain, params = {}, projectRoot = process.cwd()) {
  assertDomain(domain);
  if (!params.title) throw new Error('title is required');

  const config = cliUtils.loadConfig(projectRoot);
  const dir = resolveDomainDir(domain, config, projectRoot);
  cliUtils.ensureDir(dir);

  const filename = `${todayISO()}_${slugify(params.title)}.md`;
  const filePath = path.join(dir, filename);

  // Security: keep the resolved file under the domain dir.
  if (!path.resolve(filePath).startsWith(path.resolve(dir))) {
    throw new Error('Invalid note path');
  }

  const frontmatter = {
    catpilot: DOMAIN_TAG[domain],
    title: params.title,
    date: todayISO(),
    ...(params.frontmatter || {})
  };

  const body = params.body ? `\n${params.body}\n` : '\n';
  const content = `${toFrontmatter(frontmatter)}\n\n# ${params.title}\n${body}`;
  fs.writeFileSync(filePath, content, 'utf8');

  return { filename, path: filePath, frontmatter };
}

/**
 * List notes in a per-file domain (newest first), with parsed frontmatter.
 * @returns {Array<{ filename, path, frontmatter }>}
 */
function listNotes(domain, projectRoot = process.cwd()) {
  assertDomain(domain);
  const config = cliUtils.loadConfig(projectRoot);
  const dir = resolveDomainDir(domain, config, projectRoot);
  cliUtils.ensureDir(dir);

  if (!fs.existsSync(dir)) return [];

  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.md'))
    .sort()
    .reverse()
    .map(filename => {
      const filePath = path.join(dir, filename);
      let frontmatter = {};
      try {
        frontmatter = parseFrontmatter(fs.readFileSync(filePath, 'utf8'));
      } catch { /* ignore unreadable note */ }
      return { filename, path: filePath, frontmatter };
    });
}

/**
 * Read a single note's frontmatter + body.
 */
function readNote(domain, filename, projectRoot = process.cwd()) {
  assertDomain(domain);
  const config = cliUtils.loadConfig(projectRoot);
  const dir = resolveDomainDir(domain, config, projectRoot);
  const filePath = path.join(dir, filename);

  if (!path.resolve(filePath).startsWith(path.resolve(dir))) {
    throw new Error('Invalid note path');
  }
  if (!fs.existsSync(filePath)) {
    throw new Error(`Note not found: ${filename}`);
  }

  const content = fs.readFileSync(filePath, 'utf8');
  const frontmatter = parseFrontmatter(content);
  const body = content.replace(/^---\n[\s\S]*?\n---\n?/, '').trim();
  return { filename, path: filePath, frontmatter, body };
}

export {
  DOMAIN_TAG,
  slugify,
  toFrontmatter,
  parseFrontmatter,
  addNote,
  listNotes,
  readNote
};
