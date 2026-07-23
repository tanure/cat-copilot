#!/usr/bin/env node

/**
 * CatPilot MCP Server
 *
 * Exposes CatPilot's personal-OS capabilities (tasks, journal, milestones, memos,
 * learning, growth, projects) over the Model Context Protocol so the SAME engine
 * works in GitHub Copilot CLI, Copilot in VS Code, the Copilot App, and any other
 * MCP host.
 *
 * Storage is resolved from `data/config.json` via lib/cli-utils.js — there is no
 * duplicated file logic here. Point your config's `storage.root` at your private
 * Obsidian vault and every surface reads/writes the same files.
 *
 * Working directory / storage resolution:
 *   Storage is resolved globally by lib/cli-utils.js in this order:
 *     1. CATPILOT_CONFIG (explicit config path)
 *     2. CATPILOT_ROOT   (<root>/data/config.json)
 *     3. <cwd>/data/config.json (project-local)
 *     4. ~/.catpilot/config.json (global, shared across every directory)
 *   So the SAME storage is used no matter where the MCP host launches this
 *   process. Set CATPILOT_ROOT only if you want to pin a specific project.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import * as core from '../adapters/claude-code/tools.js';
import * as domains from '../lib/domains.js';
import * as cliUtils from '../lib/cli-utils.js';
import * as knowledge from '../lib/knowledge.js';
import * as learningPaths from '../lib/learning.js';
import * as projectsLib from '../lib/projects.js';
import * as achievements from '../lib/achievements.js';

// Pin working directory so config resolution is stable across MCP hosts.
if (process.env.CATPILOT_ROOT) {
  try {
    process.chdir(process.env.CATPILOT_ROOT);
  } catch (err) {
    process.stderr.write(`⚠️ CATPILOT_ROOT invalid (${process.env.CATPILOT_ROOT}): ${err.message}\n`);
  }
}

// Read the version from package.json so every surface reports the same number.
let pkgVersion = '0.0.0';
try {
  const here = path.dirname(fileURLToPath(import.meta.url));
  pkgVersion = JSON.parse(fs.readFileSync(path.resolve(here, '..', 'package.json'), 'utf8')).version || pkgVersion;
} catch { /* fall back to placeholder */ }

const server = new McpServer({
  name: 'catpilot',
  version: pkgVersion
});

/** Wrap any result as MCP text content (JSON for structured data). */
function ok(payload) {
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
  return { content: [{ type: 'text', text }] };
}

function fail(message) {
  return { content: [{ type: 'text', text: `❌ ${message}` }], isError: true };
}

/** Bridge a core adapter result ({success, ...}) into an MCP response. */
function fromCore(result) {
  if (result && result.success === false) return fail(result.error || 'Operation failed');
  return ok(result);
}

// ----------------------------------------------------------------------------
// Tasks
// ----------------------------------------------------------------------------
server.registerTool('task_add', {
  title: 'Add task',
  description: 'Create a task in the configuration-resolved tasks file.',
  inputSchema: {
    title: z.string().describe('Short, action-oriented task title'),
    due: z.string().optional().describe('Due date YYYY-MM-DD'),
    priority: z.string().optional().describe('P0/P1/P2/P3 or High/Med/Low'),
    tags: z.string().optional().describe('Comma-separated tags'),
    context: z.string().optional().describe('One-line context'),
    project: z.string().optional().describe('Optional project slug to link this task to'),
    status: z.enum(['Open', 'In Progress', 'Blocked', 'Done']).optional().describe('Initial status (default Open)')
  }
}, async (args) => fromCore(await core.add_task(args)));

server.registerTool('task_list', {
  title: 'List tasks',
  description: 'List tasks, optionally filtered by status (open/in progress/blocked/done/all).',
  inputSchema: {
    status: z.enum(['open', 'in progress', 'blocked', 'done', 'all']).optional().describe('Filter by status')
  }
}, async (args) => fromCore(await core.list_tasks(args)));

server.registerTool('task_complete', {
  title: 'Complete task',
  description: 'Mark a task as Done by its numeric ID.',
  inputSchema: { id: z.number().int().describe('Task ID') }
}, async (args) => fromCore(await core.complete_task(args)));

server.registerTool('task_set_status', {
  title: 'Set task status',
  description: 'Set a task status to Open, In Progress, Blocked, or Done by its numeric ID.',
  inputSchema: {
    id: z.number().int().describe('Task ID'),
    status: z.enum(['Open', 'In Progress', 'Blocked', 'Done']).describe('New status')
  }
}, async (args) => fromCore(await core.set_task_status(args)));

