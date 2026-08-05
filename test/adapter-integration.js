#!/usr/bin/env node

/**
 * Adapter Integration Tests for CatPilot
 * Verifies Claude and Gemini adapters work with real data operations
 * 
 * Run: node test/adapter-integration.js
 */

import * as claudeTools from '../adapters/claude-code/tools.js';
import * as geminiTools from '../adapters/gemini-cli/tools.js';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');

// Isolate all writes to a throwaway temp config so tests never touch the real
// (Obsidian) vault. CATPILOT_CONFIG takes precedence over every other source.
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'catpilot-itest-'));
fs.mkdirSync(path.join(tmpRoot, 'data'), { recursive: true });
const tmpConfigPath = path.join(tmpRoot, 'data', 'config.json');
fs.writeFileSync(
  tmpConfigPath,
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
process.env.CATPILOT_CONFIG = tmpConfigPath;

// Test results tracking
const results = {
  claude: { passed: 0, failed: 0, errors: [] },
  gemini: { passed: 0, failed: 0, errors: [] }
};

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  dim: '\x1b[2m'
};

function log(color, msg) {
  console.log(`${colors[color]}${msg}${colors.reset}`);
}

function logTest(adapter, testName, passed, message = '') {
  const symbol = passed ? '✅' : '❌';
  const color = passed ? 'green' : 'red';
  log(color, `  ${symbol} ${adapter.toUpperCase()} → ${testName}`);
  if (message) log('dim', `     ${message}`);
  
  if (passed) {
    results[adapter].passed++;
  } else {
    results[adapter].failed++;
    results[adapter].errors.push(`${testName}: ${message}`);
  }
}

// ============================================================================
// CLAUDE ADAPTER TESTS
// ============================================================================

