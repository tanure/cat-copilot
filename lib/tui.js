#!/usr/bin/env node

import React from 'react';
import { Box, Text } from 'ink';

/**
 * TUI Component Library - Reusable Ink components
 */

/**
 * Header component
 */
function Header({ title }) {
  return React.createElement(
    Box,
    { flexDirection: 'column', marginBottom: 1 },
    React.createElement(Text, { bold: true, color: 'cyan' }, `🐱 ${title}`),
    React.createElement(Text, { dimColor: true }, '─'.repeat(50))
  );
}

/**
 * Task item component
 */
function TaskItem({ task, isSelected }) {
  const status = task.status === 'Done' ? '✅' : '🟢';
  const highlight = isSelected ? '> ' : '  ';
  const dueStr = task.dueDate ? ` | Due: ${task.dueDate}` : '';
  const priStr = task.priority ? ` | ${task.priority}` : '';

  return React.createElement(
    Text,
    { color: isSelected ? 'yellow' : 'white' },
    `${highlight}${status} #${task.id} ${task.title}${dueStr}${priStr}`
  );
}

/**
 * Task list component
 */
function TaskList({ tasks, selectedIndex }) {
  return React.createElement(
    Box,
    { flexDirection: 'column' },
    tasks.map((task, idx) =>
      React.createElement(TaskItem, {
        key: task.id,
        task,
        isSelected: idx === selectedIndex
      })
    )
  );
}

/**
 * Journal entry component
 */
function JournalEntry({ entry, isSelected }) {
  const highlight = isSelected ? '> ' : '  ';
  const preview = entry.text.substring(0, 60).replace(/\n/g, ' ');

  return React.createElement(
    Text,
    { color: isSelected ? 'yellow' : 'white' },
    `${highlight}📝 ${entry.date} ${preview}${entry.text.length > 60 ? '...' : ''}`
  );
}

/**
 * Menu component
 */
function Menu({ items, selectedIndex }) {
  return React.createElement(
    Box,
    { flexDirection: 'column', marginTop: 1 },
    React.createElement(
      Text,
      { dimColor: true },
      'Navigation: ↑/↓ navigate | a: add | d: delete | e: edit | ESC: menu'
    )
  );
}

/**
 * Status bar component
 */
function StatusBar({ message, type = 'info' }) {
  const colors = {
    info: 'blue',
    success: 'green',
    error: 'red',
    warning: 'yellow'
  };

  const icons = {
    info: 'ℹ️',
    success: '✅',
    error: '❌',
    warning: '⚠️'
  };

  return React.createElement(
    Text,
    { color: colors[type] },
    `${icons[type]} ${message}`
  );
}

/**
 * Input prompt component
 */
function InputPrompt({ prompt, value, onChange }) {
  // Note: Ink has limited input support. This is a placeholder.
  return React.createElement(
    Box,
    { flexDirection: 'column' },
    React.createElement(Text, { bold: true }, prompt),
    React.createElement(Text, { color: 'cyan' }, `> ${value}`)
  );
}

/**
 * Dashboard layout
 */
function Dashboard({ title, children, status }) {
  return React.createElement(
    Box,
    { flexDirection: 'column', padding: 1 },
    React.createElement(Header, { title }),
    React.createElement(Box, { marginBottom: 1 }, children),
    status && React.createElement(StatusBar, { message: status }),
    React.createElement(Menu, {})
  );
}

export {
  Header,
  TaskItem,
  TaskList,
  JournalEntry,
  Menu,
  StatusBar,
  InputPrompt,
  Dashboard
};
