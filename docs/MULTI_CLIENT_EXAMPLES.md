# Multi-Client Usage Examples for CatPilot

This guide shows how to use CatPilot through different client interfaces: CLI, Claude adapter, and Gemini adapter.

## Table of Contents

1. [CLI Usage](#cli-usage)
2. [Claude Code Adapter Usage](#claude-code-adapter-usage)
3. [Gemini CLI Adapter Usage](#gemini-cli-adapter-usage)
4. [Cross-Client Workflows](#cross-client-workflows)
5. [Integration Patterns](#integration-patterns)

---

## CLI Usage

The CLI is the command-line interface for CatPilot. Install globally or run locally.

### Task Management

```bash
# Add a task
node bin/cat-cli.js task add "Review PR for project X" \
  --due 2026-03-25 \
  --priority P1 \
  --tags review,urgent \
  --context "Code review for new feature"

# List tasks
node bin/cat-cli.js task list                    # Open tasks
node bin/cat-cli.js task list --status all      # All tasks
node bin/cat-cli.js task list --status done     # Completed

# Mark task as done
node bin/cat-cli.js task complete 5

# Remove task
node bin/cat-cli.js task remove 5
```

### Journal Management

```bash
# Add journal entry
node bin/cat-cli.js journal add "Had productive meeting with team. Discussed roadmap."

# List recent entries
node bin/cat-cli.js journal list
```

### Memo Management

```bash
# Create memo
node bin/cat-cli.js memo create "Q1 Goals" \
  --content "- Complete CatPilot v1
- Improve documentation
- Set up CI/CD"

# List memos
node bin/cat-cli.js memo list
```

### Diagnostics

```bash
# Check system health
node bin/cat-cli.js doctor
# Output:
# 🩺 CatPilot Doctor
# 
# 📂 Workspace Configuration:
# ✅ config.json (/path/to/data/config.json)
# 
# 📦 Plugin Assets:
# ✅ plugin.json (/path/to/plugin.json)
# ✅ agents/ directory (/path/to/agents)
# ✅ skills/ directory (/path/to/skills)
```

### TUI (Terminal UI)

```bash
# Launch interactive dashboard
node bin/cat-tui.js

# Navigation:
# ↑/↓ - Navigate tasks
# a   - Add task
# d   - Delete task
# e   - Edit task
# ESC - Exit
```

---

## Claude Code Adapter Usage

The Claude adapter integrates CatPilot with Claude Code for AI-assisted task management.

### Setup

```javascript
import * as catpilot from './adapters/claude-code/tools.js';
```

### Task Operations

```javascript
// List all tasks
const allTasks = await catpilot.list_tasks({ status: 'all' });
console.log(allTasks);
// Output:
// {
//   success: true,
//   data: [
//     { id: 1, title: "Review PR", status: "Open", priority: "P1", ... },
//     { id: 2, title: "Fix bug", status: "Done", priority: "P2", ... }
//   ],
//   path: "/workspace/data/tasks.md",
//   count: 2
// }

// List only open tasks
const openTasks = await catpilot.list_tasks({ status: 'open' });

// Add new task
const newTask = await catpilot.add_task({
  title: "Implement new feature",
  due: "2026-03-28",
  priority: "P0",
  tags: "feature,backend",
  context: "High-priority feature for Q2 release"
});
console.log(`Created task #${newTask.data.id}`);
// Output: Created task #7

// Mark task as complete
const completed = await catpilot.complete_task({ id: 1 });
console.log(completed.message); // Task #1 marked as Done

// Remove task
const removed = await catpilot.remove_task({ id: 5 });
console.log(removed.message); // Task #5 removed
```

### Journal Operations

```javascript
// Add journal entry
const entry = await catpilot.add_journal_entry({
  text: "Completed Q1 planning. Team aligned on milestones."
});
console.log(`Entry added on ${entry.date}`);

// List recent entries (default: last 7 days)
const recent = await catpilot.list_journal({ days: 14 });
console.log(`Found ${recent.count} entries`);
recent.data.forEach(e => console.log(`${e.date}: ${e.text}`));
```

### Memo Operations

```javascript
// Create memo
const memo = await catpilot.create_memo({
  title: "Project Architecture",
  content: `# System Design

## Components
- Frontend: React + Vite
- Backend: Node.js + Express
- Database: PostgreSQL

## Data Flow
...`
});
console.log(`Memo created: ${memo.data.filename}`);

// List all memos
const memos = await catpilot.list_memos();
console.log(`Found ${memos.count} memos`);
memos.data.forEach(name => console.log(`  - ${name}`));

// Read specific memo
const memoContent = await catpilot.read_memo({
  filename: "project-architecture.md"
});
console.log(memoContent.data.title);
console.log(memoContent.data.content);
```

### Error Handling

```javascript
// Validation errors
const invalid = await catpilot.add_task({});
if (!invalid.success) {
  console.error(`Error: ${invalid.error}`); // Error: title is required
}

// Not found errors
const notFound = await catpilot.complete_task({ id: 999 });
if (!notFound.success) {
  console.error(`Error: ${notFound.error}`); // Error: Task #999 not found
}
```

---

## Gemini CLI Adapter Usage

The Gemini adapter provides tool integration for Gemini with CatPilot.

### Setup

```javascript
import * as catpilot from './adapters/gemini-cli/tools.js';
```

### Task Operations

```javascript
// List tasks
const result = await catpilot.catpilot_list_tasks({ status: 'all' });
if (result.success) {
  console.log(`Found ${result.result.count} tasks`);
  result.result.tasks.forEach(t => 
    console.log(`  #${t.id} [${t.status}] ${t.title}`)
  );
}

// Add task
const newTask = await catpilot.catpilot_add_task({
  title: "Update documentation",
  due: "2026-03-30",
  priority: "P2"
});
if (newTask.success) {
  console.log(newTask.result.message);
}

// Complete task
const completed = await catpilot.catpilot_complete_task({ id: 3 });
console.log(completed.result.message);
```

### Journal Operations

```javascript
// Add journal entry
const journal = await catpilot.catpilot_add_journal({
  text: "Deployed hotfix to production successfully."
});
console.log(journal.result.message);

// List journal entries
const entries = await catpilot.catpilot_list_journal({ days: 7 });
console.log(`Recent entries (${entries.result.count}):`);
entries.result.entries.forEach(e => 
  console.log(`  ${e.date}: ${e.text}`)
);
```

### Memo Operations

```javascript
// Create memo
const memo = await catpilot.catpilot_create_memo({
  title: "API Documentation",
  content: "## Endpoints\n\n### GET /api/tasks\n..."
});
console.log(memo.result.message);

// List memos
const memos = await catpilot.catpilot_list_memos();
console.log(`Memos (${memos.result.count}):`);
memos.result.memos.forEach(name => console.log(`  - ${name}`));
```

### Tool Dispatcher

```javascript
// Use handleToolCall for dynamic tool invocation
const result = await catpilot.handleToolCall('catpilot_list_tasks', {
  status: 'open'
});
```

---

## Cross-Client Workflows

### Workflow 1: Task Creation Across Clients

**Step 1:** Create via CLI
```bash
node bin/cat-cli.js task add "Design database schema" --priority P0
# Output: Task added to /path/to/data/tasks.md
#         📌 ID #8: Design database schema
```

**Step 2:** Verify via Claude adapter
```javascript
const tasks = await claudeTools.list_tasks({ status: 'all' });
// Finds: { id: 8, title: "Design database schema", status: "Open", priority: "P0" }
```

**Step 3:** Complete via Gemini adapter
```javascript
const result = await geminiTools.catpilot_complete_task({ id: 8 });
// result.success = true
```

**Step 4:** Verify via TUI
```bash
node bin/cat-tui.js
# Shows task #8 with ✅ status
```

### Workflow 2: Journal Entry From Claude, Read From CLI

**Step 1:** Add via Claude
```javascript
await claudeTools.add_journal_entry({
  text: "Prototype review with stakeholders - approved for beta"
});
```

**Step 2:** List via CLI
```bash
node bin/cat-cli.js journal list
# Shows recent entries including the Claude entry
```

### Workflow 3: Memo Creation & Reading

**Step 1:** Create via Gemini
```javascript
await geminiTools.catpilot_create_memo({
  title: "API Spec",
  content: "# REST API\n\n..."
});
```

**Step 2:** Read via Claude
```javascript
const memo = await claudeTools.read_memo({ 
  filename: "api-spec.md" 
});
console.log(memo.data.content);
```

**Step 3:** List from CLI
```bash
node bin/cat-cli.js memo list
```

---

## Integration Patterns

### Pattern 1: Batch Operations

```javascript
// Process multiple tasks with Claude adapter
const tasks = await claudeTools.list_tasks({ status: 'open' });

for (const task of tasks.data) {
  if (isHighPriority(task)) {
    await claudeTools.complete_task({ id: task.id });
  }
}

function isHighPriority(task) {
  return task.priority === 'P0' || task.priority === 'P1';
}
```

### Pattern 2: Error Recovery

```javascript
async function safeTaskAdd(title, options = {}) {
  try {
    const result = await claudeTools.add_task({
      title,
      ...options
    });
    
    if (!result.success) {
      console.error(`Failed: ${result.error}`);
      return null;
    }
    
    return result.data;
  } catch (err) {
    console.error(`Exception: ${err.message}`);
    return null;
  }
}

const task = await safeTaskAdd("New task");
```

### Pattern 3: Cross-Adapter Sync

```javascript
// Verify data consistency across adapters
async function verifyConsistency() {
  const claudeResult = await claudeTools.list_tasks({ status: 'all' });
  const geminiResult = await geminiTools.catpilot_list_tasks({ status: 'all' });
  
  const claudeIds = claudeResult.data.map(t => t.id).sort();
  const geminiIds = geminiResult.result.tasks.map(t => t.id).sort();
  
  const consistent = JSON.stringify(claudeIds) === JSON.stringify(geminiIds);
  console.log(`Consistency check: ${consistent ? '✅ PASS' : '❌ FAIL'}`);
  
  return consistent;
}
```

### Pattern 4: Response Mapping for Unified UI

```javascript
// Normalize adapter responses for display
function normalizeTaskResponse(adapterName, response) {
  if (adapterName === 'claude') {
    return {
      tasks: response.data,
      total: response.count,
      source: response.path
    };
  } else if (adapterName === 'gemini') {
    return {
      tasks: response.result.tasks,
      total: response.result.count,
      source: response.result.path
    };
  }
}

const claudeRes = await claudeTools.list_tasks({ status: 'all' });
const normalized = normalizeTaskResponse('claude', claudeRes);
console.log(`${normalized.total} tasks from ${normalized.source}`);
```

---

## Best Practices

### When Using CLI
- ✅ Use for interactive task management
- ✅ Use for diagnostics (`doctor` command)
- ✅ Suitable for scripting via bash/shell

### When Using Claude Adapter
- ✅ Use within Claude Code projects
- ✅ Leverage AI for task summarization/analysis
- ✅ Build intelligent workflows
- ✅ Direct access to individual operations

### When Using Gemini Adapter
- ✅ Use within Gemini projects
- ✅ Tool-based workflow integration
- ✅ Consistent with Gemini's tool format
- ✅ Batch operations with handleToolCall

### General Guidelines
- Always validate config (`doctor` command)
- Handle errors gracefully
- Data isolated by workspace (respect config.json)
- Use consistent date formats (YYYY-MM-DD)
- Test cross-client consistency before production

---

## Troubleshooting

### "Config not found" Error

```bash
# Verify config exists
node bin/cat-cli.js doctor

# If missing, initialize:
node bin/cat-cli.js setup init
```

### Task/Memo Not Found in Another Client

```bash
# Verify data consistency
node bin/cat-cli.js task list

# Check workspace paths:
node bin/cat-cli.js doctor
```

### Adapter Import Errors

```bash
# Verify ESM compatibility
node -e "import('./adapters/claude-code/tools.js').then(m => console.log('OK')).catch(e => console.error(e.message))"
```

---

## Summary

CatPilot supports three integrated client interfaces, all backed by the same file-based storage. Choose based on your use case:

| Use Case | Client |
|----------|--------|
| Daily task management | CLI / TUI |
| AI-assisted workflows | Claude adapter |
| Tool-based automation | Gemini adapter |
| Verification | `doctor` command |

All clients maintain consistency through shared `cliUtils` and file-based storage.