async function testClaudeAdapter() {
  log('blue', '\n📋 Testing Claude Code Adapter');
  
  // Test 1: list_tasks
  try {
    const taskResult = await claudeTools.list_tasks({ status: 'all' });
    logTest('claude', 'list_tasks', taskResult.success, 
      `Found ${taskResult.data?.length || 0} tasks`);
  } catch (err) {
    logTest('claude', 'list_tasks', false, err.message);
  }

  // Test 2: add_task
  try {
    const newTaskResult = await claudeTools.add_task({
      title: 'Test task from adapter',
      due: '2026-03-20',
      priority: 'P1'
    });
    logTest('claude', 'add_task', newTaskResult.success && newTaskResult.data?.id,
      `Created task #${newTaskResult.data?.id}`);
  } catch (err) {
    logTest('claude', 'add_task', false, err.message);
  }

  // Test 3: add_task validation
  try {
    const invalidResult = await claudeTools.add_task({});
    logTest('claude', 'add_task validation', !invalidResult.success,
      'Correctly rejected missing title');
  } catch (err) {
    logTest('claude', 'add_task validation', false, err.message);
  }

  // Test 3b: Blocked status round-trip (regression for the data-loss bug where
  // any status other than Open/Done was silently dropped on save).
  try {
    const added = await claudeTools.add_task({ title: 'Blocked task from adapter', status: 'Blocked' });
    const setRes = await claudeTools.set_task_status({ id: added.data?.id, status: 'Blocked' });
    const listRes = await claudeTools.list_tasks({ status: 'blocked' });
    const survived = listRes.data?.some(t => t.id === added.data?.id && t.status === 'Blocked');
    const ok = added.success && added.data?.status === 'Blocked' && setRes.success && survived;
    logTest('claude', 'blocked status round-trip', ok,
      ok ? `Task #${added.data?.id} persisted as Blocked` : 'Blocked task was dropped or miscounted');
  } catch (err) {
    logTest('claude', 'blocked status round-trip', false, err.message);
  }

  // Test 3c: set_task_status validation
  try {
    const bad = await claudeTools.set_task_status({ id: 999999, status: 'Nope' });
    logTest('claude', 'set_task_status validation', !bad.success,
      'Correctly rejected invalid status');
  } catch (err) {
    logTest('claude', 'set_task_status validation', false, err.message);
  }

  // Test 4: list_journal
  try {
    const journalResult = await claudeTools.list_journal({ days: 7 });
    logTest('claude', 'list_journal', journalResult.success,
      `Found ${journalResult.data?.length || 0} entries`);
  } catch (err) {
    logTest('claude', 'list_journal', false, err.message);
  }

  // Test 5: add_journal_entry
  try {
    const journalAddResult = await claudeTools.add_journal_entry({
      text: 'Integration test entry from Claude adapter'
    });
    logTest('claude', 'add_journal_entry', journalAddResult.success,
      `Added entry on ${journalAddResult.date}`);
  } catch (err) {
    logTest('claude', 'add_journal_entry', false, err.message);
  }

  // Test 6: list_memos
  try {
    const memoListResult = await claudeTools.list_memos();
    logTest('claude', 'list_memos', memoListResult.success,
      `Found ${memoListResult.data?.length || 0} memos`);
  } catch (err) {
    logTest('claude', 'list_memos', false, err.message);
  }

  // Test 7: create_memo
  try {
    const memoCreateResult = await claudeTools.create_memo({
      title: 'Integration Test Memo',
      content: 'This is a test memo from the Claude adapter.'
    });
    logTest('claude', 'create_memo', memoCreateResult.success && memoCreateResult.data?.filename,
      `Created ${memoCreateResult.data?.filename}`);
  } catch (err) {
    logTest('claude', 'create_memo', false, err.message);
  }

  // Test 8: handleToolCall dispatcher
  try {
    const dispatchResult = await claudeTools.handleToolCall('list_tasks', { status: 'all' });
    logTest('claude', 'handleToolCall dispatcher', dispatchResult.success,
      'Tool dispatcher working');
  } catch (err) {
    logTest('claude', 'handleToolCall dispatcher', false, err.message);
  }

  // Test 9: pomodoro start → status → complete
  try {
    const startRes = await claudeTools.pomodoro_start({ type: 'focus', minutes: 25, task: 'Test task from adapter', force: true });
    const statusRes = await claudeTools.pomodoro_status();
    const completeRes = await claudeTools.pomodoro_complete({ notes: 'integration test' });
    const ok = startRes.success && statusRes.success && statusRes.data?.remainingSec >= 0
      && completeRes.success && completeRes.data?.status === 'completed';
    logTest('claude', 'pomodoro start/status/complete', ok,
      `Logged session #${completeRes.data?.id} (${completeRes.data?.type})`);
  } catch (err) {
    logTest('claude', 'pomodoro start/status/complete', false, err.message);
  }

  // Test 10: pomodoro cancel + stats
  try {
    await claudeTools.pomodoro_start({ type: 'short-break', force: true });
    const cancelRes = await claudeTools.pomodoro_cancel({ notes: 'abandoned in test' });
    const statsRes = await claudeTools.pomodoro_stats({ period: 'all' });
    const ok = cancelRes.success && cancelRes.data?.status === 'abandoned'
      && statsRes.success && typeof statsRes.data?.completedSessions === 'number';
    logTest('claude', 'pomodoro cancel/stats', ok,
      `${statsRes.data?.completedSessions} completed, ${statsRes.data?.focusMinutes} focus min`);
  } catch (err) {
    logTest('claude', 'pomodoro cancel/stats', false, err.message);
  }

  // Test 11: pomodoro_report (grouped productivity)
  try {
    const repRes = await claudeTools.pomodoro_report({ period: 'all', groupBy: 'day' });
    const s = repRes.data?.summary;
    const ok = repRes.success && s && typeof s.completionRate === 'number'
      && typeof s.completedFocusSessions === 'number' && Array.isArray(repRes.data?.groups);
    logTest('claude', 'pomodoro report (by day)', ok,
      `${s?.totalSessions} sessions, ${Math.round((s?.completionRate || 0) * 100)}% completion, ${repRes.data?.groups?.length} group(s)`);
  } catch (err) {
    logTest('claude', 'pomodoro report (by day)', false, err.message);
  }

  // Test 12: SMART fields + Eisenhower classification
  try {
    const smart = await claudeTools.add_task({
      title: 'SMART adapter task', due: '2099-03-01', priority: 'P2',
      goal: 'Deliver the thing', measure: 'Dashboard shows green',
      why: 'Keeps the roadmap on track', steps: 'Plan -> build -> ship',
      importance: 'High', urgency: 'Low'
    });
    const ok = smart.success && smart.data?.smart?.goal === 'Deliver the thing'
      && smart.data?.eisenhower?.quadrant === 'q2' && smart.data?.smartScore?.score === 5;
    logTest('claude', 'add_task with SMART fields', ok,
      `SMART ${smart.data?.smartScore?.score}/5, ${smart.data?.eisenhower?.quadrant}`);

    const pinned = await claudeTools.set_task_smart({ id: smart.data?.id, urgency: 'High' });
    logTest('claude', 'set_task_smart re-classifies', pinned.success && pinned.data?.eisenhower?.quadrant === 'q1',
      `now ${pinned.data?.eisenhower?.quadrant} (${pinned.data?.eisenhower?.source})`);
  } catch (err) {
    logTest('claude', 'add_task with SMART fields', false, err.message);
  }

  // Test 13: matrix + focus
  try {
    const matrix = await claudeTools.task_matrix({ status: 'all' });
    logTest('claude', 'task_matrix', matrix.success && matrix.data?.quadrants?.length === 4,
      `${matrix.data?.quadrants?.length} quadrants, ${matrix.data?.insights?.hints?.length} hint(s)`);
    const focus = await claudeTools.task_focus({ limit: 3 });
    const ok = focus.success && Array.isArray(focus.data?.focus)
      && focus.data.focus.length <= 3 && focus.data.focus.every(t => t.focusReason);
    logTest('claude', 'task_focus', ok, `${focus.data?.focus?.length} ranked task(s)`);
  } catch (err) {
    logTest('claude', 'task_matrix / task_focus', false, err.message);
  }
}

