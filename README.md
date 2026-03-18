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

## Choose Your Path

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
| Daily summaries | Yes | No | No |
| Executive reports | Yes | No | No |

## Installation

### Requirements

- Node.js 18+
- npm
- GitHub Copilot CLI in `PATH` only if you want the plugin experience

## Install For The Full Copilot Experience

```bash
npm install -g @alberttanure/catpilot-cli
copilot plugin install @alberttanure/catpilot-cli
copilot agents
```

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

CatPilot stores its workspace configuration in `data/config.json`.

If you run:

```bash
cat-pilot setup
```

you will be guided through:

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
cat-pilot task list
cat-pilot task list --status all
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

- workspace `data/config.json`
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

- Current version: **v0.1.9**
- Changelog: [CHANGELOG.md](https://github.com/tanure/cat-copilot/blob/main/CHANGELOG.md)
- GitHub releases: [Releases](https://github.com/tanure/cat-copilot/releases)

## License

MIT — see `LICENSE`.
