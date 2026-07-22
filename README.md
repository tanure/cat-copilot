# CatPilot 😺

CatPilot is a terminal-first personal operating system for GitHub Copilot CLI users who want one place to capture tasks, journal notes, milestones, memos, summaries, and reports without leaving the command line.

It can be used in three ways:

| Entry Point | Best For | What You Get |
| --- | --- | --- |
| `catpilot` | Full Copilot CLI experience | CatPilot as a Copilot plugin with agent + skills for tasks, journal, milestones, memos, summaries, and reports |
| `cat-pilot` | Direct terminal workflows | Standalone CLI for setup, diagnostics, tasks, journal entries, and memos |
| `cat-tui` | Visual browsing in the terminal | Experimental dashboard for browsing the same workspace data through a terminal UI |

![npm version](https://img.shields.io/npm/v/%40alberttanure%2Fcatpilot-cli)
![npm downloads](https://img.shields.io/npm/dm/%40alberttanure%2Fcatpilot-cli)
![license](https://img.shields.io/npm/l/%40alberttanure%2Fcatpilot-cli)
![node](https://img.shields.io/node/v/%40alberttanure%2Fcatpilot-cli)

<p align="center">
   <img src="assets/catpilot-pixel.png" alt="CatPilot Pixel Icon" width="260" />
</p>

## Why CatPilot

Most terminal tools are either too raw or too rigid. CatPilot is meant to feel closer to a practical daily assistant:

- Capture a task the second it appears
- Keep lightweight work notes without opening another app
- Create handoff memos and meeting summaries as markdown files
- Keep Copilot-aware workflows connected to the same storage
- Move between chat, direct CLI, and terminal dashboard without losing context

All interfaces write to the same config-driven storage, so your data stays in sync.

## A personal knowledge OS across every Copilot surface

CatPilot is more than a CLI tool — it's a **two-layer second brain**:

- **Layer 1 — this repo (public, generic):** the engine, agent, skills, and a real
  **MCP server**. Neutral vocabulary only (tasks, journal, learning, growth, projects)
  so it's safe to open-source and use with any employer.
- **Layer 2 — your private vault (outside the repo):** your real content, ideally an
  **Obsidian** vault. CatPilot writes here; the repo only ships templates, never data.

Run `cat-pilot setup` once to point `storage.root` at your Obsidian vault. It writes a
**global** config (`~/.catpilot/config.json`) so the **same brain** is reachable from
any directory, through four doors:

| Surface | How | Best for |
| --- | --- | --- |
| **GitHub Copilot CLI** | `copilot plugin install` + agent/skills | Conversational planning, summaries, reports |
| **GitHub Copilot Canvas** | `copilot plugin install catpilot-canvas@awesome-copilot` (renders in the GitHub Copilot app side panel) | Visual dashboard, tasks board, reports, timeline, charts |
| **Copilot in VS Code** | `.vscode/mcp.json` (MCP server) | Editor + Obsidian side by side |
| **Copilot App** | plugin + MCP registration | Session-based planning |
| **Standalone CLI / MCP** | `cat-pilot` / `catpilot-mcp` | Scripting & embedding anywhere |

New personal-management domains help you stay on track for projects, certifications,
studies, and growth/review prep:

- **`learning`** — certification & study tracker (goals, target dates, progress).
- **`growth`** — accomplishment / brag-doc log + neutral review-prep summaries.
- **`project-tracker`** — lightweight per-project status rollups.
- **`pomodoro`** — focus timers with **configurable** focus/short-break/long-break
  durations (default 25/5/15, set in `config.json` / setup / canvas settings) modeled
  as timestamp + duration, so a running session is consistent across the CLI, MCP and
  canvas and survives process restarts; sessions can optionally link to a task and are
  logged to a partitioned `pomodoro.md` history. Includes **productivity reports** (by
  session/day/week/task) measuring completed focus sessions, focus minutes, and
  completion rate.
- **`sanitize`** — a pre-write guardrail that flags employer-internal details before they
  ever hit disk, so growth/review content stays shareable.

📚 **Start here:**
[`docs/INSTALL.md`](docs/INSTALL.md) ·
[`docs/SURFACES.md`](docs/SURFACES.md) ·
[`docs/USING_IN_VSCODE.md`](docs/USING_IN_VSCODE.md) ·
[`docs/OBSIDIAN_KNOWLEDGE_BASE.md`](docs/OBSIDIAN_KNOWLEDGE_BASE.md) ·
[`docs/PRIVACY_AND_BOUNDARIES.md`](docs/PRIVACY_AND_BOUNDARIES.md) ·
[`docs/PLAYBOOK.md`](docs/PLAYBOOK.md)

## GitHub Copilot Canvas

CatPilot ships a **GitHub Copilot canvas extension** — a beautiful, modern side-panel
UI that turns your whole workspace into a visual command center, without leaving the
Copilot app. It reads and writes the **exact same** config-driven storage as the CLI,
agent, and MCP server, so everything stays in sync across surfaces.

The extension lives in [`.github/extensions/catpilot-canvas/`](.github/extensions/catpilot-canvas/)
and renders in the **[GitHub Copilot app](https://github.com/features/copilot)** side panel —
just ask Copilot to *"open the CatPilot canvas"* and it appears next to your chat. It's also
published to the **[Awesome Copilot](https://awesome-copilot.github.com/extensions/)** marketplace
so anyone can install it in one command (see [Install the canvas](#install-the-canvas) below).

What you get in the canvas:

- **Dashboard** — hero, summary cards, last-3-days activity, charts, and productivity nudges.
- **Tasks** — switch between **list (table)** and **board (kanban)** views with an
  **Overdue · To do · Blocked · Done** board, pick a status (To do / Blocked / Done) on
  create/edit, filter by due date (**All · Today · 7 days**), complete inline, drag between
  columns, edit/save locally, and open a detail popup — plus an add button.
- **Journal, Milestones, Memos** — browse, add, and open full detail views (memos render markdown).
- **Learning, Growth, Projects** — card views with add buttons and detail popups.
- **Pomodoro** — a live countdown ring for the running session, start controls
  (type + minutes + optional task picker), complete/cancel, a today stats strip,
  a recent-sessions table, and a **Productivity** section with a period/grouping
  selector, focus-minutes bar chart, completion donut, and grouped table — all backed
  by the same files the CLI/MCP use. Session durations are editable from **Settings**.
- **Reports** — generate GitHub Copilot **executive reports** for any period (this week, last
  month, all time…), open them (markdown or HTML), and delete. Shares the same reports folder
  as the `report-generator` skill.
- **Timeline** — a 7/14/30-day activity rail grouped by day, with quick **agent actions** to
  summarize or plan from what you've been working on.
- **Settings** — change your storage root, partitioning, or migration mode from an interactive
  wizard: **preview** exactly which files would move, then an approval checkbox gates
  **Confirm & apply** so nothing is migrated until you say so.
- **Help** — an in-canvas capabilities guide explaining every view.
- **Markdown everywhere** — every text field has a formatting toolbar (bold, italic, headings,
  lists, checkboxes, code, links), a live **preview** toggle, and **✨ Generate with Copilot**.
- **Ask Copilot** — a global ✨ button to hand off any prompt to the agent from the canvas.
- **Onboarding** — a first-run setup flow when no CatPilot config exists yet.
- **Light / dark** — a theme toggle that follows the Copilot app theme tokens.

Every action round-trips through CatPilot's storage engine, so the agent, skills, and MCP
server all see the same data instantly.

### Install the canvas

Pick whichever fits how you work — all four end up in the same visual canvas:

| Method | When to use | Steps |
| --- | --- | --- |
| **Awesome Copilot marketplace** *(recommended)* | You want it in every repo/session with one command | `copilot plugin install catpilot-canvas@awesome-copilot` |
| **Project-scoped** *(zero install)* | You've cloned `tanure/cat-copilot` | Nothing to do — it's auto-discovered from `.github/extensions/catpilot-canvas/` |
| **User-scoped** | You want it available globally without the marketplace | Copy the `catpilot-canvas/` folder into `~/.copilot/extensions/` (or `$COPILOT_HOME/extensions/`) |
| **Gist** | Someone shared it with you | Copilot palette → **Install extension from gist…** |

If the Awesome Copilot marketplace isn't registered yet, add it once, then install:

```bash
copilot plugin marketplace add github/awesome-copilot
copilot plugin install catpilot-canvas@awesome-copilot
```

### Open the canvas

The canvas UI is rendered by the **GitHub Copilot app's** canvas panel. From either surface:

- **GitHub Copilot app** — open a session in a repo where the extension is installed and ask
  Copilot to *"open the CatPilot canvas"* (or click it from the canvas picker). The dashboard
  opens in the side panel.
- **GitHub Copilot CLI** — run `copilot` in your project; the CLI **discovers and loads** the
  extension, so its agent actions (generate a report, summarize the timeline, add a task, etc.)
  are available right away in the terminal. The visual canvas itself is drawn by the app's
  canvas renderer, so when you ask Copilot to open it, it surfaces in the connected app panel —
  there is no separate ASCII/terminal renderer for canvases. For a terminal-only dashboard, use
  [`cat-tui`](#option-3-terminal-dashboard-preview) instead.



### Option 1: Full Copilot Experience

Choose this if you want CatPilot to work inside GitHub Copilot CLI with agent-driven prompts and skills.

You get:

- Tasks
- Journal entries
- Milestones
- Memos
- Daily summaries
- Executive reports
- Interactive setup through Copilot chat

### Option 2: Standalone Terminal Workflow

Choose this if you want direct shell commands without going through Copilot chat.

You get:

- Setup and diagnostics
- Task management
- Journal capture
- Memo creation and listing
- An experimental TUI that reads the same data

### Option 3: Terminal Dashboard Preview

Choose this if you want a quick visual read of your workspace data.

Today, `cat-tui` is a separate executable, not something embedded inside Copilot CLI. It renders a useful dashboard, but it should be treated as an early preview rather than a fully interactive app.

## Capability Matrix

| Capability | `catpilot` Copilot Plugin | `cat-pilot` CLI | `cat-tui` |
| --- | --- | --- | --- |
| Interactive setup | Yes | Yes | No |
| Plugin diagnostics | Yes | Partial | No |
| Workspace diagnostics | No | Yes | No |
| Add task | Yes | Yes | Preview only |
| List tasks | Yes | Yes | Yes |
| Complete task | Yes | Yes | Preview only |
| Remove task | Yes | Yes | Preview only |
| Add journal entry | Yes | Yes | No |
| List journal entries | Yes | Yes | Yes |
| Create memo | Yes | Yes | No |
| List memos | Yes | Yes | Yes |
| Read memo content | Yes | No | No |
| Milestones | Yes | No | No |
| Pomodoro timer (start/stop/status) | Yes | Yes | No |
| Pomodoro history & stats | Yes | Yes | No |
| Pomodoro productivity reports | Yes | Yes | No |
| Configurable Pomodoro durations | Yes | Yes | No |
| Daily summaries | Yes | No | No |
| Executive reports | Yes | No | No |

## Installation

### Requirements

- Node.js 18+
- npm
- GitHub Copilot CLI in `PATH` only if you want the plugin experience

## Install For The Full Copilot Experience

CatPilot is published as a **Copilot plugin marketplace**, so it's discoverable from
the Copilot CLI and the Copilot App:

```bash
npm install -g @alberttanure/catpilot-cli

# Discover + install via the CatPilot marketplace (recommended)
copilot plugin marketplace add tanure/cat-copilot
copilot plugin marketplace browse catpilot-marketplace
copilot plugin install catpilot@catpilot-marketplace
copilot agents
```

Prefer a direct install? `copilot plugin install tanure/cat-copilot` works too.

Note: `copilot plugin install ...` registers CatPilot inside Copilot CLI only.  
If you also want direct shell commands like `cat-pilot` and `cat-tui`, run the global npm install step as shown below.

Expected result: `CatPilot` appears in the Copilot agents list.

Then start chat:

```bash
copilot chat
```

Example prompts:

```text
Set up CatPilot for this workspace.
Add a task to prepare my weekly review with priority high.
Create a milestone for the internal demo by 2026-03-31.
Summarize my day and save it.
Generate an executive report for this month in markdown.
```

## Install For Direct CLI And TUI Usage

```bash
npm install -g @alberttanure/catpilot-cli
cat-pilot setup
```

Once setup is complete, you can work directly from the shell:

```bash
cat-pilot task add "Prepare weekly review" --due 2026-03-21 --priority P1
cat-pilot journal add "Met with the team and aligned on next steps."
cat-pilot memo create "handover-notes" --content "Key decisions, blockers, and owners."
cat-tui
```

## First-Time Setup

CatPilot stores a **shared global** configuration at `~/.catpilot/config.json`, so the
same storage is used no matter which directory you launch from. Run setup once:

```bash
cat-pilot setup
```

Prefer non-interactive? Pass flags:

```bash
cat-pilot setup --yes --root "/path/to/your/ObsidianVault" --partitioning month
```

Resolution order (first match wins): `CATPILOT_CONFIG` env → `CATPILOT_ROOT` env →
`<cwd>/data/config.json` (project-local, use `cat-pilot setup --local`) →
`~/.catpilot/config.json` (global). `cat-pilot doctor` shows which one is active.

Setup guides you through:

- storage root path
- partitioning mode
- migration mode for existing files

Default template shape:

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

## What Day-To-Day Use Looks Like

### Morning Planning

Use the CLI when you already know what you want to capture.

```bash
cat-pilot task add "Review open customer issues" --priority P1
cat-pilot task add "Draft platform update for leadership" --due 2026-03-19 --priority P0
cat-pilot task list --status all
```

### During A Meeting

Capture decisions while they are fresh.

```bash
cat-pilot journal add "Decided to split release prep into docs, QA, and publish steps."
cat-pilot memo create "release-handoff" --content "Owners: Docs, QA, Publish. Risks: timing and npm validation."
```

### End Of Day With Copilot

Use the plugin path when you want richer help.

```text
Summarize what I completed today.
Turn my notes into a handoff memo.
Show me overdue tasks and propose next actions.
Generate a weekly report in markdown.
```

### Quick Visual Check

Use the TUI when you want a fast visual scan of the same files.

```bash
cat-tui
```

Sample dashboard output:

```text
🐱 CatPilot · Terminal Dashboard
──────────────────────────────────────────────────

📊 Tasks: 4 total
> 🟢 #7 Analyze meeting outcomes | Due: 2026-03-12 | High
   🟢 #8 Create deployment plan | Due: 2026-03-13 | High
   🟢 #11 Share outcomes with the team | Due: 2026-03-12 | High

ℹ️ ✅ Ready | ↑ ↓: navigate | a: add | d: delete | e: edit | ESC: exit
```

Note: the TUI currently works best as a dashboard and browser. It renders correctly and reads real data, but its input handling is still early.

## Core Commands

### Standalone CLI

#### Setup And Diagnostics

```bash
cat-pilot setup
cat-pilot doctor
```

#### Tasks

```bash
cat-pilot task add "Draft Q2 planning notes" --due 2026-03-25 --priority P1 --tags planning,leadership --context "Need first draft before leadership sync"
cat-pilot task add "Waiting on legal sign-off" --status Blocked
cat-pilot task list
cat-pilot task list --status all
cat-pilot task list --status blocked
cat-pilot task block 12
cat-pilot task unblock 12
cat-pilot task complete 12
cat-pilot task remove 12
```

#### Journal

```bash
cat-pilot journal add "Focused in the morning, blocked by approvals in the afternoon."
cat-pilot journal list
cat-pilot journal list --days 14
```

#### Memos

```bash
cat-pilot memo create "team-retro" --content "Wins, blockers, and next actions."
cat-pilot memo list
```

### Copilot Plugin Flow

These are examples for Copilot chat, not standalone CLI commands:

```text
Add a task to draft Q2 planning notes with priority high.
Create milestone Launch internal demo target 2026-03-31.
Create memo title Team Retrospective with notes about wins and blockers.
Summarize my day and save it.
Generate executive report for this month in markdown.
```

## Diagnostics And Troubleshooting

There are two doctor commands, and they serve different purposes.

### `catpilot doctor`

Use this when CatPilot is not showing up inside Copilot CLI.

```bash
catpilot doctor
```

It checks:

- packaged plugin assets
- `plugin.json`
- agent file discovery
- `copilot --version` availability

### `cat-pilot doctor`

Use this when your local workspace commands or storage setup are not behaving correctly.

```bash
cat-pilot doctor
```

It checks:

- the active config (global `~/.catpilot/config.json` or project-local) and its scope
- the resolved storage root
- packaged `plugin.json`
- packaged `agents/`
- packaged `skills/`
- workspace root and plugin root paths

### Common Recovery Flow

```bash
cat-pilot doctor
catpilot doctor
catpilot update
```

Then restart your terminal and verify:

```bash
copilot agents
```

If needed, run with debug enabled:

```bash
CATPILOT_DEBUG=1 catpilot
```

On PowerShell:

```powershell
$env:CATPILOT_DEBUG=1
catpilot
```

## How The Interfaces Stay In Sync

CatPilot uses config-driven file storage. The plugin, CLI, and TUI all point to the same workspace files.

That means:

- add a task with `cat-pilot`, see it in `cat-tui`
- create a memo in Copilot chat, list it with `cat-pilot memo list`
- capture notes from chat or shell without splitting your system into separate silos

This shared-storage model is what makes the multi-client workflow practical in real day-to-day use.

## Practical Examples

### Example: Run Your Day From The Terminal

```bash
cat-pilot task add "Prepare architecture review" --priority P0 --due 2026-03-20
cat-pilot task add "Write follow-up memo" --priority P2
cat-pilot journal add "Architecture review moved to Thursday. Need updated deck."
cat-pilot memo create "architecture-review" --content "Open questions, decision log, and follow-up owners."
cat-pilot task list --status all
cat-tui
```

### Example: Use Copilot For The Heavy Lifting

```text
Review my open tasks and propose the top 3 priorities for today.
Turn my journal notes from this week into a concise status update.
Create a memo for my handoff tomorrow.
Generate a monthly executive report in markdown.
```

## Screens, Assets, And Docs

- Main visual asset: `assets/catpilot-pixel.png`
- Alternative SVG asset: `assets/catpilot-pixel.svg`
- Deeper multi-client examples: `docs/MULTI_CLIENT_EXAMPLES.md`
- Compatibility notes: `docs/PHASE2-COMPATIBILITY.md`
- Release notes: `CHANGELOG.md`

## Update

Recommended:

```bash
catpilot update
```

Alternative:

```bash
npm update -g @alberttanure/catpilot-cli
```

## Release Notes

- Current version: **v0.4.0**
- Changelog: [CHANGELOG.md](https://github.com/tanure/cat-copilot/blob/main/CHANGELOG.md)
- GitHub releases: [Releases](https://github.com/tanure/cat-copilot/releases)

## License

MIT — see `LICENSE`.