// ============================================================================
// GEMINI ADAPTER TESTS
// ============================================================================

async function testGeminiAdapter() {
  log('blue', '\n📋 Testing Gemini CLI Adapter');
  
  // Test 1: list_tasks
  try {
    const taskResult = await geminiTools.catpilot_list_tasks({ status: 'all' });
    logTest('gemini', 'catpilot_list_tasks', taskResult.success,
      `Found ${taskResult.result?.tasks?.length || 0} tasks`);
  } catch (err) {
    logTest('gemini', 'catpilot_list_tasks', false, err.message);
  }

  // Test 2: add_task
  try {
    const newTaskResult = await geminiTools.catpilot_add_task({
      title: 'Test task from Gemini adapter',
      due: '2026-03-21',
      priority: 'P2'
    });
    logTest('gemini', 'catpilot_add_task', newTaskResult.success && newTaskResult.result?.task?.id,
      `Created task #${newTaskResult.result?.task?.id}`);
  } catch (err) {
    logTest('gemini', 'catpilot_add_task', false, err.message);
  }

  // Test 3: add_task validation
  try {
    const invalidResult = await geminiTools.catpilot_add_task({});
    logTest('gemini', 'catpilot_add_task validation', !invalidResult.success,
      'Correctly rejected missing title');
  } catch (err) {
    logTest('gemini', 'catpilot_add_task validation', false, err.message);
  }

  // Test 4: list_journal
  try {
    const journalResult = await geminiTools.catpilot_list_journal({ days: 7 });
    logTest('gemini', 'catpilot_list_journal', journalResult.success,
      `Found ${journalResult.result?.entries?.length || 0} entries`);
  } catch (err) {
    logTest('gemini', 'catpilot_list_journal', false, err.message);
  }

  // Test 5: add_journal
  try {
    const journalAddResult = await geminiTools.catpilot_add_journal({
      text: 'Integration test entry from Gemini adapter'
    });
    logTest('gemini', 'catpilot_add_journal', journalAddResult.success,
      `Added entry on ${journalAddResult.result?.date}`);
  } catch (err) {
    logTest('gemini', 'catpilot_add_journal', false, err.message);
  }

  // Test 6: list_memos
  try {
    const memoListResult = await geminiTools.catpilot_list_memos();
    logTest('gemini', 'catpilot_list_memos', memoListResult.success,
      `Found ${memoListResult.result?.memos?.length || 0} memos`);
  } catch (err) {
    logTest('gemini', 'catpilot_list_memos', false, err.message);
  }

  // Test 7: create_memo
  try {
    const memoCreateResult = await geminiTools.catpilot_create_memo({
      title: 'Integration Test Memo Gemini',
      content: 'This is a test memo from the Gemini adapter.'
    });
    logTest('gemini', 'catpilot_create_memo', memoCreateResult.success && memoCreateResult.result?.filename,
      `Created ${memoCreateResult.result?.filename}`);
  } catch (err) {
    logTest('gemini', 'catpilot_create_memo', false, err.message);
  }

  // Test 8: handleToolCall dispatcher
  try {
    const dispatchResult = await geminiTools.handleToolCall('catpilot_list_tasks', { status: 'all' });
    logTest('gemini', 'handleToolCall dispatcher', dispatchResult.success,
      'Tool dispatcher working');
  } catch (err) {
    logTest('gemini', 'handleToolCall dispatcher', false, err.message);
  }

  // Test 9: SMART fields + Eisenhower tools
  try {
    const smart = await geminiTools.catpilot_add_task({
      title: 'SMART task from Gemini adapter', due: '2099-03-01', priority: 'P2',
      goal: 'Deliver the thing', measure: 'Dashboard shows green',
      why: 'Keeps the roadmap on track', importance: 'High', urgency: 'Low'
    });
    const t = smart.result?.task;
    logTest('gemini', 'catpilot_add_task with SMART', smart.success && t?.smart?.goal === 'Deliver the thing' && t?.eisenhower?.quadrant === 'q2',
      `SMART ${t?.smartScore?.score}/5, ${t?.eisenhower?.quadrant}`);

    const pinned = await geminiTools.catpilot_set_task_smart({ id: t?.id, urgency: 'High' });
    logTest('gemini', 'catpilot_set_task_smart', pinned.success && pinned.result?.task?.eisenhower?.quadrant === 'q1',
      `now ${pinned.result?.task?.eisenhower?.quadrant}`);
  } catch (err) {
    logTest('gemini', 'catpilot_add_task with SMART', false, err.message);
  }

  // Test 10: matrix + focus
  try {
    const matrix = await geminiTools.catpilot_task_matrix({ status: 'all' });
    logTest('gemini', 'catpilot_task_matrix', matrix.success && matrix.result?.quadrants?.length === 4,
      `${matrix.result?.quadrants?.length} quadrants`);
    const focus = await geminiTools.catpilot_task_focus({ limit: 3 });
    logTest('gemini', 'catpilot_task_focus', focus.success && Array.isArray(focus.result?.focus),
      `${focus.result?.focus?.length} ranked task(s)`);
  } catch (err) {
    logTest('gemini', 'catpilot_task_matrix / catpilot_task_focus', false, err.message);
  }
}

