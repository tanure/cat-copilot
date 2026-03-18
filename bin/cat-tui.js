#!/usr/bin/env node

import React from 'react';
import { render, Box, Text } from 'ink';
import { TUIState } from '../lib/tui-data.js';
import {
  Header,
  TaskList,
  Dashboard,
  StatusBar
} from '../lib/tui.js';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

/**
 * CatPilot TUI - Terminal User Interface
 * Built with Ink + React for interactive browsing and editing
 */

class CatPilotApp extends React.Component {
  constructor(props) {
    super(props);

    this.state = {
      tuiState: null,
      status: 'ℹ️ Initializing...',
      statusType: 'info',
      loading: true
    };

    this.tui = new TUIState();
  }

  componentDidMount() {
    // Initialize TUI state
    const initialized = this.tui.initialize();

    if (!initialized) {
      this.setState({
        status: '❌ Failed to load config. Run: cat-pilot setup init',
        statusType: 'error',
        loading: false
      });
      return;
    }

    this.setState({
      tuiState: this.tui,
      status: '✅ Ready | ↑ ↓: navigate | a: add | d: delete | e: edit | ESC: exit',
      statusType: 'success',
      loading: false
    });

    // Handle keyboard input
    this.setupKeyboardHandlers();
  }

  setupKeyboardHandlers() {
    // Note: Full keyboard handling requires additional setup with stdin
    // This is a placeholder for the implementation
  }

  handleKeyPress(key) {
    if (key === 'escape' || key === 'q') {
      process.exit(0);
    }

    if (key === 'up') {
      this.tui.moveSelection('up');
    } else if (key === 'down') {
      this.tui.moveSelection('down');
    } else if (key === 'a') {
      // Add new item
      this.setState({
        status: '✏️ Add mode (not fully implemented in TUI yet)',
        statusType: 'warning'
      });
    } else if (key === 'd') {
      // Delete item
      const item = this.tui.getSelectedItem();
      if (item && this.tui.currentScreen === 'tasks') {
        this.tui.removeTask(item.id);
        this.setState({
          status: `✅ Deleted task #${item.id}`,
          statusType: 'success'
        });
      }
    }

    this.forceUpdate();
  }

  renderTasksScreen() {
    const tasks = this.tui.getFilteredTasks('all');

    return React.createElement(
      Box,
      { flexDirection: 'column' },
      React.createElement(
        Text,
        { color: 'dim' },
        `📊 Tasks: ${tasks.length} total`
      ),
      tasks.length > 0
        ? React.createElement(TaskList, {
          tasks,
          selectedIndex: this.tui.selectedIndex
        })
        : React.createElement(
          Text,
          { dimColor: true },
          '(No tasks yet. Press "a" to add one.)'
        )
    );
  }

  renderJournalScreen() {
    const entries = this.tui.journalEntries;

    return React.createElement(
      Box,
      { flexDirection: 'column' },
      React.createElement(
        Text,
        { color: 'dim' },
        `📝 Journal entries: ${entries.length} total`
      ),
      entries.length > 0
        ? entries.slice(-5).map((e, idx) =>
          React.createElement(Text, { key: e.date }, `  📅 ${e.date}: ${e.text.substring(0, 50)}...`)
        )
        : React.createElement(
          Text,
          { dimColor: true },
          '(No journal entries yet.)'
        )
    );
  }

  renderMemoScreen() {
    const memos = this.tui.memos;

    return React.createElement(
      Box,
      { flexDirection: 'column' },
      React.createElement(
        Text,
        { color: 'dim' },
        `🧠 Memos: ${memos.length} total`
      ),
      memos.length > 0
        ? memos.slice(0, 10).map((m) =>
          React.createElement(Text, { key: m }, `  📄 ${m}`)
        )
        : React.createElement(
          Text,
          { dimColor: true },
          '(No memos yet.)'
        )
    );
  }

  renderCurrentScreen() {
    switch (this.tui.currentScreen) {
      case 'tasks':
        return this.renderTasksScreen();
      case 'journal':
        return this.renderJournalScreen();
      case 'memo':
        return this.renderMemoScreen();
      default:
        return this.renderTasksScreen();
    }
  }

  render() {
    if (this.state.loading) {
      return React.createElement(
        Box,
        { padding: 1 },
        React.createElement(
          Text,
          { color: 'yellow' },
          '⏳ Loading CatPilot...'
        )
      );
    }

    if (!this.state.tuiState) {
      return React.createElement(
        Box,
        { padding: 1, flexDirection: 'column' },
        React.createElement(
          Text,
          { color: 'red', bold: true },
          '❌ CatPilot TUI Error'
        ),
        React.createElement(
          Text,
          {},
          this.state.status
        )
      );
    }

    return React.createElement(
      Dashboard,
      {
        title: 'CatPilot · Terminal Dashboard',
        status: this.state.status
      },
      this.renderCurrentScreen()
    );
  }
}

// Entry point
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

if (process.argv[1] === __filename) {
  try {
    const app = React.createElement(CatPilotApp);
    render(app, {
      exitOnCtrlC: true
    });
  } catch (err) {
    console.error('❌ TUI Error:', err.message);
    process.exit(1);
  }
}

export { CatPilotApp };
