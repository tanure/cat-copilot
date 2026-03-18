# Multi-Client Implementation Guide

This guide explains how to implement CatPilot data layer for new AI clients (Claude Code, Gemini CLI, etc.). The goal is to use the same `data/config.json` and file structures across all clients.

## Architecture Overview

CatPilot uses a **config-driven, file-based storage model**:

1. **Single config file**: `data/config.json` specifies storage location and partitioning
2. **Shared file formats**: All clients read/write to the same markdown tables and entries
3. **Independent implementations**: Each client implements its own tool definitions and handlers
4. **Zero migration**: All clients work with existing user data as-is

## Data Model

### Configuration (`data/config.json`)

```json
{
  "version": 1,
  "storage": {
    "root": "data",
    "partitioning": "month",
    "allowExternalPaths": true,
    "files": {
      "tasks": "tasks.md",
      "journal": "journal.md",
      "milestones": "milestones.md",
      "memos": "memos"
    }
  },
  "migration": {
    "mode": "move"
  }
}
```

### File Structures

#### Tasks File (`<storage.root>/<partition>/tasks.md`)

```markdown
## Open Tasks

| ID | Status | Title | Due Date | Priority | Tags | Context |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Open | Fix bug #123 | 2026-03-25 | P1 | bug,urgent | API endpoint |
| 2 | Open | Review PR | 2026-03-20 | P2 | review | Feature branch |

## Completed Tasks

| ID | Status | Title | Due Date | Priority | Tags | Context |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | Done | Deploy v0.1.8 | 2026-03-15 | P0 | release | Production |
```

#### Journal File (`<storage.root>/<partition>/journal.md`)

```markdown
### 2026-03-18

Had a productive morning on the API refactor. Blocked by DB schema changes.

### 2026-03-17

Shipped v0.1.8. Collected user feedback on CLI.
```

#### Memos Directory (`<storage.root>/<partition>/memos/`)

Files named: `YYYY-MM-DD_<slug>.md`

```
data/2026-03/memos/2026-03-18_team-standup.md
data/2026-03/memos/2026-03-17_architecture-notes.md
```

Content format:
```markdown
# Team Standup

- Frontend team shipped new dashboard
- Backend team on API refactor
- QA blocked on test data setup
```

#### Milestones File (same as tasks structure)

```markdown
## Planned Milestones

| ID | Name | Target Date | Status | Notes |
| --- | --- | --- | --- | --- |
| 1 | Q2 Planning | 2026-03-31 | Planned | Internal workshop |

## In Progress

| ID | Name | Target Date | Status | Notes |
| --- | --- | --- | --- | --- |
| 2 | API v2 | 2026-04-15 | In Progress | On schedule |

## Done

| ID | Name | Target Date | Status | Notes |
| --- | --- | --- | --- | --- |
| 0 | v0.1.8 Release | 2026-03-15 | Done | All features shipped |
```

## Implementation Steps

### 1. Load Configuration

Every tool must start by loading `data/config.json`:

```javascript
// Pseudocode
function loadConfig(projectPath) {
  const configPath = `${projectPath}/data/config.json`;
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  
  // Validate required fields
  if (!config.version || !config.storage.root || !config.storage.partitioning) {
    throw new Error('Invalid config');
  }
  
  return config;
}
```

### 2. Resolve File Paths

Use partitioning mode to determine folder structure:

```javascript
// Pseudocode
function resolveFilePath(type, config, projectPath) {
  const partition = getPartitionFolder(config.storage.partitioning);
  // Types: 'tasks', 'journal', 'milestones', 'memos'
  
  if (type === 'memos') {
    return `${projectPath}/${config.storage.root}/${partition}/memos`;
  }
  
  return `${projectPath}/${config.storage.root}/${partition}/${config.storage.files[type]}`;
}

function getPartitionFolder(mode) {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const date = String(now.getDate()).padStart(2, '0');
  
  if (mode === 'day') {
    return `${year}/${year}-${month}/${year}-${month}-${date}`;
  } else if (mode === 'week') {
    const week = getISOWeek(now);
    return `${year}/W${String(week).padStart(2, '0')}`;
  } else {
    return `${year}/${year}-${month}`;
  }
}

function getISOWeek(date) {
  // Implementation: ISO 8601 week number calculation
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}
```

### 3. Parse Markdown Tables (Tasks, Milestones)