// ============================================================================
// CARRY-FORWARD (cross-partition) TESTS
// ============================================================================

/**
 * Storage is partitioned by period, so open work left in a previous month is
 * invisible from the current one. These tests cover the detect-and-move path,
 * including that SMART details and the task log survive the trip.
 */
async function testCarryForward() {
  log('blue', '\n📦 Testing carry-forward across partitions');

  const cliUtils = await import('../lib/cli-utils.js');
  const utils = cliUtils.default || cliUtils;
  const config = utils.loadConfig();

  // Build a partition one month behind the current one and plant tasks in it.
  const current = utils.getPartitionFolder('month');
  const [year, ym] = current.split('/');
  const month = Number(ym.split('-')[1]);
  const prevDate = new Date(Date.UTC(Number(year), month - 2, 1));
  const prev = `${prevDate.getUTCFullYear()}/${prevDate.getUTCFullYear()}-${String(prevDate.getUTCMonth() + 1).padStart(2, '0')}`;
  const prevPath = utils.resolveFilePathInPartition('tasks', config, prev);

  fs.mkdirSync(path.dirname(prevPath), { recursive: true });
  fs.writeFileSync(prevPath, utils.formatTasksTable([
    {
      id: 901, status: 'Open', title: 'Stranded SMART task', dueDate: '2099-01-05',
      priority: 'P1', tags: 'carry', context: 'left behind', project: '',
      smart: { goal: 'Finish the migration', measure: 'All checks green', why: 'Unblocks Q3', steps: 'a -> b', importance: 'High', urgency: 'Low' },
      log: [{ date: '2099-01-01 09:00', text: 'kick-off' }]
    },
    { id: 902, status: 'Done', title: 'Already finished', dueDate: '', priority: 'Med', tags: '', context: '', project: '', smart: {}, log: [] }
  ]), 'utf8');

  try {
    const stranded = utils.findStrandedTasks(config);
    const group = stranded.find(g => g.partition === prev);
    logTest('claude', 'findStrandedTasks skips completed work', !!group && group.tasks.length === 1 && group.tasks[0].id === 901,
      `${group?.tasks.length} open task(s) found in ${prev}`);
  } catch (err) {
    logTest('claude', 'findStrandedTasks skips completed work', false, err.message);
  }

  try {
    const preview = await claudeTools.task_carry({ dryRun: true });
    const untouched = utils.parseTasksTable(fs.readFileSync(prevPath, 'utf8')).some(t => t.id === 901);
    logTest('claude', 'task_carry --dry-run writes nothing', preview.success && preview.data.moved.length >= 1 && untouched,
      `${preview.data?.moved?.length} would move, source still intact`);
  } catch (err) {
    logTest('claude', 'task_carry --dry-run writes nothing', false, err.message);
  }

  try {
    const res = await claudeTools.task_carry({});
    const carried = res.data.moved.find(t => t.title === 'Stranded SMART task');
    const now = utils.parseTasksTable(fs.readFileSync(utils.resolveFilePath('tasks', config), 'utf8')).find(t => t.title === 'Stranded SMART task');
    const left = utils.parseTasksTable(fs.readFileSync(prevPath, 'utf8'));

    logTest('claude', 'task_carry moves open tasks into the current period', res.success && !!now, `moved into ${res.data?.to}`);
    logTest('claude', 'task_carry preserves SMART details', now?.smart?.goal === 'Finish the migration' && now?.smart?.importance === 'High',
      `goal="${now?.smart?.goal}"`);
    logTest('claude', 'task_carry preserves and annotates the log',
      now?.log?.some(e => e.text === 'kick-off') && now?.log?.some(e => e.text.startsWith('Carried forward from')),
      `${now?.log?.length} log entries`);
    logTest('claude', 'task_carry leaves completed tasks behind',
      left.length === 1 && left[0].id === 902 && !left.some(t => t.id === 901),
      `${left.length} task(s) remain in ${prev}`);
    logTest('claude', 'task_carry is idempotent', (await claudeTools.task_carry({})).data.moved.length === 0,
      'second run moves nothing');
    logTest('claude', 'list_tasks stops reporting stranded work', (await claudeTools.list_tasks({ status: 'all' })).stranded === null,
      'stranded summary cleared');
    if (carried) log('dim', `     carried as #${carried.id}`);
  } catch (err) {
    logTest('claude', 'task_carry moves open tasks into the current period', false, err.message);
  }
}

