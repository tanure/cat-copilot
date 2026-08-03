#!/usr/bin/env node

/**
 * Gemini CLI Adapter for CatPilot
 * Implements CatPilot tools for Gemini AI client
 * 
 * This is a stub implementation. Actual implementation would follow same pattern as Claude Code adapter,
 * reusing cli-utils for file I/O and config management.
 * 
 * Note: Gemini tool format differs from Claude (uses different property names and types).
 * See gemini-tools.json for the tool definitions in Gemini's format.
 */

import * as cliUtils from '../../lib/cli-utils.js';
import * as eisen from '../../lib/eisenhower.js';
import * as core from '../claude-code/tools.js';
import fs from 'fs';
import path from 'path';

/** Wrap a core (Claude) tool result into the Gemini `{success, result}` shape. */
function fromCore(result, key = 'data') {
  if (!result || result.success === false) return { success: false, error: result?.error || 'unknown error' };
  const { success, data, ...rest } = result;
  return { success: true, result: { [key]: data, ...rest } };
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

/**
 * Gemini tool handlers
 * Each handler receives params and returns {success, result|error}
 */

async function catpilot_list_tasks(params = {}) {
  try {
    const config = cliUtils.loadConfig();
    const tasksPath = cliUtils.resolveFilePath('tasks', config);
    const content = cliUtils.readFileOrCreate(tasksPath);
    const tasks = cliUtils.parseTasksTable(content);

    const status = params.status || 'all';
    let filtered = status === 'all'
      ? tasks
      : tasks.filter(t => t.status.toLowerCase() === status.toLowerCase());

    filtered = filtered.map(t => ({
      ...t,
      smart: eisen.normalizeSmart(t.smart),
      eisenhower: eisen.classifyTask(t),
      smartScore: eisen.smartScore(t)
    }));
    if (params.quadrant) {
      const q = eisen.quadrantByKey(params.quadrant);
      if (!q) return { success: false, error: `Unknown quadrant "${params.quadrant}". Use q1, q2, q3 or q4.` };
      filtered = filtered.filter(t => t.eisenhower.quadrant === q.key);
    }

    return {
      success: true,
      result: {
        tasks: filtered,
        path: tasksPath,
        count: filtered.length
      }
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function catpilot_add_task(params) {
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
      context: params.context || '',
      project: params.project || '',
      smart: eisen.normalizeSmart(smartFromParams(params))
    };

    tasks.push(newTask);
    const newContent = cliUtils.formatTasksTable(tasks);
    cliUtils.ensureDir(path.dirname(tasksPath));
    fs.writeFileSync(tasksPath, newContent, 'utf8');

    return {
      success: true,
      result: {
        task: { ...newTask, eisenhower: eisen.classifyTask(newTask), smartScore: eisen.smartScore(newTask) },
        coaching: eisen.smartNudge(newTask) || null,
        path: tasksPath,
        message: `Task #${newTask.id} added`
      }
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/** Set or clear SMART fields / Eisenhower axes on an existing task. */
async function catpilot_set_task_smart(params = {}) {
  return fromCore(await core.set_task_smart(params), 'task');
}

/** Tasks grouped into the four Eisenhower quadrants. */
async function catpilot_task_matrix(params = {}) {
  const r = await core.task_matrix(params);
  if (!r || r.success === false) return { success: false, error: r?.error || 'unknown error' };
  return { success: true, result: { ...r.data } };
}

/** Ranked "what to do next" list. */
async function catpilot_task_focus(params = {}) {
  const r = await core.task_focus(params);
  if (!r || r.success === false) return { success: false, error: r?.error || 'unknown error' };
  return { success: true, result: { ...r.data } };
}

/** Move open tasks from earlier periods into the current one. */
async function catpilot_task_carry(params = {}) {
  const r = await core.task_carry(params);
  if (!r || r.success === false) return { success: false, error: r?.error || 'unknown error' };
  return { success: true, result: { ...r.data } };
}

async function catpilot_complete_task(params) {
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
      result: {
        task,
        message: `Task #${params.id} marked as Done`
      }
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function catpilot_add_journal(params) {
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
      result: {
        date: today,
        path: journalPath,
        message: 'Journal entry added'
      }
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function catpilot_list_journal(params = {}) {
  try {
    const config = cliUtils.loadConfig();
    const journalPath = cliUtils.resolveFilePath('journal', config);
    const content = cliUtils.readFileOrCreate(journalPath);
    const entries = cliUtils.parseJournalEntries(content);

    const days = parseInt(params.days || 7, 10);
    const recent = entries.slice(-days);

    return {
      success: true,
      result: {
        entries: recent,
        path: journalPath,
        count: recent.length
      }
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function catpilot_create_memo(params) {
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
      result: {
        filename,
        title: params.title,
        path: memoPath,
        message: 'Memo created'
      }
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function catpilot_list_memos(params = {}) {
  try {
    const config = cliUtils.loadConfig();
    const memoDir = cliUtils.resolveFilePath('memos', config);
    const memos = cliUtils.listMemos(memoDir);

    return {
      success: true,
      result: {
        memos,
        path: memoDir,
        count: memos.length
      }
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Tool dispatcher for Gemini
 */
async function handleToolCall(toolName, params) {
  const tools = {
    catpilot_list_tasks,
    catpilot_add_task,
    catpilot_set_task_smart,
    catpilot_task_matrix,
    catpilot_task_focus,
    catpilot_task_carry,
    catpilot_complete_task,
    catpilot_add_journal,
    catpilot_list_journal,
    catpilot_create_memo,
    catpilot_list_memos
  };

  const handler = tools[toolName];
  if (!handler) {
    return {
      success: false,
      error: `Unknown tool: ${toolName}`
    };
  }

  return await handler(params);
}
export {
  catpilot_list_tasks,
  catpilot_add_task,
  catpilot_set_task_smart,
  catpilot_task_matrix,
  catpilot_task_focus,
  catpilot_task_carry,
  catpilot_complete_task,
  catpilot_add_journal,
  catpilot_list_journal,
  catpilot_create_memo,
  catpilot_list_memos,
  handleToolCall
};