server.registerTool('task_remove', {
  title: 'Remove task',
  description: 'Remove a task by its numeric ID.',
  inputSchema: { id: z.number().int().describe('Task ID') }
}, async (args) => fromCore(await core.remove_task(args)));

// ----------------------------------------------------------------------------
// Journal
// ----------------------------------------------------------------------------
server.registerTool('journal_add', {
  title: 'Add journal entry',
  description: 'Append a journal entry under today\'s date heading.',
  inputSchema: { text: z.string().describe('Free-form journal text') }
}, async (args) => fromCore(await core.add_journal_entry(args)));

server.registerTool('journal_list', {
  title: 'List journal entries',
  description: 'List recent journal entries.',
  inputSchema: { days: z.number().int().optional().describe('How many recent entries (default 7)') }
}, async (args) => fromCore(await core.list_journal(args)));

// ----------------------------------------------------------------------------
// Memos
// ----------------------------------------------------------------------------
server.registerTool('memo_create', {
  title: 'Create memo',
  description: 'Create a markdown memo file.',
  inputSchema: {
    title: z.string().describe('Memo title'),
    content: z.string().optional().describe('Memo body')
  }
}, async (args) => fromCore(await core.create_memo(args)));

server.registerTool('memo_list', {
  title: 'List memos',
  description: 'List memo files in the resolved memo directory.',
  inputSchema: {}
}, async () => fromCore(await core.list_memos({})));

server.registerTool('memo_read', {
  title: 'Read memo',
  description: 'Read a memo by filename.',
  inputSchema: { filename: z.string().describe('Memo filename (e.g. 2026-06-19_handover.md)') }
}, async (args) => fromCore(await core.read_memo(args)));

// ----------------------------------------------------------------------------
// Pomodoro
// ----------------------------------------------------------------------------
server.registerTool('pomodoro_start', {
  title: 'Start Pomodoro',
  description: 'Start a Pomodoro focus/break timer. Refuses if one is already running unless force is set.',
  inputSchema: {
    minutes: z.number().int().optional().describe('Planned duration in minutes (defaults: focus 25, short-break 5, long-break 15)'),
    type: z.enum(['focus', 'short-break', 'long-break']).optional().describe('Session type'),
    task: z.string().optional().describe('Optional task to focus on (id like "7"/"#7" or a task title)'),
    label: z.string().optional().describe('Optional free-form label if not linking a task'),
    force: z.boolean().optional().describe('Override an already-running session')
  }
}, async (args) => fromCore(await core.pomodoro_start(args)));

server.registerTool('pomodoro_status', {
  title: 'Pomodoro status',
  description: 'Show the currently running Pomodoro session with computed remaining time, or none.',
  inputSchema: {}
}, async () => fromCore(await core.pomodoro_status()));

server.registerTool('pomodoro_complete', {
  title: 'Complete Pomodoro',
  description: 'Finalize the running Pomodoro session as completed and append it to the history log.',
  inputSchema: { notes: z.string().optional().describe('Optional notes about the session') }
}, async (args) => fromCore(await core.pomodoro_complete(args)));

server.registerTool('pomodoro_cancel', {
  title: 'Cancel Pomodoro',
  description: 'Abandon the running Pomodoro session and log it as abandoned.',
  inputSchema: { notes: z.string().optional().describe('Optional reason/notes') }
}, async (args) => fromCore(await core.pomodoro_cancel(args)));

server.registerTool('pomodoro_list', {
  title: 'List Pomodoro sessions',
  description: 'List past Pomodoro sessions (newest first).',
  inputSchema: { limit: z.number().int().optional().describe('Max sessions to return') }
}, async (args) => fromCore(await core.pomodoro_list(args)));

server.registerTool('pomodoro_stats', {
  title: 'Pomodoro stats',
  description: 'Aggregate Pomodoro stats (session count + focus minutes) for a period.',
  inputSchema: { period: z.enum(['today', 'week', 'month', 'all']).optional().describe('Reporting period (default all)') }
}, async (args) => fromCore(await core.pomodoro_stats(args)));

