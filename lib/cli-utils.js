#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import os from 'os';

/**
 * CLI Utilities for CatPilot
 * Shared functions for config loading, file resolution, and data parsing
 */

// ============================================================================
// CONFIG LOADING
// ============================================================================

/**
 * Load and validate config from data/config.json
 * @param {string} projectRoot - Project root directory (default: process.cwd())
 * @returns {object} Parsed config object
 * @throws {Error} If config is missing or invalid
 */
function loadConfig(projectRoot = process.cwd()) {
  const configPath = path.join(projectRoot, 'data', 'config.json');

  if (!fs.existsSync(configPath)) {
    throw new Error(
      `❌ Config not found at ${configPath}\n` +
      `Run 'cat-pilot setup init' to create config first.`
    );
  }

  try {
    const content = fs.readFileSync(configPath, 'utf8');
    const config = JSON.parse(content);
    validateConfig(config);
    return config;
  } catch (err) {
    throw new Error(`❌ Invalid config at ${configPath}: ${err.message}`);
  }
}

/**
 * Validate config structure
 * @param {object} config - Config object to validate
 * @throws {Error} If config is invalid
 */
function validateConfig(config) {
  const required = ['version', 'storage', 'migration'];
  const storageRequired = ['root', 'partitioning', 'files'];
  const filesRequired = ['tasks', 'journal', 'milestones', 'memos'];

  for (const key of required) {
    if (!(key in config)) {
      throw new Error(`Missing required key: ${key}`);
    }
  }

  for (const key of storageRequired) {
    if (!(key in config.storage)) {
      throw new Error(`Missing required key: storage.${key}`);
    }
  }

  for (const key of filesRequired) {
    if (!(key in config.storage.files)) {
      throw new Error(`Missing required key: storage.files.${key}`);
    }
  }

  const validPartitioning = ['day', 'week', 'month'];
  if (!validPartitioning.includes(config.storage.partitioning)) {
    throw new Error(
      `Invalid partitioning: ${config.storage.partitioning}. Must be one of: ${validPartitioning.join(', ')}`
    );
  }
}

/**
 * Load template config (used for setup)
 * @returns {object} Template config object
 */
function loadTemplateConfig() {
  return {
    version: 1,
    storage: {
      root: 'data',
      partitioning: 'month',
      allowExternalPaths: true,
      files: {
        tasks: 'tasks.md',
        journal: 'journal.md',
        milestones: 'milestones.md',
        memos: 'memos'
      }
    },
    migration: {
      mode: 'move'
    }
  };
}

// ============================================================================
// FILE PATH RESOLUTION
// ============================================================================

/**
 * Get current partition folder name based on config
 * @param {string} partitioning - Partitioning mode ('day', 'week', 'month')
 * @returns {string} Partition folder name
 */
function getPartitionFolder(partitioning = 'month') {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const date = String(now.getDate()).padStart(2, '0');

  if (partitioning === 'day') {
    return `${year}/${year}-${month}/${year}-${month}-${date}`;
  } else if (partitioning === 'week') {
    const weekNum = getISOWeek(now);
    return `${year}/W${String(weekNum).padStart(2, '0')}`;
  } else {
    return `${year}/${year}-${month}`;
  }
}

/**
 * Calculate ISO week number
 * @param {Date} date - Date to calculate week for
 * @returns {number} ISO week number
 */
function getISOWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

/**
 * Resolve file path for a given type
 * @param {string} type - File type ('tasks', 'journal', 'milestones', 'memos')
 * @param {object} config - Config object
 * @param {string} projectRoot - Project root directory
 * @returns {string} Absolute path to file
 */
function resolveFilePath(type, config, projectRoot = process.cwd()) {
  const partition = getPartitionFolder(config.storage.partitioning);
  const storageRoot = path.resolve(projectRoot, config.storage.root);
  const fileName = config.storage.files[type];

  if (!fileName) {
    throw new Error(`Unknown file type: ${type}`);
  }

  if (type === 'memos') {
    return path.join(storageRoot, partition, fileName);
  }

  return path.join(storageRoot, partition, fileName);
}

/**
 * Create directory if it doesn't exist
 * @param {string} dirPath - Directory path
 */
function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

// ============================================================================
// FILE I/O
// ============================================================================

/**
 * Read file, create if missing
 * @param {string} filePath - File path
 * @param {string} defaultContent - Default content if file missing
 * @returns {string} File content
 */
function readFileOrCreate(filePath, defaultContent = '') {
  ensureDir(path.dirname(filePath));
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, defaultContent, 'utf8');
  }
  return fs.readFileSync(filePath, 'utf8');
}

// ============================================================================
// TASKS TABLE PARSING
// ============================================================================

/**
 * Parse tasks from markdown table
 * @param {string} content - File content
 * @returns {array} Array of task objects
 */
