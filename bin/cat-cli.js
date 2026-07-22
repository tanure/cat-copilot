#!/usr/bin/env node

import { Command } from 'commander';
import fs from 'fs';
import path from 'path';
import * as cliUtils from '../lib/cli-utils.js';
import { runSetup } from '../lib/setup.js';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const program = new Command();
const pluginRoot = path.resolve(__dirname, '..');

// Single source of truth for the version: package.json (prevents the drift where
// the CLI, MCP server and plugin manifest each hard-code a different number).
let pkgVersion = '0.0.0';
try {
  pkgVersion = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'package.json'), 'utf8')).version || pkgVersion;
} catch { /* fall back to placeholder */ }

program
  .name('cat-pilot')
  .description('CatPilot CLI: Standalone terminal tool for tasks, memos, journal, and milestones')
  .version(pkgVersion);

// ============================================================================
// SETUP COMMANDS
// ============================================================================

program
  .command('setup')
  .description('Initialize or reconfigure storage (global by default, shared across all directories)')
  .option('--local', 'Write a project-local config (<cwd>/data/config.json) instead of the global one')
  .option('--root <path>', 'Storage root (absolute path recommended, e.g. your Obsidian vault)')
  .option('--partitioning <mode>', 'Partitioning mode: day | week | month')
  .option('-y, --yes', 'Skip prompts and confirmation (non-interactive)')
  .action(async (options) => {
    try {
      const result = await runSetup({
        local: options.local,
        root: options.root,
        partitioning: options.partitioning,
        yes: options.yes
      });
      if (result) console.log('\n✅ Setup complete!');
    } catch (err) {
      console.error(`❌ Setup error: ${err.message}`);
      process.exit(1);
    }
  });

program
  .command('doctor')
  .description('Run diagnostics')
  .action(() => {
    console.log('\n🩺 CatPilot Doctor\n');

    const workspaceRoot = process.cwd();
    const resolved = cliUtils.resolveConfigPath(workspaceRoot);
    const pluginConfigPath = path.join(pluginRoot, 'plugin.json');
    const agentsDirPath = path.join(pluginRoot, 'agents');
    const skillsDirPath = path.join(pluginRoot, 'skills');

    // Config resolution (global-aware)
    console.log('📂 Storage Configuration:');
    const configFound = resolved.scope !== 'none' && fs.existsSync(resolved.path);
    const scopeLabel = {
      'env-config': 'from CATPILOT_CONFIG',
      'env-root': 'from CATPILOT_ROOT',
      local: 'project-local',
      global: 'global (~/.catpilot)',
      none: 'not configured'
    }[resolved.scope];
    console.log(`${configFound ? '✅' : '❌'} config.json (${resolved.path}) — ${scopeLabel}`);
    if (configFound) {
      try {
        const cfg = cliUtils.loadConfig(workspaceRoot);
        console.log(`   📦 Storage root: ${path.resolve(cfg.__baseDir || workspaceRoot, cfg.storage.root)}`);
      } catch (err) {
        console.log(`   ⚠️  ${err.message.split('\n')[0]}`);
      }
    } else {
      console.log('   → Run `cat-pilot setup` to create a shared global config.');
    }

    // Plugin checks
    console.log('\n📦 Plugin Assets:');
    const pluginConfigFound = fs.existsSync(pluginConfigPath);
    const agentsDirFound = fs.existsSync(agentsDirPath);
    const skillsDirFound = fs.existsSync(skillsDirPath);

    console.log(`${pluginConfigFound ? '✅' : '❌'} plugin.json (${pluginConfigPath})`);
    console.log(`${agentsDirFound ? '✅' : '❌'} agents/ directory (${agentsDirPath})`);
    console.log(`${skillsDirFound ? '✅' : '❌'} skills/ directory (${skillsDirPath})`);

    // Summary
    console.log(`\nℹ️ Workspace root: ${workspaceRoot}`);
    console.log(`ℹ️ Plugin root: ${pluginRoot}`);

    console.log();
  });

// ============================================================================
// TASK COMMANDS
// ============================================================================

const taskCmd = program
  .command('task')
  .description('Manage tasks');