```javascript
// Pseudocode
function parseTasksTable(fileContent) {
  const tasks = [];
  const lines = fileContent.split('\n');
  let inTable = false;
  
  for (const line of lines) {
    if (line.includes('## Open Tasks') || line.includes('## Completed Tasks')) {
      inTable = true;
      continue;
    }
    
    if (line.match(/^##\s/) && inTable) {
      inTable = false;
      continue;
    }
    
    if (inTable && line.includes('|') && !line.match(/^[\s\-|]+$/)) {
      const cells = line.split('|').map(c => c.trim()).filter(c => c);
      if (cells.length >= 7) {
        tasks.push({
          id: parseInt(cells[0], 10),
          status: cells[1],
          title: cells[2],
          dueDate: cells[3],
          priority: cells[4],
          tags: cells[5],
          context: cells[6]
        });
      }
    }
  }
  
  return tasks;
}

function formatTasksTable(tasks) {
  let content = '';
  
  const openTasks = tasks.filter(t => t.status === 'Open');
  if (openTasks.length > 0) {
    content += '## Open Tasks\n\n';
    content += '| ID | Status | Title | Due Date | Priority | Tags | Context |\n';
    content += '| --- | --- | --- | --- | --- | --- | --- |\n';
    openTasks.forEach(t => {
      content += `| ${t.id} | ${t.status} | ${t.title} | ${t.dueDate} | ${t.priority} | ${t.tags} | ${t.context} |\n`;
    });
  }
  
  return content;
}
```

### 4. Parse Journal (Date-keyed entries)

```javascript
// Pseudocode
function parseJournalEntries(fileContent) {
  const entries = [];
  const lines = fileContent.split('\n');
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

function formatJournalEntries(entries) {
  return entries.map(e => `### ${e.date}\n\n${e.text}`).join('\n\n');
}

function appendJournalEntry(fileContent, text) {
  const today = new Date().toISOString().split('T')[0];
  const heading = `### ${today}`;
  
  if (fileContent.includes(heading)) {
    return fileContent.replace(heading, `${heading}\n\n${text}`);
  }
  
  return fileContent ? `${fileContent}\n\n${heading}\n\n${text}` : `${heading}\n\n${text}`;
}
```

### 5. Memo File Handling

```javascript
// Pseudocode
function listMemos(memoDir) {
  return fs.readdirSync(memoDir)
    .filter(f => f.endsWith('.md'))
    .sort()
    .reverse();
}

function createMemoFilename(title) {
  const today = new Date().toISOString().split('T')[0];
  const slug = title
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .substring(0, 50);
  return `${today}_${slug}.md`;
}

function readMemo(memoPath) {
  const content = fs.readFileSync(memoPath, 'utf8');
  const lines = content.split('\n');
  const title = lines[0].replace(/^#\s+/, '').trim();
  const body = lines.slice(2).join('\n').trim();
  
  return { title, content: body };
}

function writeMemo(memoPath, title, content) {
  const fullContent = `# ${title}\n\n${content}`;
  fs.writeFileSync(memoPath, fullContent, 'utf8');
}
```

## Error Handling

All tools should gracefully handle:

- **Missing config**: Suggest running setup
- **Invalid config**: Report validation errors
- **File not found**: Create file with default structure
- **File I/O errors**: Report permission or disk issues
- **Path traversal**: Validate paths don't escape storage root

## Example: Claude Code Adapter

```javascript
// adapters/claude-code/tools.js
const cliUtils = require('../../lib/cli-utils');

async function listTasks(params) {
  const config = cliUtils.loadConfig();
  const tasksPath = cliUtils.resolveFilePath('tasks', config);
  const content = cliUtils.readFileOrCreate(tasksPath);
  const tasks = cliUtils.parseTasksTable(content);
  
  return {
    success: true,
    data: tasks,
    path: tasksPath
  };
}

async function addTask(params) {
  const { title, due, priority } = params;
  const config = cliUtils.loadConfig();
  const tasksPath = cliUtils.resolveFilePath('tasks', config);
  const content = cliUtils.readFileOrCreate(tasksPath);
  const tasks = cliUtils.parseTasksTable(content);
  
  const newTask = {
    id: cliUtils.getNextTaskId(tasks),
    status: 'Open',
    title,
    dueDate: due || '',
    priority: priority || '',
    tags: '',
    context: ''
  };
  
  tasks.push(newTask);
  const newContent = cliUtils.formatTasksTable(tasks);
  fs.writeFileSync(tasksPath, newContent, 'utf8');
  
  return {
    success: true,
    task: newTask,
    path: tasksPath
  };
}

module.exports = {
  listTasks,
  addTask
  // ... other tools
};
```

## Testing Cross-Client Consistency

1. **Single-language test**: Add task in CLI, verify file exists with correct structure
2. **Cross-language test**: Add in CLI → read via Claude adapter → verify same record
3. **Concurrent usage**: Open task in editor while reading via Claude tool
4. **Data format invariance**: Verify markdown tables remain identical format
5. **Config validation**: Ensure invalid config is rejected by all clients

## Migration Path

When implementing for a new client:

1. Load and validate config (no setup needed if config exists)
2. Resolve paths using partition algorithm
3. Implement file parsing for your data type
4. Implement file writing to preserve format
5. Test with existing user data
6. Document any client-specific limitations

---

**See also**: [COMPATIBILITY.md](./COMPATIBILITY.md) for backward compatibility guarantees.
