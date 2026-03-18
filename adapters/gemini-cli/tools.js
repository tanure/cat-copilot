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
import fs from 'fs';
import path from 'path';

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
    const filtered = status === 'all'
      ? tasks
      : tasks.filter(t => t.status.toLowerCase() === status.toLowerCase());

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
      context: params.context || ''
    };

    tasks.push(newTask);
    const newContent = cliUtils.formatTasksTable(tasks);
    cliUtils.ensureDir(path.dirname(tasksPath));
    fs.writeFileSync(tasksPath, newContent, 'utf8');

    return {
      success: true,
      result: {
        task: newTask,
        path: tasksPath,
        message: `Task #${newTask.id} added`
      }
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
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
  catpilot_complete_task,
  catpilot_add_journal,
  catpilot_list_journal,
  catpilot_create_memo,
  catpilot_list_memos,
  handleToolCall
};