server.registerTool('pomodoro_report', {
  title: 'Pomodoro report',
  description: 'Productivity report for a period grouped by day, week, task, or session. Returns a summary (completed focus sessions, focus minutes, overall + focus completion rate) plus grouped breakdown rows.',
  inputSchema: {
    period: z.enum(['today', 'this-week', 'last-week', 'this-month', 'last-month', 'last-7', 'last-30', 'all']).optional().describe('Reporting period (default all)'),
    groupBy: z.enum(['day', 'week', 'task', 'session']).optional().describe('How to group the breakdown (default day)')
  }
}, async (args) => fromCore(await core.pomodoro_report(args)));

// ----------------------------------------------------------------------------
// Generic per-file domains: learning, growth, projects
// ----------------------------------------------------------------------------
function registerDomain(domain, label, extraFields, fieldDescriptions) {
  server.registerTool(`${domain === 'projects' ? 'project' : domain}_add`, {
    title: `Add ${label}`,
    description: `Create a ${label} note (frontmatter-tagged for Obsidian Dataview).`,
    inputSchema: {
      title: z.string().describe(`${label} title`),
      body: z.string().optional().describe('Markdown body for the note'),
      ...extraFields
    }
  }, async ({ title, body, ...frontmatter }) => {
    try {
      return ok(domains.addNote(domain, { title, body, frontmatter }));
    } catch (err) {
      return fail(err.message);
    }
  });

  server.registerTool(`${domain === 'projects' ? 'project' : domain}_list`, {
    title: `List ${label}s`,
    description: `List ${label} notes with their frontmatter.`,
    inputSchema: {}
  }, async () => {
    try {
      return ok(domains.listNotes(domain));
    } catch (err) {
      return fail(err.message);
    }
  });
}

registerDomain('learning', 'learning topic', {
  goal: z.string().optional().describe('What you want to achieve'),
  target_date: z.string().optional().describe('Target completion date YYYY-MM-DD'),
  next_review: z.string().optional().describe('Next spaced-review date YYYY-MM-DD'),
  status: z.string().optional().describe('In Progress / Done')
});

registerDomain('growth', 'growth/impact entry', {
  area: z.string().optional().describe('Impact area (e.g. delivery, leadership, learning)'),
  impact: z.string().optional().describe('Quantified impact statement')
});

registerDomain('projects', 'project', {
  status: z.string().optional().describe('Active / Blocked / Done'),
  owner: z.string().optional().describe('Owner'),
  due: z.string().optional().describe('Due date YYYY-MM-DD')
});

// ----------------------------------------------------------------------------
// Knowledge Base (evolved memos: folders + tags, stable non-partitioned tree)
// ----------------------------------------------------------------------------
server.registerTool('kb_add', {
  title: 'Add knowledge doc',
  description: 'Create a knowledge-base document with an optional folder and tags. Evolved memos; legacy memos remain readable.',
  inputSchema: {
    title: z.string().describe('Document title'),
    folder: z.string().optional().describe('Folder path, e.g. "Azure/Networking" (default General)'),
    tags: z.string().optional().describe('Comma-separated tags (feed the Obsidian graph)'),
    body: z.string().optional().describe('Markdown body')
  }
}, async ({ title, folder, tags, body }) => {
  try { return ok(knowledge.addDoc({ title, folder, tags, body })); } catch (err) { return fail(err.message); }
});

server.registerTool('kb_list', {
  title: 'List knowledge docs',
  description: 'List knowledge-base documents (new tree + legacy memos), optionally filtered by folder, tag or search text.',
  inputSchema: {
    folder: z.string().optional().describe('Filter by folder'),
    tag: z.string().optional().describe('Filter by tag'),
    q: z.string().optional().describe('Search title/tags')
  }
}, async (args) => { try { return ok(knowledge.listDocs(args || {})); } catch (err) { return fail(err.message); } });

server.registerTool('kb_read', {
  title: 'Read knowledge doc',
  description: 'Read a knowledge doc by id (e.g. "knowledge/general/my-note").',
  inputSchema: { id: z.string().describe('Doc id relative to storage root, no extension') }
}, async ({ id }) => { try { return ok(knowledge.readById(id)); } catch (err) { return fail(err.message); } });

server.registerTool('kb_update', {
  title: 'Update knowledge doc',
  description: 'Update a knowledge doc (title, folder, tags, body). Editing a legacy memo migrates it into the knowledge tree.',
  inputSchema: {
    id: z.string().describe('Doc id'),
    title: z.string().optional(),
    folder: z.string().optional(),
    tags: z.string().optional().describe('Comma-separated tags'),
    body: z.string().optional()
  }
}, async ({ id, ...patch }) => { try { return ok(knowledge.updateDoc(id, patch)); } catch (err) { return fail(err.message); } });

