#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import * as cliUtils from './cli-utils.js';

/**
 * TUI Data Layer - State management for interactive use
 * Provides mutable state management on top of cli-utils file I/O
 */

class TUIState {
  constructor(projectRoot = process.cwd()) {
    this.projectRoot = projectRoot;
    this.config = null;
    this.tasks = [];
    this.journalEntries = [];
    this.memos = [];
    this.currentScreen = 'tasks'; // tasks, journal, memo, milestone
    this.selectedIndex = 0;
    this.editMode = false;
  }

  /**
   * Initialize state by loading config and data
   */
  initialize() {
    try {
      this.config = cliUtils.loadConfig(this.projectRoot);
      this.loadTasks();
      this.loadJournal();
      this.loadMemos();
      return true;
    } catch (err) {
      console.error(`❌ Init error: ${err.message}`);
      return false;
    }
  }

  /**
   * Load tasks from file
   */
  loadTasks() {
    try {
      const tasksPath = cliUtils.resolveFilePath('tasks', this.config, this.projectRoot);
      const content = cliUtils.readFileOrCreate(tasksPath);
      this.tasks = cliUtils.parseTasksTable(content);
    } catch (err) {
      this.tasks = [];
    }
  }

  /**
   * Save tasks to file
   */
  saveTasks() {
    try {
      const tasksPath = cliUtils.resolveFilePath('tasks', this.config, this.projectRoot);
      const content = cliUtils.formatTasksTable(this.tasks);
      cliUtils.ensureDir(path.dirname(tasksPath));
      fs.writeFileSync(tasksPath, content, 'utf8');
    } catch (err) {
      console.error(`❌ Save error: ${err.message}`);
    }
  }

  /**
   * Add new task
   */
  addTask(title, options = {}) {
    const newTask = {
      id: cliUtils.getNextTaskId(this.tasks),
      status: 'Open',
      title,
      dueDate: options.due || '',
      priority: options.priority || '',
      tags: options.tags || '',
      context: options.context || ''
    };
    this.tasks.push(newTask);
    this.saveTasks();
    return newTask;
  }

  /**
   * Update task
   */
  updateTask(id, updates) {
    const task = this.tasks.find(t => t.id === id);
    if (task) {
      Object.assign(task, updates);
      this.saveTasks();
    }
    return task;
  }

  /**
   * Remove task
   */
  removeTask(id) {
    const index = this.tasks.findIndex(t => t.id === id);
    if (index !== -1) {
      this.tasks.splice(index, 1);
      this.saveTasks();
      return true;
    }
    return false;
  }

  /**
   * Get filtered tasks
   */
  getFilteredTasks(status = 'all') {
    if (status === 'all') return this.tasks;
    return this.tasks.filter(t => t.status.toLowerCase() === status.toLowerCase());
  }

  /**
   * Load journal
   */
  loadJournal() {
    try {
      const journalPath = cliUtils.resolveFilePath('journal', this.config, this.projectRoot);
      const content = cliUtils.readFileOrCreate(journalPath);
      this.journalEntries = cliUtils.parseJournalEntries(content);
    } catch (err) {
      this.journalEntries = [];
    }
  }

  /**
   * Save journal
   */
  saveJournal() {
    try {
      const journalPath = cliUtils.resolveFilePath('journal', this.config, this.projectRoot);
      const content = cliUtils.formatJournalEntries(this.journalEntries);
      cliUtils.ensureDir(path.dirname(journalPath));
      fs.writeFileSync(journalPath, content, 'utf8');
    } catch (err) {
      console.error(`❌ Save error: ${err.message}`);
    }
  }

  /**
   * Add journal entry for today
   */
  addJournalEntry(text) {
    const today = new Date().toISOString().split('T')[0];
    const existing = this.journalEntries.find(e => e.date === today);

    if (existing) {
      existing.text += `\n${text}`;
    } else {
      this.journalEntries.push({
        date: today,
        text
      });
    }

    this.saveJournal();
  }

  /**
   * Load memos
   */
  loadMemos() {
    try {
      const memoDir = cliUtils.resolveFilePath('memos', this.config, this.projectRoot);
      const memoFiles = cliUtils.listMemos(memoDir);
      this.memos = memoFiles;
    } catch (err) {
      this.memos = [];
    }
  }

  /**
   * Create memo
   */
  createMemo(title, content = '') {
    try {
      const memoDir = cliUtils.resolveFilePath('memos', this.config, this.projectRoot);
      const filename = cliUtils.createMemoFilename(title);
      const memoPath = path.join(memoDir, filename);

      cliUtils.writeMemo(memoPath, title, content || 'Add your memo content here.');
      this.loadMemos();
      return filename;
    } catch (err) {
      console.error(`❌ Memo error: ${err.message}`);
      return null;
    }
  }

  /**
   * Read memo
   */
  readMemo(filename) {
    try {
      const memoDir = cliUtils.resolveFilePath('memos', this.config, this.projectRoot);
      const memoPath = path.join(memoDir, filename);
      return cliUtils.readMemo(memoPath);
    } catch (err) {
      console.error(`❌ Read error: ${err.message}`);
      return null;
    }
  }

  /**
   * Navigate screen
   */
  switchScreen(screen) {
    this.currentScreen = screen;
    this.selectedIndex = 0;
  }

  /**
   * Navigation
   */
  moveSelection(direction) {
    const items = this.getCurrentItems();
    if (direction === 'down') {
      this.selectedIndex = Math.min(this.selectedIndex + 1, items.length - 1);
    } else if (direction === 'up') {
      this.selectedIndex = Math.max(this.selectedIndex - 1, 0);
    }
  }

  /**
   * Get current items based on screen
   */
  getCurrentItems() {
    switch (this.currentScreen) {
      case 'tasks':
        return this.getFilteredTasks('all');
      case 'journal':
        return this.journalEntries;
      case 'memo':
        return this.memos;
      default:
        return [];
    }
  }

  /**
   * Get selected item
   */
  getSelectedItem() {
    const items = this.getCurrentItems();
    return items[this.selectedIndex] || null;
  }
}

export { TUIState };
