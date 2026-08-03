#!/usr/bin/env node

/**
 * Claude Code Adapter for CatPilot
 * Implements CatPilot tools for Claude Code AI client
 * Reuses cli-utils for config loading and file I/O
 */

import * as cliUtils from '../../lib/cli-utils.js';
import * as pomodoro from '../../lib/pomodoro.js';
import * as eisen from '../../lib/eisenhower.js';
import fs from 'fs';
import path from 'path';

const TASK_STATUSES = ['Open', 'In Progress', 'Blocked', 'Done'];
function normalizeTaskStatus(value, fallback = 'Open') {
  if (value === undefined || value === null || value === '') return fallback;
  const match = TASK_STATUSES.find(s => s.toLowerCase() === String(value).trim().toLowerCase());
  if (!match) throw new Error(`Invalid status "${value}". Use one of: ${TASK_STATUSES.join(', ')}`);
  return match;
}

/** Extract SMART fields from a tool payload (only keys that were provided). */
function smartFromParams(params = {}) {
  const out = {};
  ['goal', 'measure', 'why', 'steps'].forEach(k => {
    if (params[k] !== undefined) out[k] = params[k];
  });
  if (params.importance !== undefined) out.importance = eisen.normalizeAxis(params.importance);
  if (params.urgency !== undefined) out.urgency = eisen.normalizeAxis(params.urgency);
  return out;
}

/** Decorate a task with its Eisenhower classification and SMART score. */
function decorateTask(task) {
  return {
    ...task,
    smart: eisen.normalizeSmart(task.smart),
    eisenhower: eisen.classifyTask(task),
    smartScore: eisen.smartScore(task)
  };
}

/** Load + parse the tasks file once, returning the path alongside. */
function readTasks() {
  const config = cliUtils.loadConfig();
  const tasksPath = cliUtils.resolveFilePath('tasks', config);
  const tasks = cliUtils.parseTasksTable(cliUtils.readFileOrCreate(tasksPath));
  return { tasksPath, tasks };
}

/**
 * Tool handlers - implement CatPilot workflows
 * Each handler receives params and returns {success, data|error}
 */

/**
 * Open tasks left behind in an earlier partition.
 *
 * Returns null when there is nothing to report, so the common case adds no
 * noise to the tool payload. Never throws: a broken older file must not take
 * down a plain task listing.
 */
function strandedSummary(config) {
  try {
    const groups = cliUtils.findStrandedTasks(config);
    if (!groups.length) return null;
    return {
      total: groups.reduce((n, g) => n + g.tasks.length, 0),
      partitions: groups.map(g => g.partition),
      current: cliUtils.getPartitionFolder(config.storage.partitioning),
      hint: 'These tasks are open but filed under an earlier period. Use task_carry to move them into the current one.'
    };
  } catch {
    return null;
  }
}

