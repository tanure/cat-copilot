#!/usr/bin/env node

/**
 * Claude Code Adapter for CatPilot
 * Implements CatPilot tools for Claude Code AI client
 * Reuses cli-utils for config loading and file I/O
 */

import * as cliUtils from '../../lib/cli-utils.js';
import * as pomodoro from '../../lib/pomodoro.js';
import fs from 'fs';
import path from 'path';

/**
 * Tool handlers - implement CatPilot workflows
 * Each handler receives params and returns {success, data|error}
 */

async function list_tasks(params = {}) {
  try {
    const config = cliUtils.loadConfig();
    const tasksPath = cliUtils.resolveFilePath('tasks', config);
    const content = cliUtils.readFileOrCreate(tasksPath);
    const tasks = cliUtils.parseTasksTable(content);

    const status = params.status || 'all';
    const filtered = status === 'all'
      ? tasks
      : tasks.filter(t => t.status.toLowerCase() === status.toLowerCase());

    return {
      success: true,
      data: filtered,
      path: tasksPath,
      count: filtered.length
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
      status: 'Open',
      title: params.title,
      dueDate: params.due || '',
      priority: params.priority || '',
      tags: params.tags || '',
      context: params.context || ''
    };

    tasks.push(newTask);
    const newContent = cliUtils.formatTasksTable(tasks);
    cliUtils.ensureDir(path.dirname(tasksPath));
    fs.writeFileSync(tasksPath, newContent, 'utf8');

    return {
      success: true,
      data: newTask,
      path: tasksPath
    };
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

/**
 * Tool dispatcher
 * Maps tool names to handler functions
 */
async function handleToolCall(toolName, params) {
  const tools = {
    list_tasks,
    add_task,
    complete_task,
    remove_task,
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
    pomodoro_stats
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
  complete_task,
  remove_task,
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
  handleToolCall
};
