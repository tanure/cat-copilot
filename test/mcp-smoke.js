#!/usr/bin/env node
/**
 * MCP smoke test: spins up the CatPilot MCP server over stdio in a temp workspace,
 * lists tools, and exercises a few of them end-to-end.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

function assert(cond, msg) {
  if (!cond) {
    console.error(`❌ ${msg}`);
    process.exitCode = 1;
    throw new Error(msg);
  }
  console.log(`✅ ${msg}`);
}

(async () => {
  // Isolated temp workspace with a config so we never touch real data.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'catpilot-mcp-'));
  fs.mkdirSync(path.join(tmp, 'data'), { recursive: true });
  fs.writeFileSync(
    path.join(tmp, 'data', 'config.json'),
    JSON.stringify({
      version: 1,
      storage: {
        root: 'data',
        partitioning: 'month',
        allowExternalPaths: true,
        files: {
          tasks: 'tasks.md', journal: 'journal.md', milestones: 'milestones.md',
          memos: 'memos', learning: 'learning', growth: 'growth', projects: 'projects',
          pomodoro: 'pomodoro.md'
        }
      },
      migration: { mode: 'move' }
    }, null, 2)
  );

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(repoRoot, 'bin', 'cat-mcp.js')],
    env: { ...process.env, CATPILOT_ROOT: tmp }
  });

  const client = new Client({ name: 'catpilot-smoke', version: '1.0.0' });
  await client.connect(transport);
  console.log('Connected to CatPilot MCP server.\n');

  const { tools } = await client.listTools();
  const names = tools.map(t => t.name);
  console.log('Tools:', names.join(', '), '\n');

  const expected = ['task_add', 'task_list', 'journal_add', 'memo_create',
    'learning_add', 'growth_add', 'project_add', 'config_info',
    'pomodoro_start', 'pomodoro_status', 'pomodoro_complete',
    'pomodoro_cancel', 'pomodoro_list', 'pomodoro_stats', 'pomodoro_report'];
  for (const name of expected) assert(names.includes(name), `exposes ${name}`);

  const add = await client.callTool({ name: 'task_add', arguments: { title: 'Smoke test task', priority: 'P1' } });
  assert(!add.isError, 'task_add succeeds');

  const list = await client.callTool({ name: 'task_list', arguments: { status: 'all' } });
  assert(list.content[0].text.includes('Smoke test task'), 'task_list returns the added task');

  const learn = await client.callTool({ name: 'learning_add', arguments: { title: 'AZ-104', goal: 'Pass cert', target_date: '2026-09-01' } });
  assert(!learn.isError && learn.content[0].text.includes('learning'), 'learning_add creates a frontmatter note');

  const cfg = await client.callTool({ name: 'config_info', arguments: {} });
  assert(cfg.content[0].text.includes('partition'), 'config_info returns resolved paths');

  const pomoStart = await client.callTool({ name: 'pomodoro_start', arguments: { type: 'focus', minutes: 25, force: true } });
  assert(!pomoStart.isError, 'pomodoro_start begins a session');

  const pomoStatus = await client.callTool({ name: 'pomodoro_status', arguments: {} });
  assert(!pomoStatus.isError && pomoStatus.content[0].text.includes('remainingSec'), 'pomodoro_status reports live timing');

  const pomoComplete = await client.callTool({ name: 'pomodoro_complete', arguments: { notes: 'smoke' } });
  assert(!pomoComplete.isError && pomoComplete.content[0].text.includes('completed'), 'pomodoro_complete logs the session');

  const pomoReport = await client.callTool({ name: 'pomodoro_report', arguments: { period: 'all', groupBy: 'day' } });
  assert(!pomoReport.isError && pomoReport.content[0].text.includes('completionRate') && pomoReport.content[0].text.includes('groups'), 'pomodoro_report returns grouped productivity data');

  await client.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('\n😺 MCP smoke test complete.');
})().catch((err) => {
  console.error('Smoke test failed:', err.message);
  process.exit(1);
});