// ============================================================================
// SUMMARY AND REPORTING
// ============================================================================

function printSummary() {
  log('blue', '\n═══════════════════════════════════════════════════════');
  log('blue', '📊 Integration Test Results');
  log('blue', '═══════════════════════════════════════════════════════');

  // Claude results
  log('yellow', '\nClaude Code Adapter:');
  log('green', `  ✅ Passed: ${results.claude.passed}`);
  log('red', `  ❌ Failed: ${results.claude.failed}`);
  if (results.claude.errors.length > 0) {
    log('red', '  Errors:');
    results.claude.errors.forEach(err => log('dim', `    - ${err}`));
  }

  // Gemini results
  log('yellow', '\nGemini CLI Adapter:');
  log('green', `  ✅ Passed: ${results.gemini.passed}`);
  log('red', `  ❌ Failed: ${results.gemini.failed}`);
  if (results.gemini.errors.length > 0) {
    log('red', '  Errors:');
    results.gemini.errors.forEach(err => log('dim', `    - ${err}`));
  }

  // Overall
  const totalPassed = results.claude.passed + results.gemini.passed;
  const totalFailed = results.claude.failed + results.gemini.failed;
  const total = totalPassed + totalFailed;

  log('blue', '\n═══════════════════════════════════════════════════════');
  log('yellow', `Overall: ${totalPassed}/${total} tests passed`);
  
  if (totalFailed === 0) {
    log('green', '✅ All adapter integration tests passed!');
  } else {
    log('red', `❌ ${totalFailed} tests failed`);
  }

  log('blue', '═══════════════════════════════════════════════════════\n');

  process.exit(totalFailed > 0 ? 1 : 0);
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  log('yellow', '\n🧪 CatPilot Adapter Integration Test Suite');
  log('dim', `Project root: ${projectRoot}\n`);

  try {
    await testClaudeAdapter();
    await testGeminiAdapter();
    await testCarryForward();
    printSummary();
  } catch (err) {
    log('red', `\n❌ Fatal error: ${err.message}`);
    process.exit(1);
  }
}

main();