function parseTasksTable(content) {
  const lines = content.split('\n');
  const tasks = [];
  let inTable = false;
  let headerIndex = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Find "## Open Tasks" or "## Completed Tasks" heading
    if (line.match(/^##\s+(Open|Completed) Tasks$/)) {
      inTable = true;
      continue;
    }

    // Stop if we hit another section
    if (line.match(/^##\s/) && inTable) {
      inTable = false;
      continue;
    }

    if (!inTable) continue;

    // Skip separator and empty lines
    if (line.match(/^[\s\-|]+$/) || !line.trim()) continue;

    // Parse header row
    if (line.includes('|') && headerIndex === -1) {
      headerIndex = i;
      continue;
    }

    // Parse data rows
    if (line.includes('|') && headerIndex !== -1) {
      const cells = line.split('|').map(c => c.trim()).filter(c => c);

      if (cells.length >= 7) {
        tasks.push({
          id: parseInt(cells[0], 10) || 0,
          status: cells[1] || 'Open',
          title: cells[2] || '',
          dueDate: cells[3] || '',
          priority: cells[4] || '',
          tags: cells[5] || '',
          context: cells[6] || ''
        });
      }
    }
  }

  return tasks;
}

/**
 * Format tasks array back to markdown table
 * @param {array} tasks - Array of task objects
 * @returns {string} Markdown table content with headings
 */
function formatTasksTable(tasks) {
  const openTasks = tasks.filter(t => t.status === 'Open' || t.status === 'open');
  const doneTasks = tasks.filter(t => t.status === 'Done' || t.status === 'done');

  let content = '';

  if (openTasks.length > 0) {
    content += '## Open Tasks\n\n';
    content += '| ID | Status | Title | Due Date | Priority | Tags | Context |\n';
    content += '| --- | --- | --- | --- | --- | --- | --- |\n';
    openTasks.forEach(t => {
      content += `| ${t.id} | ${t.status} | ${t.title} | ${t.dueDate} | ${t.priority} | ${t.tags} | ${t.context} |\n`;
    });
    content += '\n';
  }

  if (doneTasks.length > 0) {
    content += '## Completed Tasks\n\n';
    content += '| ID | Status | Title | Due Date | Priority | Tags | Context |\n';
    content += '| --- | --- | --- | --- | --- | --- | --- |\n';
    doneTasks.forEach(t => {
      content += `| ${t.id} | ${t.status} | ${t.title} | ${t.dueDate} | ${t.priority} | ${t.tags} | ${t.context} |\n`;
    });
  }

  return content.trimEnd();
}

/**
 * Get next task ID
 * @param {array} tasks - Array of task objects
 * @returns {number} Next ID
 */
function getNextTaskId(tasks) {
  if (tasks.length === 0) return 1;
  return Math.max(...tasks.map(t => t.id || 0)) + 1;
}

// ============================================================================
// JOURNAL PARSING
// ============================================================================

/**
 * Parse journal entries from content
 * @param {string} content - File content
 * @returns {array} Array of journal entries with date headings
 */
function parseJournalEntries(content) {
  const lines = content.split('\n');
  const entries = [];
  let currentDate = null;
  let currentText = [];

  for (const line of lines) {
    if (line.match(/^###\s+\d{4}-\d{2}-\d{2}$/)) {
      if (currentDate) {
        entries.push({
          date: currentDate,
          text: currentText.join('\n').trim()
        });
      }
      currentDate = line.replace('### ', '').trim();
      currentText = [];
    } else if (currentDate) {
      currentText.push(line);
    }
  }

  if (currentDate) {
    entries.push({
      date: currentDate,
      text: currentText.join('\n').trim()
    });
  }

  return entries;
}

/**
 * Format journal entries back to content
 * @param {array} entries - Array of journal entries
 * @returns {string} Formatted journal content
 */
function formatJournalEntries(entries) {
  return entries.map(e => `### ${e.date}\n\n${e.text}`).join('\n\n');
}

/**
 * Append journal entry for today
 * @param {string} content - Existing journal content
 * @param {string} text - Entry text
 * @returns {string} Updated content
 */
function appendJournalEntry(content, text) {
  const today = new Date().toISOString().split('T')[0];
  const heading = `### ${today}`;
  const entry = `${heading}\n\n${text}`;

  if (content.includes(heading)) {
    return content.replace(heading, `${heading}\n\n${text}`);
  }

  return content ? `${content}\n\n${entry}` : entry;
}

// ============================================================================
// MEMOS HANDLING
// ============================================================================

/**
 * List all memos in directory
 * @param {string} memoDir - Memo directory path
 * @returns {array} Array of memo files (newest first)
 */
function listMemos(memoDir) {
  ensureDir(memoDir);
  if (!fs.existsSync(memoDir)) return [];

  return fs.readdirSync(memoDir)
    .filter(f => f.endsWith('.md'))
    .sort()
    .reverse();
}

/**
 * Create memo filename from title
 * @param {string} title - Memo title
 * @returns {string} Filename (YYYY-MM-DD_slug.md)
 */
function createMemoFilename(title) {
  const today = new Date().toISOString().split('T')[0];
  const slug = title
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .substring(0, 50);
  return `${today}_${slug}.md`;
}

/**
 * Read memo file
 * @param {string} memoPath - Path to memo file
 * @returns {object} {title, content}
 */
function readMemo(memoPath) {
  const content = fs.readFileSync(memoPath, 'utf8');
  const lines = content.split('\n');
  const titleLine = lines[0];
  const title = titleLine.replace(/^#\s+/, '').trim();
  const body = lines.slice(2).join('\n').trim();

  return { title, content: body };
}

/**
 * Write memo file
 * @param {string} memoPath - Path to memo file
 * @param {string} title - Memo title
 * @param {string} content - Memo content
 */
function writeMemo(memoPath, title, content) {
  ensureDir(path.dirname(memoPath));
  const fullContent = `# ${title}\n\n${content}`;
  fs.writeFileSync(memoPath, fullContent, 'utf8');
}

// ============================================================================
// EXPORTS
// ============================================================================
export {
  // Config
  loadConfig,
  validateConfig,
  loadTemplateConfig,

  // Path resolution
  getPartitionFolder,
  getISOWeek,
  resolveFilePath,
  ensureDir,

  // File I/O
  readFileOrCreate,

  // Tasks
  parseTasksTable,
  formatTasksTable,
  getNextTaskId,

  // Journal
  parseJournalEntries,
  formatJournalEntries,
  appendJournalEntry,

  // Memos
  listMemos,
  createMemoFilename,
  readMemo,
  writeMemo
};