async function list_tasks(params = {}) {
  try {
    const config = cliUtils.loadConfig();
    const tasksPath = cliUtils.resolveFilePath('tasks', config);
    const content = cliUtils.readFileOrCreate(tasksPath);
    const tasks = cliUtils.parseTasksTable(content);

    const status = params.status || 'all';
    let filtered = status === 'all'
      ? tasks
      : tasks.filter(t => t.status.toLowerCase() === status.toLowerCase());

    filtered = filtered.map(decorateTask);
    if (params.quadrant) {
      const q = eisen.quadrantByKey(params.quadrant);
      if (!q) return { success: false, error: `Unknown quadrant "${params.quadrant}". Use q1, q2, q3 or q4.` };
      filtered = filtered.filter(t => t.eisenhower.quadrant === q.key);
    }

    return {
      success: true,
      data: filtered,
      path: tasksPath,
      count: filtered.length,
      // Surfaced on every list so the agent can answer "where are my tasks?"
      // without the user having to know that storage is partitioned by period.
      stranded: strandedSummary(config)
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function add_task(params) {
  try {
    if (!params.title) {
      return { success: false, error: 'title is required' };
    }

    const config = cliUtils.loadConfig();
    const tasksPath = cliUtils.resolveFilePath('tasks', config);
    const content = cliUtils.readFileOrCreate(tasksPath);
    const tasks = cliUtils.parseTasksTable(content);

    const newTask = {
      id: cliUtils.getNextTaskId(tasks),
      status: normalizeTaskStatus(params.status),
      title: params.title,
      dueDate: params.due || '',
      priority: params.priority || '',
      tags: params.tags || '',
      context: params.context || '',
      project: params.project || '',
      smart: eisen.normalizeSmart(smartFromParams(params))
    };

    tasks.push(newTask);
    const newContent = cliUtils.formatTasksTable(tasks);
    cliUtils.ensureDir(path.dirname(tasksPath));
    fs.writeFileSync(tasksPath, newContent, 'utf8');

    const decorated = decorateTask(newTask);
    return {
      success: true,
      data: decorated,
      coaching: eisen.smartNudge(newTask) || null,
      path: tasksPath
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Set or clear the SMART fields / Eisenhower axes on an existing task.
 * Only the keys present in `params` are touched; pass an empty string to clear.
 */
async function set_task_smart(params = {}) {
  try {
    if (params.id === undefined) return { success: false, error: 'id is required' };
    const { tasksPath, tasks } = readTasks();
    const task = tasks.find(t => t.id === parseInt(params.id, 10));
    if (!task) return { success: false, error: `Task #${params.id} not found` };

    task.smart = eisen.normalizeSmart({ ...eisen.normalizeSmart(task.smart), ...smartFromParams(params) });
    if (params.due !== undefined) task.dueDate = params.due;

    fs.writeFileSync(tasksPath, cliUtils.formatTasksTable(tasks), 'utf8');
    return {
      success: true,
      data: decorateTask(task),
      coaching: eisen.smartNudge(task) || null,
      path: tasksPath
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/** Build the full Eisenhower matrix, optionally narrowed to one quadrant. */
async function task_matrix(params = {}) {
  try {
    const { tasksPath, tasks } = readTasks();
    const includeDone = params.includeDone === true || String(params.status || '').toLowerCase() === 'all';
    const matrix = eisen.buildMatrix(tasks, { includeDone });
    let quadrants = matrix.quadrants;
    if (params.quadrant) {
      const q = eisen.quadrantByKey(params.quadrant);
      if (!q) return { success: false, error: `Unknown quadrant "${params.quadrant}". Use q1, q2, q3 or q4.` };
      quadrants = quadrants.filter(x => x.key === q.key);
    }
    return {
      success: true,
      data: { ...matrix, quadrants, insights: eisen.matrixInsights(tasks) },
      path: tasksPath
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/** Ranked "what should I do next" list with a reason per task. */
async function task_focus(params = {}) {
  try {
    const { tasksPath, tasks } = readTasks();
    const limit = params.limit === undefined ? 5 : Math.max(1, parseInt(params.limit, 10) || 5);
    const focus = eisen.focusOrder(tasks, { limit }).map(t => ({
      ...t,
      smartScore: eisen.smartScore(t),
      nudge: eisen.smartNudge(t) || null
    }));
    return {
      success: true,
      data: { focus, insights: eisen.matrixInsights(tasks) },
      count: focus.length,
      path: tasksPath
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function task_carry(params = {}) {
  try {
    const config = cliUtils.loadConfig();
    const dryRun = params.dryRun === true || params.dry_run === true;
    const ids = Array.isArray(params.ids) && params.ids.length
      ? params.ids.map(n => parseInt(n, 10)).filter(n => !isNaN(n))
      : null;
    const stranded = cliUtils.findStrandedTasks(config);
    if (!stranded.length) {
      return { success: true, data: { moved: [], from: [], to: cliUtils.getPartitionFolder(config.storage.partitioning), dryRun }, count: 0 };
    }
    const result = cliUtils.carryForwardTasks(config, { dryRun, ids });
    return { success: true, data: result, count: result.moved.length };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function complete_task(params) {
  try {
    if (params.id === undefined) {
      return { success: false, error: 'id is required' };
    }

    const config = cliUtils.loadConfig();
    const tasksPath = cliUtils.resolveFilePath('tasks', config);
    const content = cliUtils.readFileOrCreate(tasksPath);
    const tasks = cliUtils.parseTasksTable(content);

    const task = tasks.find(t => t.id === parseInt(params.id, 10));
    if (!task) {
      return { success: false, error: `Task #${params.id} not found` };
    }

    task.status = 'Done';
    const newContent = cliUtils.formatTasksTable(tasks);
    fs.writeFileSync(tasksPath, newContent, 'utf8');

    return {
      success: true,
      data: task,
      message: `Task #${params.id} marked as Done`
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function set_task_status(params) {
  try {
    if (params.id === undefined) {
      return { success: false, error: 'id is required' };
    }
    const status = normalizeTaskStatus(params.status, undefined);
    if (!status) {
      return { success: false, error: 'status is required' };
    }

    const config = cliUtils.loadConfig();
    const tasksPath = cliUtils.resolveFilePath('tasks', config);
    const content = cliUtils.readFileOrCreate(tasksPath);
    const tasks = cliUtils.parseTasksTable(content);

    const task = tasks.find(t => t.id === parseInt(params.id, 10));
    if (!task) {
      return { success: false, error: `Task #${params.id} not found` };
    }

    task.status = status;
    const newContent = cliUtils.formatTasksTable(tasks);
    fs.writeFileSync(tasksPath, newContent, 'utf8');

    return {
      success: true,
      data: task,
      message: `Task #${params.id} status set to ${status}`
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function remove_task(params) {
  try {
    if (params.id === undefined) {
      return { success: false, error: 'id is required' };
    }

    const config = cliUtils.loadConfig();
    const tasksPath = cliUtils.resolveFilePath('tasks', config);
    const content = cliUtils.readFileOrCreate(tasksPath);
    const tasks = cliUtils.parseTasksTable(content);

    const index = tasks.findIndex(t => t.id === parseInt(params.id, 10));
    if (index === -1) {
      return { success: false, error: `Task #${params.id} not found` };
    }

    const removed = tasks[index];
    tasks.splice(index, 1);
    const newContent = cliUtils.formatTasksTable(tasks);
    fs.writeFileSync(tasksPath, newContent, 'utf8');

    return {
      success: true,
      data: removed,
      message: `Task #${params.id} removed`
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ---------------------------------------------------------------------------
// Task progress log (dated comments)
// ---------------------------------------------------------------------------

function loadTasksForComment(id) {
  const config = cliUtils.loadConfig();
  const tasksPath = cliUtils.resolveFilePath('tasks', config);
  const content = cliUtils.readFileOrCreate(tasksPath);
  const tasks = cliUtils.parseTasksTable(content);
  const task = tasks.find(t => t.id === parseInt(id, 10));
  return { tasksPath, tasks, task };
}

async function add_task_comment(params = {}) {
  try {
    if (params.id === undefined) return { success: false, error: 'id is required' };
    const text = (params.text || '').trim();
    if (!text) return { success: false, error: 'text is required' };

    const { tasksPath, tasks, task } = loadTasksForComment(params.id);
    if (!task) return { success: false, error: `Task #${params.id} not found` };

    const comment = { date: params.date || cliUtils.taskCommentStamp(), text };
    if (!Array.isArray(task.log)) task.log = [];
    task.log.push(comment);
    fs.writeFileSync(tasksPath, cliUtils.formatTasksTable(tasks), 'utf8');

    return { success: true, data: comment, message: `Comment added to task #${params.id}` };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function list_task_comments(params = {}) {
  try {
    if (params.id === undefined) return { success: false, error: 'id is required' };
    const { task } = loadTasksForComment(params.id);
    if (!task) return { success: false, error: `Task #${params.id} not found` };
    return { success: true, count: (task.log || []).length, comments: task.log || [] };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function edit_task_comment(params = {}) {
  try {
    if (params.id === undefined) return { success: false, error: 'id is required' };
    if (params.index === undefined) return { success: false, error: 'index is required' };
    const text = (params.text || '').trim();
    if (!text) return { success: false, error: 'text is required' };

    const { tasksPath, tasks, task } = loadTasksForComment(params.id);
    if (!task) return { success: false, error: `Task #${params.id} not found` };
    const i = parseInt(params.index, 10);
    if (!Array.isArray(task.log) || !task.log[i]) return { success: false, error: `Comment #${i} not found on task #${params.id}` };

    task.log[i].text = text;
    if (params.date) task.log[i].date = params.date;
    fs.writeFileSync(tasksPath, cliUtils.formatTasksTable(tasks), 'utf8');

    return { success: true, data: task.log[i], message: `Comment #${i} updated on task #${params.id}` };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function remove_task_comment(params = {}) {
  try {
    if (params.id === undefined) return { success: false, error: 'id is required' };
    if (params.index === undefined) return { success: false, error: 'index is required' };

    const { tasksPath, tasks, task } = loadTasksForComment(params.id);
    if (!task) return { success: false, error: `Task #${params.id} not found` };
    const i = parseInt(params.index, 10);
    if (!Array.isArray(task.log) || !task.log[i]) return { success: false, error: `Comment #${i} not found on task #${params.id}` };

    const [removed] = task.log.splice(i, 1);
    fs.writeFileSync(tasksPath, cliUtils.formatTasksTable(tasks), 'utf8');

    return { success: true, data: removed, message: `Comment #${i} removed from task #${params.id}` };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function add_journal_entry(params) {
  try {
    if (!params.text) {
      return { success: false, error: 'text is required' };
    }

    const config = cliUtils.loadConfig();
    const journalPath = cliUtils.resolveFilePath('journal', config);
    const content = cliUtils.readFileOrCreate(journalPath);

    const newContent = cliUtils.appendJournalEntry(content, params.text);
    cliUtils.ensureDir(path.dirname(journalPath));
    fs.writeFileSync(journalPath, newContent, 'utf8');

    const today = new Date().toISOString().split('T')[0];
    return {
      success: true,
      date: today,
      message: 'Journal entry added'
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function list_journal(params = {}) {
  try {
    const config = cliUtils.loadConfig();
    const journalPath = cliUtils.resolveFilePath('journal', config);
    const content = cliUtils.readFileOrCreate(journalPath);
    const entries = cliUtils.parseJournalEntries(content);

    const days = parseInt(params.days || 7, 10);
    const recent = entries.slice(-days);

    return {
      success: true,
      data: recent,
      path: journalPath,
      count: recent.length
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function create_memo(params) {
  try {
    if (!params.title) {
      return { success: false, error: 'title is required' };
    }

    const config = cliUtils.loadConfig();
    const memoDir = cliUtils.resolveFilePath('memos', config);
    const filename = cliUtils.createMemoFilename(params.title);
    const memoPath = path.join(memoDir, filename);

    const content = params.content || 'Add your memo content here.';
    cliUtils.writeMemo(memoPath, params.title, content);

    return {
      success: true,
      data: {
        filename,
        title: params.title,
        path: memoPath
      }
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function list_memos(params = {}) {
  try {
    const config = cliUtils.loadConfig();
    const memoDir = cliUtils.resolveFilePath('memos', config);
    const memos = cliUtils.listMemos(memoDir);

    return {
      success: true,
      data: memos,
      path: memoDir,
      count: memos.length
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function read_memo(params) {
  try {
    if (!params.filename) {
      return { success: false, error: 'filename is required' };
    }

    const config = cliUtils.loadConfig();
    const memoDir = cliUtils.resolveFilePath('memos', config);
    const memoPath = path.join(memoDir, params.filename);

    // Security: Prevent path traversal
    if (!memoPath.startsWith(path.resolve(memoDir))) {
      return { success: false, error: 'Invalid memo path' };
    }

    const memo = cliUtils.readMemo(memoPath);
    return {
      success: true,
      data: memo,
      path: memoPath
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Resolve an optional task reference (numeric id or title) into a display label
 * like "#7 Review issues". Falls back to the raw input if not found.
 */
function resolveTaskLabel(taskRef) {
  if (taskRef === undefined || taskRef === null || String(taskRef).trim() === '') return '';
  const raw = String(taskRef).trim();
  try {
    const config = cliUtils.loadConfig();
    const tasksPath = cliUtils.resolveFilePath('tasks', config);
    const content = cliUtils.readFileOrCreate(tasksPath);
    const tasks = cliUtils.parseTasksTable(content);
    const idMatch = raw.replace(/^#/, '');
    let found = null;
    if (/^\d+$/.test(idMatch)) {
      found = tasks.find(t => t.id === parseInt(idMatch, 10));
    }
    if (!found) {
      found = tasks.find(t => t.title && t.title.toLowerCase() === raw.toLowerCase());
    }
    if (found) return `#${found.id} ${found.title}`;
  } catch {
    /* config may be missing; just use the raw label */
  }
  return raw;
}

async function pomodoro_start(params = {}) {
  try {
    const task = resolveTaskLabel(params.task);
    const result = pomodoro.start({ ...params, task }, process.cwd());
    return { success: true, data: result.active, path: result.path };
  } catch (err) {
    return { success: false, error: err.message, active: err.active || undefined };
  }
}

async function pomodoro_status() {
  try {
    const result = pomodoro.status(process.cwd());
    return { success: true, data: result.active, path: result.path };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function pomodoro_complete(params = {}) {
  try {
    const result = pomodoro.complete(params, process.cwd());
    return { success: true, data: result.record, path: result.path };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function pomodoro_cancel(params = {}) {
  try {
    const result = pomodoro.cancel(params, process.cwd());
    return { success: true, data: result.record, path: result.path };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function pomodoro_list(params = {}) {
  try {
    const result = pomodoro.list(params, process.cwd());
    return { success: true, data: result.data, path: result.path, count: result.count };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function pomodoro_stats(params = {}) {
  try {
    const data = pomodoro.stats(params, process.cwd());
    return { success: true, data };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function pomodoro_report(params = {}) {
  try {
    const data = pomodoro.report(params, process.cwd());
    return { success: true, data };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Tool dispatcher
 * Maps tool names to handler functions
 */
async function handleToolCall(toolName, params) {
  const tools = {
    list_tasks,
    add_task,
    set_task_smart,
    task_matrix,
    task_focus,
    task_carry,
    complete_task,
    set_task_status,
    remove_task,
    add_task_comment,
    list_task_comments,
    edit_task_comment,
    remove_task_comment,
    add_journal_entry,
    list_journal,
    create_memo,
    list_memos,
    read_memo,
    pomodoro_start,
    pomodoro_status,
    pomodoro_complete,
    pomodoro_cancel,
    pomodoro_list,
    pomodoro_stats,
    pomodoro_report
  };

  const handler = tools[toolName];
  if (!handler) {
    return { success: false, error: `Unknown tool: ${toolName}` };
  }

  return await handler(params);
}
export {
  list_tasks,
  add_task,
  set_task_smart,
  task_matrix,
  task_focus,
  task_carry,
  complete_task,
  set_task_status,
  remove_task,
  add_task_comment,
  list_task_comments,
  edit_task_comment,
  remove_task_comment,
  add_journal_entry,
  list_journal,
  create_memo,
  list_memos,
  read_memo,
  pomodoro_start,
  pomodoro_status,
  pomodoro_complete,
  pomodoro_cancel,
  pomodoro_list,
  pomodoro_stats,
  pomodoro_report,
  handleToolCall
};
