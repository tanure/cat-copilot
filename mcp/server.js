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
    context: z.string().optional().describe('One-line context')
  }
}, async (args) => fromCore(await core.add_task(args)));

server.registerTool('task_list', {
  title: 'List tasks',
  description: 'List tasks, optionally filtered by status (open/done/all).',
  inputSchema: {
    status: z.enum(['open', 'done', 'all']).optional().describe('Filter by status')
  }
}, async (args) => fromCore(await core.list_tasks(args)));

server.registerTool('task_complete', {
  title: 'Complete task',
  description: 'Mark a task as Done by its numeric ID.',
  inputSchema: { id: z.number().int().describe('Task ID') }
}, async (args) => fromCore(await core.complete_task(args)));

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