server.registerTool('kb_remove', {
  title: 'Remove knowledge doc',
  description: 'Delete a knowledge doc by id.',
  inputSchema: { id: z.string().describe('Doc id') }
}, async ({ id }) => { try { return ok(knowledge.removeDoc(id)); } catch (err) { return fail(err.message); } });

server.registerTool('kb_folders', {
  title: 'List knowledge folders',
  description: 'List knowledge-base folders with document counts and all tags with counts.',
  inputSchema: {}
}, async () => { try { return ok({ folders: knowledge.listFolders(), tags: knowledge.listTags() }); } catch (err) { return fail(err.message); } });

server.registerTool('kb_move', {
  title: 'Move knowledge doc',
  description: 'Move a knowledge doc to a different folder.',
  inputSchema: { id: z.string().describe('Doc id'), folder: z.string().describe('Destination folder') }
}, async ({ id, folder }) => { try { return ok(knowledge.moveDoc(id, folder)); } catch (err) { return fail(err.message); } });

// ----------------------------------------------------------------------------
// Learning paths (goal/cert plans with ordered steps + derived progress)
// ----------------------------------------------------------------------------
server.registerTool('learning_path_add', {
  title: 'Add learning path',
  description: 'Create a learning path (goal/certification study plan). Optionally seed ordered steps.',
  inputSchema: {
    title: z.string(),
    goal: z.string().optional(),
    target_date: z.string().optional().describe('YYYY-MM-DD'),
    next_review: z.string().optional().describe('YYYY-MM-DD'),
    tags: z.string().optional(),
    steps: z.array(z.string()).optional().describe('Ordered step titles'),
    body: z.string().optional()
  }
}, async (args) => { try { return ok(learningPaths.addPath(args)); } catch (err) { return fail(err.message); } });

server.registerTool('learning_path_list', {
  title: 'List learning paths',
  description: 'List learning paths with derived progress (new tree + legacy notes). Filter by status or review-due.',
  inputSchema: { status: z.string().optional(), reviewDue: z.boolean().optional() }
}, async (args) => { try { return ok(learningPaths.listPaths(args || {})); } catch (err) { return fail(err.message); } });

server.registerTool('learning_path_read', {
  title: 'Read learning path',
  description: 'Read a learning path with its steps and progress.',
  inputSchema: { slug: z.string() }
}, async ({ slug }) => { try { return ok(learningPaths.readPath(slug)); } catch (err) { return fail(err.message); } });

server.registerTool('learning_step_add', {
  title: 'Add learning step',
  description: 'Add a step to a learning path. A step can carry a progress percent (0-100), a due date and notes/description.',
  inputSchema: { slug: z.string(), title: z.string(), order: z.number().int().optional(), status: z.string().optional(), progress: z.number().int().min(0).max(100).optional(), due: z.string().optional(), notes: z.string().optional() }
}, async ({ slug, ...p }) => { try { return ok(learningPaths.addStep(slug, p)); } catch (err) { return fail(err.message); } });

server.registerTool('learning_step_update', {
  title: 'Update learning step',
  description: 'Update a learning step (status Todo/In Progress/Done, progress 0-100, due date, notes, title, order). Progress and status stay in sync; all steps at 100% auto-completes the path.',
  inputSchema: { slug: z.string(), stepId: z.string(), status: z.string().optional(), progress: z.number().int().min(0).max(100).optional(), due: z.string().optional(), notes: z.string().optional(), title: z.string().optional(), order: z.number().int().optional() }
}, async ({ slug, stepId, ...p }) => { try { return ok(learningPaths.updateStep(slug, stepId, p)); } catch (err) { return fail(err.message); } });

server.registerTool('learning_path_complete', {
  title: 'Complete learning path',
  description: 'Mark a learning path complete and record an achievement.',
  inputSchema: { slug: z.string() }
}, async ({ slug }) => { try { return ok(learningPaths.completePath(slug)); } catch (err) { return fail(err.message); } });

// ----------------------------------------------------------------------------
// Projects (index + items: requirements/tasks/milestones + linked tasks rollup)
// ----------------------------------------------------------------------------
server.registerTool('project_create', {
  title: 'Create project',
  description: 'Create a project container (start/due/status/owner/summary/tags) with a stable folder for its plan and items.',
  inputSchema: {
    title: z.string(),
    status: z.string().optional().describe('Active / Blocked / Done'),
    start: z.string().optional().describe('YYYY-MM-DD'),
    due: z.string().optional().describe('YYYY-MM-DD (optional)'),
    owner: z.string().optional(),
    summary: z.string().optional(),
    tags: z.string().optional()
  }
}, async (args) => { try { return ok(projectsLib.addProject(args)); } catch (err) { return fail(err.message); } });