taskCmd
  .command('add <title>')
  .description('Add new task')
  .option('--due <date>', 'Due date (YYYY-MM-DD)')
  .option('--priority <priority>', 'Priority (P0|P1|P2|P3)')
  .option('--tags <tags>', 'Tags (comma-separated)')
  .option('--context <context>', 'Context or notes')
  .action(async (title, options) => {
    try {
      const config = cliUtils.loadConfig();
      const tasksPath = cliUtils.resolveFilePath('tasks', config);
      const content = cliUtils.readFileOrCreate(tasksPath, '## Open Tasks\n\n| ID | Status | Title | Due Date | Priority | Tags | Context |\n| --- | --- | --- | --- | --- | --- | --- |\n');
      const tasks = cliUtils.parseTasksTable(content);

      const newTask = {
        id: cliUtils.getNextTaskId(tasks),
        status: 'Open',
        title,
        dueDate: options.due || '',
        priority: options.priority || '',
        tags: options.tags || '',
        context: options.context || ''
      };

      tasks.push(newTask);
      const newContent = cliUtils.formatTasksTable(tasks);
      cliUtils.ensureDir(path.dirname(tasksPath));
      fs.writeFileSync(tasksPath, newContent, 'utf8');

      console.log(`\n✅ Task added to ${tasksPath}`);
      console.log(`   📌 ID #${newTask.id}: ${title}`);
      if (options.due) console.log(`   📅 Due: ${options.due}`);
      if (options.priority) console.log(`   ⚡ Priority: ${options.priority}`);
    } catch (err) {
      console.error(`❌ Error: ${err.message}`);
      process.exit(1);
    }
  });

taskCmd
  .command('list')
  .description('List tasks')
  .option('--status <status>', 'Filter by status (open|done|all)', 'open')
  .action((options) => {
    try {
      const config = cliUtils.loadConfig();
      const tasksPath = cliUtils.resolveFilePath('tasks', config);
      const content = cliUtils.readFileOrCreate(tasksPath);
      const tasks = cliUtils.parseTasksTable(content);

      const filtered = options.status === 'all'
        ? tasks
        : tasks.filter(t => t.status.toLowerCase() === options.status.toLowerCase());

      if (filtered.length === 0) {
        console.log(`\n📂 No ${options.status} tasks found in ${tasksPath}`);
        return;
      }

      console.log(`\n📂 Tasks from ${tasksPath}\n`);
      console.log('| ID | Status | Title | Due | Priority |');
      console.log('| --- | --- | --- | --- | --- |');
      filtered.forEach(t => {
        const due = t.dueDate ? `${t.dueDate}` : '-';
        const pri = t.priority || '-';
        console.log(`| ${t.id} | ${t.status} | ${t.title} | ${due} | ${pri} |`);
      });
      console.log();
    } catch (err) {
      console.error(`❌ Error: ${err.message}`);
      process.exit(1);
    }
  });

taskCmd
  .command('complete <id>')
  .description('Mark task as done')
  .action((id, options) => {
    try {
      const config = cliUtils.loadConfig();
      const tasksPath = cliUtils.resolveFilePath('tasks', config);
      const content = cliUtils.readFileOrCreate(tasksPath);
      const tasks = cliUtils.parseTasksTable(content);

      const task = tasks.find(t => t.id === parseInt(id, 10));
      if (!task) {
        console.error(`❌ Task #${id} not found`);
        process.exit(1);
      }

      task.status = 'Done';
      const newContent = cliUtils.formatTasksTable(tasks);
      fs.writeFileSync(tasksPath, newContent, 'utf8');

      console.log(`\n✅ Task #${id} marked as Done`);
    } catch (err) {
      console.error(`❌ Error: ${err.message}`);
      process.exit(1);
    }
  });

taskCmd
  .command('remove <id>')
  .description('Remove task')
  .action((id) => {
    try {
      const config = cliUtils.loadConfig();
      const tasksPath = cliUtils.resolveFilePath('tasks', config);
      const content = cliUtils.readFileOrCreate(tasksPath);
      const tasks = cliUtils.parseTasksTable(content);

      const index = tasks.findIndex(t => t.id === parseInt(id, 10));
      if (index === -1) {
        console.error(`❌ Task #${id} not found`);
        process.exit(1);
      }

      tasks.splice(index, 1);
      const newContent = cliUtils.formatTasksTable(tasks);
      fs.writeFileSync(tasksPath, newContent, 'utf8');

      console.log(`\n✅ Task #${id} removed`);
    } catch (err) {
      console.error(`❌ Error: ${err.message}`);
      process.exit(1);
    }
  });

