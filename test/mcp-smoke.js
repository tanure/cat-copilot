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
          knowledge: 'knowledge', achievements: 'achievements',
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

  const expected = ['task_add', 'task_list', 'task_set_status', 'journal_add', 'memo_create',
    'learning_add', 'growth_add', 'project_add', 'config_info',
    'kb_add', 'kb_list', 'kb_folders', 'kb_update', 'kb_remove',
    'learning_path_add', 'learning_path_list', 'learning_path_read',
    'learning_step_add', 'learning_step_update', 'learning_path_complete',
    'project_create', 'project_board', 'project_read', 'project_item_add',
    'project_item_update', 'project_complete', 'achievement_add', 'achievement_list',
    'pomodoro_start', 'pomodoro_status', 'pomodoro_complete',
    'pomodoro_cancel', 'pomodoro_list', 'pomodoro_stats', 'pomodoro_report'];
  for (const name of expected) assert(names.includes(name), `exposes ${name}`);

  const json = (res) => JSON.parse(res.content[0].text);

  const add = await client.callTool({ name: 'task_add', arguments: { title: 'Smoke test task', priority: 'P1' } });
  assert(!add.isError, 'task_add succeeds');

  const list = await client.callTool({ name: 'task_list', arguments: { status: 'all' } });
  assert(list.content[0].text.includes('Smoke test task'), 'task_list returns the added task');

  // Blocked status flows through task_set_status and survives a re-list (regression).
  const addBlocked = await client.callTool({ name: 'task_add', arguments: { title: 'Blocked smoke task', status: 'Blocked' } });
  assert(!addBlocked.isError && addBlocked.content[0].text.includes('Blocked'), 'task_add accepts Blocked status');
  const blockedList = await client.callTool({ name: 'task_list', arguments: { status: 'blocked' } });
  assert(blockedList.content[0].text.includes('Blocked smoke task'), 'task_list surfaces the Blocked task (not dropped)');
  const setStatus = await client.callTool({ name: 'task_set_status', arguments: { id: 1, status: 'Blocked' } });
  assert(!setStatus.isError && setStatus.content[0].text.includes('Blocked'), 'task_set_status updates status');

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

  // Knowledge Base: add with folder + tags, then confirm folders roll it up.
  const kbAdd = await client.callTool({ name: 'kb_add', arguments: { title: 'Redis eviction notes', folder: 'DevOps', tags: 'redis, cache', body: '# Redis\nLRU vs LFU' } });
  const kbDoc = json(kbAdd);
  assert(!kbAdd.isError && kbDoc.folder === 'DevOps' && kbDoc.tags.includes('redis'), 'kb_add stores folder + tags');
  const kbFolders = await client.callTool({ name: 'kb_folders', arguments: {} });
  const kbF = json(kbFolders);
  assert(kbF.folders.some(f => f.folder === 'DevOps') && kbF.tags.some(t => t.tag === 'redis' || t === 'redis' || (t.name === 'redis')), 'kb_folders reports the new folder + tag');

  // Learning path: seed steps, then completing every step auto-completes the path + records an achievement.
  const lpAdd = await client.callTool({ name: 'learning_path_add', arguments: { title: 'AZ-204 Prep', goal: 'Pass AZ-204', steps: ['Compute', 'Storage'] } });
  const lp = json(lpAdd);
  assert(!lpAdd.isError && lp.slug && lp.steps.length === 2 && lp.progress === 0, 'learning_path_add seeds ordered steps at 0% progress');
  // Partial progress + due + notes on a single step averages into the path.
  const lpPartial = json(await client.callTool({ name: 'learning_step_update', arguments: { slug: lp.slug, stepId: lp.steps[0].id, progress: 50, due: '2030-01-15', notes: 'Focus on ARM templates' } }));
  const s0 = lpPartial.steps.find((s) => s.id === lp.steps[0].id);
  assert(lpPartial.progress === 25, 'one step at 50% averages the path to 25%');
  assert(s0 && s0.progress === 50 && s0.due === '2030-01-15' && /ARM templates/.test(s0.notes || ''), 'step persists progress, due and notes');
  let lpState = lp;
  for (const step of lp.steps) {
    const upd = await client.callTool({ name: 'learning_step_update', arguments: { slug: lp.slug, stepId: step.id, status: 'Done' } });
    lpState = json(upd);
  }
  assert(lpState.progress === 100, 'completing all steps drives learning progress to 100%');
  const achList = await client.callTool({ name: 'achievement_list', arguments: { source_type: 'learning' } });
  const achs = json(achList);
  assert(Array.isArray(achs) ? achs.length >= 1 : (achs.achievements && achs.achievements.length >= 1), 'learning completion records an achievement');

  // Projects: create, add a requirement + task, confirm the dashboard rolls them up.
  const pjAdd = await client.callTool({ name: 'project_create', arguments: { title: 'Rabobank Portability', status: 'Active', summary: 'Account portability' } });
  const pj = json(pjAdd);
  assert(!pjAdd.isError && pj.slug, 'project_create returns a project dashboard');
  await client.callTool({ name: 'project_item_add', arguments: { slug: pj.slug, type: 'requirement', title: 'Gather requirements' } });
  const pjItem = await client.callTool({ name: 'project_item_add', arguments: { slug: pj.slug, type: 'task', title: 'Draft migration plan' } });
  const pjRead = await client.callTool({ name: 'project_read', arguments: { slug: pj.slug } });
  const pjr = json(pjRead);
  assert(pjr.requirements.length === 1 && pjr.tasks.length === 1, 'project_read rolls up requirements and tasks');
  // Task item partial progress (requirements are scope, excluded from progress).
  const taskId = pjr.tasks[0].id;
  const pjUpd = json(await client.callTool({ name: 'project_item_update', arguments: { slug: pj.slug, itemId: taskId, progress: 40, due: '2030-03-01', notes: 'Legal sign-off needed' } }));
  const t0 = pjUpd.tasks.find((t) => t.id === taskId);
  assert(t0 && t0.progress === 40 && t0.due === '2030-03-01' && /Legal sign-off/.test(t0.notes || ''), 'project item persists progress, due and notes');
  assert(pjUpd.progress === 40, 'project progress averages trackable items (requirements excluded)');

  await client.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('\n😺 MCP smoke test complete.');
})().catch((err) => {
  console.error('Smoke test failed:', err.message);
  process.exit(1);
});