server.registerTool('project_board', {
  title: 'List projects (portfolio)',
  description: 'List projects with progress rollups (new tree + legacy notes). Filter by status.',
  inputSchema: { status: z.string().optional() }
}, async (args) => { try { return ok(projectsLib.listProjects(args || {})); } catch (err) { return fail(err.message); } });

server.registerTool('project_read', {
  title: 'Read project dashboard',
  description: 'Read a project with requirements, tasks, milestones, linked main tasks, achievements and derived progress.',
  inputSchema: { slug: z.string() }
}, async ({ slug }) => { try { return ok(projectsLib.readProject(slug)); } catch (err) { return fail(err.message); } });

server.registerTool('project_item_add', {
  title: 'Add project item',
  description: 'Add a requirement, task, or milestone to a project plan. Tasks and milestones can carry a progress percent (0-100), due date and notes.',
  inputSchema: {
    slug: z.string(),
    type: z.enum(['requirement', 'task', 'milestone']).optional(),
    title: z.string(),
    status: z.string().optional(),
    progress: z.number().int().min(0).max(100).optional(),
    due: z.string().optional(),
    notes: z.string().optional(),
    order: z.number().int().optional()
  }
}, async ({ slug, ...p }) => { try { return ok(projectsLib.addItem(slug, p)); } catch (err) { return fail(err.message); } });

server.registerTool('project_item_update', {
  title: 'Update project item',
  description: 'Update a project item (status Open/In Progress/Done, progress 0-100, due, notes, type, title, order). Progress and status stay in sync.',
  inputSchema: { slug: z.string(), itemId: z.string(), status: z.string().optional(), progress: z.number().int().min(0).max(100).optional(), title: z.string().optional(), due: z.string().optional(), notes: z.string().optional(), type: z.enum(['requirement', 'task', 'milestone']).optional(), order: z.number().int().optional() }
}, async ({ slug, itemId, ...p }) => { try { return ok(projectsLib.updateItem(slug, itemId, p)); } catch (err) { return fail(err.message); } });

server.registerTool('project_complete', {
  title: 'Complete project',
  description: 'Mark a project complete and record an achievement.',
  inputSchema: { slug: z.string() }
}, async ({ slug }) => { try { return ok(projectsLib.completeProject(slug)); } catch (err) { return fail(err.message); } });

// ----------------------------------------------------------------------------
// Achievements (dedicated log, linkable to learning/projects)
// ----------------------------------------------------------------------------
server.registerTool('achievement_add', {
  title: 'Add achievement',
  description: 'Record an achievement/win, optionally linked to a learning path or project.',
  inputSchema: {
    title: z.string(),
    date: z.string().optional().describe('YYYY-MM-DD (default today)'),
    source_type: z.string().optional().describe('learning | project | other'),
    source: z.string().optional().describe('Linked slug'),
    tags: z.string().optional(),
    body: z.string().optional()
  }
}, async (args) => { try { return ok(achievements.addAchievement(args)); } catch (err) { return fail(err.message); } });

server.registerTool('achievement_list', {
  title: 'List achievements',
  description: 'List achievements (newest first), optionally filtered by source_type/source.',
  inputSchema: { source_type: z.string().optional(), source: z.string().optional() }
}, async (args) => { try { return ok(achievements.listAchievements({ sourceType: args && args.source_type, source: args && args.source })); } catch (err) { return fail(err.message); } });

// ----------------------------------------------------------------------------
// Config introspection
// ----------------------------------------------------------------------------
server.registerTool('config_info', {
  title: 'Show CatPilot config',
  description: 'Show the resolved storage configuration and current partition paths.',
  inputSchema: {}
}, async () => {
  try {
    const config = cliUtils.loadConfig();
    const partition = cliUtils.getPartitionFolder(config.storage.partitioning);
    const resolved = {};
    for (const type of Object.keys(config.storage.files || {})) {
      resolved[type] = cliUtils.resolveFilePath(type, config);
    }
    return ok({ config, partition, resolved });
  } catch (err) {
    return fail(err.message);
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write('😺 CatPilot MCP server running on stdio\n');
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err.stack || err.message}\n`);
  process.exit(1);
});