// ============================================================================
// JOURNAL COMMANDS
// ============================================================================

const journalCmd = program
  .command('journal')
  .description('Manage journal entries');

journalCmd
  .command('add <text>')
  .description('Add journal entry')
  .action((text) => {
    try {
      const config = cliUtils.loadConfig();
      const journalPath = cliUtils.resolveFilePath('journal', config);
      const content = cliUtils.readFileOrCreate(journalPath);

      const newContent = cliUtils.appendJournalEntry(content, text);
      cliUtils.ensureDir(path.dirname(journalPath));
      fs.writeFileSync(journalPath, newContent, 'utf8');

      const today = new Date().toISOString().split('T')[0];
      console.log(`\n✅ Journal entry added to ${journalPath}`);
      console.log(`   📝 Date: ${today}`);
    } catch (err) {
      console.error(`❌ Error: ${err.message}`);
      process.exit(1);
    }
  });

journalCmd
  .command('list')
  .description('List journal entries')
  .option('--days <count>', 'Show last N days', '7')
  .action((options) => {
    try {
      const config = cliUtils.loadConfig();
      const journalPath = cliUtils.resolveFilePath('journal', config);
      const content = cliUtils.readFileOrCreate(journalPath);
      const entries = cliUtils.parseJournalEntries(content);

      const days = parseInt(options.days, 10);
      const recent = entries.slice(-days);

      if (recent.length === 0) {
        console.log(`\n📂 No journal entries found in ${journalPath}`);
        return;
      }

      console.log(`\n📝 Journal entries (${journalPath})\n`);
      recent.forEach(e => {
        console.log(`📅 ${e.date}`);
        console.log(`   ${e.text.substring(0, 100)}${e.text.length > 100 ? '...' : ''}`);
      });
      console.log();
    } catch (err) {
      console.error(`❌ Error: ${err.message}`);
      process.exit(1);
    }
  });

// ============================================================================
// MEMO COMMANDS
// ============================================================================

const memoCmd = program
  .command('memo')
  .description('Manage memos');

memoCmd
  .command('create <title>')
  .description('Create new memo')
  .option('--content <content>', 'Memo content')
  .action((title, options) => {
    try {
      const config = cliUtils.loadConfig();
      const memoDir = cliUtils.resolveFilePath('memos', config);
      const filename = cliUtils.createMemoFilename(title);
      const memoPath = path.join(memoDir, filename);

      const content = options.content || 'Add your memo content here.';
      cliUtils.writeMemo(memoPath, title, content);

      console.log(`\n✅ Memo created at ${memoPath}`);
      console.log(`   📝 Title: ${title}`);
    } catch (err) {
      console.error(`❌ Error: ${err.message}`);
      process.exit(1);
    }
  });

memoCmd
  .command('list')
  .description('List memos')
  .action(() => {
    try {
      const config = cliUtils.loadConfig();
      const memoDir = cliUtils.resolveFilePath('memos', config);
      const memos = cliUtils.listMemos(memoDir);

      if (memos.length === 0) {
        console.log(`\n📂 No memos found in ${memoDir}`);
        return;
      }

      console.log(`\n🧠 Memos (${memoDir})\n`);
      memos.forEach(m => {
        console.log(`   ${m}`);
      });
      console.log();
    } catch (err) {
      console.error(`❌ Error: ${err.message}`);
      process.exit(1);
    }
  });

// ============================================================================
// POMODORO COMMANDS
// ============================================================================

import * as pomodoro from '../lib/pomodoro.js';

