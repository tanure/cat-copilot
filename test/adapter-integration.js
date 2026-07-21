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
    printSummary();
  } catch (err) {
    log('red', `\n❌ Fatal error: ${err.message}`);
    process.exit(1);
  }
}

main();
