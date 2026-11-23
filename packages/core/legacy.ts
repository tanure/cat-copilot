import path from 'node:path';
import fs from 'node:fs/promises';
import { z } from 'zod';
import { parseTasksTable, parseJournalEntries, parsePomodoroTable } from '../../lib/cli-utils.js';
import { parseFrontmatter } from '../../lib/domains.js';
import { collectFiles, digest } from './assets.js';
import { isWithin } from './files.js';
import { backupSchema, recordSchema, type Backup, type Domain, type RecordEntry, type Workspace } from './types.js';

function stableId(key: string) {
  const hash = digest(key).slice(0, 32).split('');
  hash[12] = '8'; hash[16] = '8';
  const hex = hash.join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export async function legacyBackup(directory: string, workspace: Workspace): Promise<{ backup: Backup; warnings: string[]; sourceFiles: number }> {
  const root = await fs.realpath(directory);
  const destination = await fs.realpath(workspace.location);
  if (isWithin(root, destination) || isWithin(destination, root)) throw new Error('Legacy source and destination must be separate, non-overlapping directories. Originals are never modified.');
  const files = await collectFiles(root, ['.git', 'node_modules']);
  const warnings = ['Git metadata and node_modules directories are excluded. Originals are never changed.', 'Original source files and attachments are archived byte-for-byte; wiki/plugin syntax remains source-editable.'];
  const records: RecordEntry[] = [];
  const recordIds = new Set<string>();
  const ids = new Map<string, string>();
  const sourceNames = new Map(files.map(file => [file.path.normalize('NFC').toLowerCase(), file.path]));
  if (sourceNames.size !== files.length) throw new Error('Source filenames collide on a case-insensitive filesystem.');
  const date = (value: string, source: string) => {
    if (!value) return '';
    if (z.iso.date().safeParse(value).success) return value;
    warnings.push(`Unrecognized date "${value}" in ${source}; retained in the original archive.`);
    return '';
  };
  const status = (value: string) => {
    const key = value.toLowerCase().replace(/[\s_-]/g, '');
    if (['done', 'completed', 'complete'].includes(key)) return 'Done';
    if (key === 'blocked') return 'Blocked';
    if (['inprogress', 'active', 'started'].includes(key)) return 'In Progress';
    if (key && !['open', 'todo', 'pending', 'planned', 'notstarted'].includes(key)) warnings.push(`Unrecognized status "${value}" is shown as Open; the original is retained in the source archive.`);
    return 'Open';
  };
  const priorities: Record<string, string> = { high: 'P1', medium: 'P2', med: 'P2', low: 'P3', p0: 'P0', p1: 'P1', p2: 'P2', p3: 'P3' };
  const priority = (value: string) => {
    if (value && !priorities[value.toLowerCase()]) warnings.push(`Unrecognized priority "${value}" is shown as P2; the original is retained in the source archive.`);
    return priorities[value.toLowerCase()] || 'P2';
  };
  for (const file of files) {
    if (!/\.md$/i.test(file.path)) continue;
    if (file.path.split('/').some(part => ['.obsidian', '_templates', 'templates'].includes(part.toLowerCase()))) {
      warnings.push('Template/plugin documents are archived without creating misleading management records.');
      continue;
    }
    const raw = file.bytes.toString('utf8');
    if (!Buffer.from(raw, 'utf8').equals(file.bytes)) throw new Error(`Non-UTF-8 Markdown requires manual conversion before import: ${file.path}`);
    const text = raw.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
    const fm = parseFrontmatter(text);
    const frontmatter = text.match(/^---\n([\s\S]*?)\n---/);
    if (frontmatter) {
      for (const line of frontmatter[1].split('\n')) {
        const property = line.match(/^([^\s:]+):\s*(.*?)$/);
        if (!property) { if (line.trim()) warnings.push(`Complex metadata in ${file.path} remains in the raw document and source archive.`); continue; }
        const [, key, value] = property;
        if (/^["[]/.test(value)) {
          try {
            const parsed: unknown = JSON.parse(value);
            if (typeof parsed === 'string' || (Array.isArray(parsed) && parsed.every(item => typeof item === 'string'))) fm[key] = parsed;
            else warnings.push(`Non-string metadata ${key} in ${file.path} remains in the raw document and source archive.`);
          } catch { warnings.push(`Non-JSON YAML metadata ${key} in ${file.path} remains in the raw document and source archive.`); }
        }
      }
    } else if (text.startsWith('---\n')) warnings.push(`Unclosed frontmatter in ${file.path} is preserved as source text.`);
    const str = (key: string) => typeof fm[key] === 'string' ? fm[key] : '';
    const period = file.path.match(/(?:^|\/)(\d{4}\/(?:\d{4}-\d{2}(?:\/\d{4}-\d{2}-\d{2})?|W\d{2}))/)?.[1] || '';
    const timestamp = (value: string, fallback: Date) => {
      if (!value) return fallback.toISOString();
      if (z.iso.date().safeParse(value).success) return `${value}T00:00:00.000Z`;
      if (z.iso.datetime({ offset: true }).safeParse(value).success) return new Date(value).toISOString();
      warnings.push(`Unrecognized timestamp "${value}" in ${file.path}; original retained in source metadata.`);
      return fallback.toISOString();
    };
    const base = { created: timestamp(str('created') || str('date'), file.created), updated: timestamp(str('updated'), file.modified), revision: digest(file.bytes) };
    const legacy = { source: file.path, archive: `catpilot-asset:legacy-source/${file.path.split('/').map(encodeURIComponent).join('/')}`, frontmatter: fm };
    const create = (domain: Domain, title: string, body: string, fields: Record<string, unknown>, local = '') => {
      const id = stableId(`${file.path}:${local}`);
      if (recordIds.has(id)) throw new Error(`Ambiguous duplicate legacy identity in ${file.path}: ${local}`);
      recordIds.add(id);
      const record = recordSchema.parse({ ...base, id, domain, title, body, fields: { ...fields, period, legacy } });
      records.push(record);
      if (!local) ids.set(file.path.toLowerCase(), id);
      return record;
    };
    const title = str('title') || text.match(/^#\s+(.+)$/m)?.[1] || path.posix.basename(file.path, '.md');
    if (/^##\s+(Open|Completed) Tasks$/m.test(text)) {
      for (const task of parseTasksTable(text)) {
        if (!Number.isSafeInteger(task.id) || task.id < 1) throw new Error(`Invalid task ID in ${file.path}. Correct the source table before import.`);
        create('tasks', task.title, task.context, {
          ...task.smart, status: status(task.status), due: date(task.dueDate, file.path), priority: priority(task.priority),
          tags: task.tags.split(',').map(tag => tag.trim()).filter(Boolean), project: task.project,
          log: task.log, legacyId: task.id, legacyPeriod: period,
        }, `task:${task.id}`);
      }
      create('knowledge', `Source: ${title}`, raw, { folder: 'Legacy source documents' });
      continue;
    }
    const milestoneLines = text.split('\n');
    const milestoneHeader = milestoneLines.findIndex(line => /^\|\s*ID\s*\|\s*Name\s*\|\s*Target Date\s*\|\s*Status\s*\|\s*Notes\s*\|/i.test(line));
    if (milestoneHeader >= 0) {
      for (const line of milestoneLines.slice(milestoneHeader + 1)) {
        if (/^#/.test(line)) break;
        if (!line.trim() || /^[\s|:-]+$/.test(line)) continue;
        if (!line.trim().startsWith('|')) continue;
        const cells = line.trim().replace(/^\||\|$/g, '').split('|').map(cell => cell.trim());
        if (cells.length < 5 || cells.length > 6) {
          warnings.push(`Nonstandard milestone row in ${file.path} remains in the source document/archive.`);
          continue;
        }
        const [id, name, target, state, notes, link = ''] = cells;
        if (!/^[1-9]\d*$/.test(id)) throw new Error(`Invalid milestone ID in ${file.path}. Correct the source table before import.`);
        create('milestones', name, notes, {
          status: status(state), due: date(target, file.path), legacyId: Number(id), legacyLink: link,
          project: link.startsWith('project:') ? link.slice('project:'.length) : '',
        }, `milestone:${id}`);
      }
      create('knowledge', `Source: ${title}`, raw, { folder: 'Legacy source documents' });
      continue;
    }
    if (/^###\s+\d{4}-\d{2}-\d{2}$/m.test(text) && /journal/i.test(path.posix.basename(file.path))) {
      for (const [index, entry] of parseJournalEntries(text).entries()) {
        const record = create('journal', entry.date, entry.text, { due: date(entry.date, file.path), date: entry.date }, `journal:${entry.date}:${index}`);
        record.created = timestamp(entry.date, file.created);
      }
      create('knowledge', `Source: ${title}`, raw, { folder: 'Legacy source documents' });
      continue;
    }
    if (/^##\s+Sessions$/m.test(text) && /pomodoro/i.test(file.path)) {
      for (const session of parsePomodoroTable(text)) create('pomodoro', `${session.type}: ${session.task || 'Focus session'}`, session.notes, {
        legacySession: session, status: status(session.status),
        minutes: Math.max(1, Math.min(1440, Number(session.actualMin || session.plannedMin) || 25)),
      }, `session:${session.id}`);
      create('knowledge', `Source: ${title}`, raw, { folder: 'Legacy source documents' });
      continue;
    }
    const tag = str('catpilot').toLowerCase();
    const domain: Domain = tag.startsWith('learning') ? 'learning' : tag.startsWith('project') ? 'projects' : tag === 'growth' ? 'growth' : tag === 'achievement' ? 'achievements' : tag === 'milestone' ? 'milestones' : tag === 'journal' ? 'journal' : 'knowledge';
    const tags = fm.tags ? (Array.isArray(fm.tags) ? fm.tags : [fm.tags]) : [];
    const progress = Number(str('progress') || 0);
    if (!Number.isFinite(progress) || progress < 0 || progress > 100) warnings.push(`Invalid progress in ${file.path}; original value preserved in legacy metadata.`);
    create(domain, title, raw, {
      status: status(str('status')), priority: priority(str('priority')), due: date(str('due') || str('target_date') || str('target'), file.path), tags,
      folder: str('folder') || path.posix.dirname(file.path), type: str('type'),
      progress: Number.isFinite(progress) ? Math.max(0, Math.min(100, Math.round(progress))) : 0,
      project: str('project'), goal: str('goal'), measure: str('measure'), steps: str('steps'), why: str('why'),
      owner: str('owner'), summary: str('summary'), target_date: str('target_date'), next_review: str('next_review'),
      order: /^\d+$/.test(str('order')) ? Number(str('order')) : 0, date: str('date'),
      sourceType: str('source_type'), source: str('source'),
    });
  }
  for (const record of records) {
    const source = record.fields.legacy as { source: string };
    const parentPath = source.source.replace(/\/(?:items|steps)\/[^/]+$/, '/index.md');
    if (parentPath !== source.source && ['projects', 'learning'].includes(record.domain)) {
      const parent = ids.get(parentPath.toLowerCase());
      if (!parent) throw new Error(`Missing parent document for ${source.source}. Import the complete project/learning directory.`);
      record.fields.parent = parent;
    }
  }
  const projectAliases = new Map<string, Set<RecordEntry>>();
  const learningAliases = new Map<string, Set<RecordEntry>>();
  for (const record of records.filter(record => ['projects', 'learning'].includes(record.domain) && !record.fields.parent)) {
    const aliases = record.domain === 'projects' ? projectAliases : learningAliases;
    const source = record.fields.legacy as { source: string; frontmatter: Record<string, unknown> };
    const relative = source.source.replace(/\/index\.md$/i, '').replace(/\.md$/i, '');
    for (const value of [record.title, relative, path.posix.basename(relative), source.frontmatter.id, source.frontmatter.slug]) {
      if (typeof value !== 'string' || !value) continue;
      const key = value.toLowerCase();
      const matches = aliases.get(key) || new Set<RecordEntry>();
      matches.add(record);
      aliases.set(key, matches);
    }
  }
  for (const record of records) {
    const source = record.fields.legacy as { source: string };
    if (record.fields.project) {
      const matches = [...(projectAliases.get(record.fields.project.toLowerCase()) || [])];
      if (matches.length > 1) throw new Error(`Ambiguous project reference "${record.fields.project}" in ${source.source}. Resolve it before import.`);
      if (matches.length === 1) {
        record.fields.legacyProject = record.fields.project;
        record.fields.project = matches[0].id;
      } else warnings.push(`Unmatched project reference "${record.fields.project}" in ${source.source} is preserved without inventing a relationship.`);
    }
    const link = record.fields.legacyLink;
    const learning = typeof link === 'string' && link.startsWith('learning:') ? link.slice('learning:'.length) : '';
    const origin = typeof record.fields.source === 'string' ? record.fields.source : '';
    const sourceType = record.fields.sourceType;
    const reference = learning || (['project', 'learning'].includes(String(sourceType)) ? origin : '');
    if (reference) {
      const aliases = learning || sourceType === 'learning' ? learningAliases : projectAliases;
      const matches = [...(aliases.get(reference.toLowerCase()) || [])];
      if (matches.length > 1) throw new Error(`Ambiguous linked entity "${reference}" in ${source.source}. Resolve it before import.`);
      if (matches.length === 1) {
        if (learning) record.fields.learning = matches[0].id;
        else { record.fields.legacySource = origin; record.fields.source = matches[0].id; }
      } else warnings.push(`Unmatched linked entity "${reference}" in ${source.source} remains in original metadata.`);
    }
    record.body = record.body.replace(/(!?\[[^\]]*\]\()([^)\s]+)(\))/g, (original, prefix: string, target: string, suffix: string) => {
      if (/^[a-z][a-z0-9+.-]*:|^#|^\/\//i.test(target)) return original;
      let decoded: string;
      try { decoded = decodeURIComponent(target.split('#')[0]); }
      catch { warnings.push(`Unrecognized link encoding in ${source.source}: ${target}`); return original; }
      const relative = path.posix.normalize(path.posix.join(path.posix.dirname(source.source), decoded));
      const match = sourceNames.get(relative.normalize('NFC').toLowerCase());
      if (!match) { warnings.push(`Unmatched relative link in ${source.source}: ${target}`); return original; }
      return `${prefix}catpilot-asset:legacy-source/${match.split('/').map(encodeURIComponent).join('/')}${suffix}`;
    });
  }
  for (let offset = 0; offset < files.length; offset += 1000) {
    const page = offset / 1000 + 1;
    records.push(recordSchema.parse({
      id: stableId(`catpilot:legacy-source-inventory:${page}`), domain: 'knowledge',
      title: `Legacy source archive ${page}`, created: workspace.created, updated: workspace.created, revision: 'legacy-inventory',
      body: '# Original source archive\n\nThese workspace-owned copies preserve the original bytes. The source vault is unchanged.\n\n' +
        files.slice(offset, offset + 1000).map(file => `- [${file.path.replace(/[[\]\\]/g, '\\$&')}](catpilot-asset:legacy-source/${file.path.split('/').map(encodeURIComponent).join('/')})`).join('\n'),
      fields: { folder: 'Legacy source documents', legacyArchive: true },
    }));
  }
  const backup = backupSchema.parse({
    format: 'catpilot-workspace', version: 1, workspace,
    exported: new Date().toISOString(), records,
    assets: files.map(file => ({ path: `legacy-source/${file.path}`, data: file.bytes.toString('base64'), sha256: digest(file.bytes) })),
  });
  return { backup, warnings: [...new Set(warnings)], sourceFiles: files.length };
}