function fmtRemaining(sec) {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

function printActive(active) {
  console.log(`   ⏱️  ${active.type} — ${fmtRemaining(active.remainingSec)} left of ${active.plannedMin} min`);
  if (active.task) console.log(`   🎯 Task: ${active.task}`);
  else if (active.label) console.log(`   🏷️  ${active.label}`);
}

const pomodoroCmd = program
  .command('pomodoro')
  .alias('pomo')
  .description('Manage Pomodoro focus/break timers');

pomodoroCmd
  .command('start')
  .description('Start a Pomodoro session')
  .option('--minutes <n>', 'Planned duration in minutes')
  .option('--type <type>', 'Session type (focus|short-break|long-break)', 'focus')
  .option('--task <task>', 'Task to focus on (id or title)')
  .option('--label <label>', 'Free-form label')
  .option('--force', 'Override an already-running session')
  .action((options) => {
    try {
      const res = pomodoro.start({
        minutes: options.minutes != null ? parseInt(options.minutes, 10) : undefined,
        type: options.type,
        task: options.task,
        label: options.label,
        force: Boolean(options.force)
      });
      console.log('\n✅ Pomodoro started');
      printActive(res.active);
      console.log(`   📄 State: ${res.path}`);
    } catch (err) {
      console.error(`❌ ${err.message}`);
      if (err.active) printActive(err.active);
      process.exit(1);
    }
  });

pomodoroCmd
  .command('status')
  .description('Show the running Pomodoro session')
  .action(() => {
    try {
      const { active } = pomodoro.status();
      if (!active) {
        console.log('\nℹ️ No Pomodoro session is running.');
        return;
      }
      console.log(`\n${active.isExpired ? '🔔 Pomodoro finished!' : '⏱️  Pomodoro running'}`);
      printActive(active);
    } catch (err) {
      console.error(`❌ Error: ${err.message}`);
      process.exit(1);
    }
  });

pomodoroCmd
  .command('stop')
  .alias('complete')
  .description('Complete the running Pomodoro and log it')
  .option('--notes <notes>', 'Notes about the session')
  .action((options) => {
    try {
      const res = pomodoro.complete({ notes: options.notes });
      console.log(`\n✅ Pomodoro completed (${res.record.actualMin} min) — logged to ${res.path}`);
    } catch (err) {
      console.error(`❌ ${err.message}`);
      process.exit(1);
    }
  });

pomodoroCmd
  .command('cancel')
  .description('Abandon the running Pomodoro and log it')
  .option('--notes <notes>', 'Reason/notes')
  .action((options) => {
    try {
      const res = pomodoro.cancel({ notes: options.notes });
      console.log(`\n✅ Pomodoro cancelled — logged as abandoned to ${res.path}`);
    } catch (err) {
      console.error(`❌ ${err.message}`);
      process.exit(1);
    }
  });

pomodoroCmd
  .command('list')
  .description('List past Pomodoro sessions')
  .option('--limit <n>', 'Max sessions to show')
  .action((options) => {
    try {
      const res = pomodoro.list({ limit: options.limit ? parseInt(options.limit, 10) : undefined });
      if (res.count === 0) {
        console.log(`\n📂 No Pomodoro sessions found in ${res.path}`);
        return;
      }
      console.log(`\n🍅 Pomodoro sessions (${res.path})\n`);
      console.log('| ID | Type | Task | Actual | Status |');
      console.log('| --- | --- | --- | --- | --- |');
      res.data.forEach(s => {
        console.log(`| ${s.id} | ${s.type} | ${s.task || '-'} | ${s.actualMin || '-'} | ${s.status} |`);
      });
      console.log();
    } catch (err) {
      console.error(`❌ Error: ${err.message}`);
      process.exit(1);
    }
  });

pomodoroCmd
  .command('stats')
  .description('Show Pomodoro stats for a period')
  .option('--period <period>', 'today|week|month|all', 'all')
  .action((options) => {
    try {
      const s = pomodoro.stats({ period: options.period });
      console.log(`\n📊 Pomodoro stats (${s.period})`);
      console.log(`   🍅 Sessions: ${s.totalSessions} (✅ ${s.completedSessions} completed, 🚫 ${s.abandonedSessions} abandoned)`);
      console.log(`   🎯 Focus sessions: ${s.focusSessions} — ${s.focusMinutes} min`);
    } catch (err) {
      console.error(`❌ Error: ${err.message}`);
      process.exit(1);
    }
  });

pomodoroCmd
  .command('report')
  .description('Productivity report by session, day, or week')
  .option('--period <period>', 'today|this-week|last-week|this-month|last-month|last-7|last-30|all', 'this-week')
  .option('--by <groupBy>', 'day|week|task|session', 'day')
  .option('--json', 'Output raw JSON')
  .action((options) => {
    try {
      const r = pomodoro.report({ period: options.period, groupBy: options.by });
      if (options.json) {
        console.log(JSON.stringify(r, null, 2));
        return;
      }
      const s = r.summary;
      const pct = (x) => `${Math.round((x || 0) * 100)}%`;
      console.log(`\n📊 Pomodoro report — ${r.period} (grouped by ${r.groupBy})`);
      console.log(`   🍅 Sessions: ${s.totalSessions} (✅ ${s.completedSessions} completed, 🚫 ${s.abandonedSessions} abandoned) — ${pct(s.completionRate)} completion`);
      console.log(`   🎯 Focus: ${s.completedFocusSessions}/${s.focusSessions} completed (${pct(s.focusCompletionRate)}) — ${s.focusMinutes} focus min`);

      if (!r.groups.length) {
        console.log('\nℹ️ No sessions in this period.');
        return;
      }

      console.log('');
      if (r.groupBy === 'session') {
        console.log('| Started | Type | Task | Planned | Actual | Status |');
        console.log('| --- | --- | --- | --- | --- | --- |');
        for (const g of r.groups) {
          const when = new Date(g.started).toLocaleString();
          console.log(`| ${when} | ${g.type} | ${g.task || '-'} | ${g.plannedMin} | ${g.actualMin} | ${g.status} |`);
        }
      } else {
        const head = r.groupBy === 'task' ? 'Task' : (r.groupBy === 'week' ? 'Week' : 'Day');
        console.log(`| ${head} | Focus done | Focus min | Completion |`);
        console.log('| --- | --- | --- | --- |');
        for (const g of r.groups) {
          console.log(`| ${g.label} | ${g.completedFocusSessions}/${g.focusSessions} | ${g.focusMinutes} | ${pct(g.completionRate)} |`);
        }
      }
    } catch (err) {
      console.error(`❌ Error: ${err.message}`);
      process.exit(1);
    }
  });

pomodoroCmd
  .command('run')
  .description('Start a session and show a live countdown in the terminal')
  .option('--minutes <n>', 'Planned duration in minutes')
  .option('--type <type>', 'Session type (focus|short-break|long-break)', 'focus')
  .option('--task <task>', 'Task to focus on (id or title)')
  .option('--label <label>', 'Free-form label')
  .option('--force', 'Override an already-running session')
  .action(async (options) => {
    try {
      const res = pomodoro.start({
        minutes: options.minutes != null ? parseInt(options.minutes, 10) : undefined,
        type: options.type,
        task: options.task,
        label: options.label,
        force: Boolean(options.force)
      });
      const focusOn = res.active.task || res.active.label || res.active.type;
      console.log(`\n🍅 ${res.active.type} started — ${res.active.plannedMin} min · ${focusOn}`);
      console.log('   (Ctrl+C stops the display; the timer keeps running — use `pomodoro stop` to log it)\n');

      let cancelled = false;
      process.on('SIGINT', () => { cancelled = true; });

      // Live countdown loop; recompute from the persisted state each tick so the
      // display stays correct even if the process was paused.
      // eslint-disable-next-line no-constant-condition
      while (!cancelled) {
        const { active } = pomodoro.status();
        if (!active) break;
        process.stdout.write(`\r   ⏳ ${fmtRemaining(active.remainingSec)} remaining   `);
        if (active.isExpired) {
          process.stdout.write('\n');
          const done = pomodoro.complete({ notes: '' });
          console.log(`\n🔔 Time! Pomodoro completed (${done.record.actualMin} min) — logged to ${done.path}`);
          break;
        }
        await new Promise(r => setTimeout(r, 1000));
      }
      if (cancelled) {
        console.log('\n\nℹ️ Display stopped. Timer still running — `cat-pilot pomodoro status` to check.');
      }
    } catch (err) {
      console.error(`❌ ${err.message}`);
      if (err.active) printActive(err.active);
      process.exit(1);
    }
  });

// ============================================================================
// LEARNING / GROWTH / PROJECT COMMANDS (per-file domains)
// ============================================================================

import * as domains from '../lib/domains.js';

function registerDomainCommands(name, domain, label, extraOpts = []) {
  const cmd = program.command(name).description(`Manage ${label}`);

  let addCmd = cmd
    .command('add <title>')
    .description(`Add a ${label} note`)
    .option('--body <text>', 'Markdown body');
  for (const [flag, desc] of extraOpts) addCmd = addCmd.option(flag, desc);
  addCmd.action((title, options) => {
    try {
      const { body, ...frontmatter } = options;
      const res = domains.addNote(domain, { title, body, frontmatter });
      console.log(`\n✅ ${label} note created at ${res.path}`);
    } catch (err) {
      console.error(`❌ Error: ${err.message}`);
      process.exit(1);
    }
  });

  cmd
    .command('list')
    .description(`List ${label} notes`)
    .action(() => {
      try {
        const notes = domains.listNotes(domain);
        if (notes.length === 0) {
          console.log(`\n📂 No ${label} notes found.`);
          return;
        }
        console.log(`\n📂 ${label} notes:\n`);
        notes.forEach(n => {
          const fm = n.frontmatter || {};
          const status = fm.status ? ` [${fm.status}]` : '';
          console.log(`   ${fm.title || n.filename}${status}`);
        });
        console.log();
      } catch (err) {
        console.error(`❌ Error: ${err.message}`);
        process.exit(1);
      }
    });
}

registerDomainCommands('learning', 'learning', 'learning', [
  ['--goal <goal>', 'Learning goal'],
  ['--target_date <date>', 'Target date (YYYY-MM-DD)'],
  ['--next_review <date>', 'Next review date (YYYY-MM-DD)'],
  ['--status <status>', 'Status (In Progress|Done)']
]);
registerDomainCommands('growth', 'growth', 'growth', [
  ['--area <area>', 'Impact area'],
  ['--impact <impact>', 'Quantified impact']
]);
registerDomainCommands('project', 'projects', 'project', [
  ['--status <status>', 'Status (Active|Blocked|Done)'],
  ['--owner <owner>', 'Owner'],
  ['--due <date>', 'Due date (YYYY-MM-DD)']
]);

// ============================================================================
// INSTALL / SURFACE DETECTION
// ============================================================================

program
  .command('install')
  .description('Detect which Copilot surfaces are configured and print next steps')
  .action(() => {
    console.log('\n🧩 CatPilot — Copilot ecosystem install check\n');

    const workspaceRoot = process.cwd();
    const resolved = cliUtils.resolveConfigPath(workspaceRoot);
    const configPath = resolved.path;
    const mcpEntry = path.resolve(pluginRoot, 'bin', 'cat-mcp.js');
    const vscodeMcp = path.join(workspaceRoot, '.vscode', 'mcp.json');

    const configOk = resolved.scope !== 'none' && fs.existsSync(configPath);
    const mcpOk = fs.existsSync(mcpEntry);
    const vscodeOk = fs.existsSync(vscodeMcp);

    console.log('📂 Storage');
    console.log(`${configOk ? '✅' : '⚠️'} config.json ${configOk ? `(${configPath}, ${resolved.scope})` : '— run `cat-pilot setup` to create a shared global config'}`);
    console.log(`${mcpOk ? '✅' : '❌'} MCP server entry (${mcpEntry})`);

    console.log('\n🖥️  GitHub Copilot CLI');
    console.log('   Plugin (agent + skills):  copilot plugin install tanure/cat-copilot');
    console.log(`   MCP server:               copilot mcp add catpilot -- node "${mcpEntry}"`);

    console.log('\n🧑‍💻 Copilot in VS Code');
    console.log(`${vscodeOk ? '✅' : '⚠️'} .vscode/mcp.json ${vscodeOk ? '' : '— copy templates/mcp/vscode-mcp.json into .vscode/mcp.json'}`);
    console.log('   Then open Copilot Chat and pick the "catpilot" tools.');

    console.log('\n🪟 GitHub Copilot App');
    console.log('   Install the plugin and register the MCP server (same command as CLI).');
    console.log('   See docs/INSTALL.md for the App walkthrough.');

    console.log(`\nℹ️ Full matrix: docs/INSTALL.md`);
    console.log();
  });

// ============================================================================
// PARSE AND RUN
// ============================================================================

program.parse(process.argv);

if (process.argv.length < 3) {
  program.outputHelp();
}
