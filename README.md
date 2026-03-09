# CatPilot 😺

Playful personal secretary for GitHub Copilot CLI with structured memory, emoji-first UX, and configurable file storage.

![npm version](https://img.shields.io/npm/v/%40alberttanure%2Fcatpilot-cli)
![npm downloads](https://img.shields.io/npm/dm/%40alberttanure%2Fcatpilot-cli)
![license](https://img.shields.io/npm/l/%40alberttanure%2Fcatpilot-cli)
![node](https://img.shields.io/node/v/%40alberttanure%2Fcatpilot-cli)

![CatPilot Pixel Icon](assets/catpilot-pixel.svg)

## Why CatPilot ✨

CatPilot helps you capture work and life context quickly from the terminal:
- ✅ Track and maintain tasks
- 📝 Log journal notes
- 🎯 Manage milestones
- 🧠 Create organized memos
- 📊 Generate daily summaries
- 📈 Generate executive reports (Markdown/HTML)
- 🛠️ Configure storage path + partitioning (day/week/month)

All data writes are configuration-driven via `data/config.json`.

## Features & Capabilities 🧭

| Capability | What it does | Skill |
| --- | --- | --- |
| ✅ Tasks | Add, update, list, complete, remove tasks with dedupe checks | `task-management` |
| 📝 Journal | Append-only daily journal entries | `journal-entry` |
| 🎯 Milestones | Create/update/list milestones and status | `milestone-tracking` |
| 🧠 Memos | Generate structured markdown memo files | `memo-creation` |
| 📊 Daily Summary | Build day recap from all available sources | `daily-summary` |
| 📈 Reports | Build period-based executive reports with KPIs, charts, and insights in Markdown/HTML | `report-generator` |
| 🛠️ Interactive Setup | First-run and reconfigure storage behavior | `interactive-setup` |

## Install 🚀

### Option A: Global install from local repo

```powershell
npm install -g .
catpilot
```

### Option B: Install from published npm package

```powershell
npm install -g @alberttanure/catpilot-cli@latest
catpilot
```

### Requirements

- Node.js 18+
- GitHub Copilot CLI installed and available in PATH (`copilot`)

## Quickstart (60 seconds) ⚡

1. Run `catpilot`
2. Trigger setup with `setup catpilot` (or first write intent)
3. Answer prompts:
   - storage root
   - partitioning (`day`/`week`/`month`)
   - migration (`adopt`/`copy`/`move`)
4. Start using prompts:
   - `add a task to prepare monthly review`
   - `add journal entry: shipped milestone checks`
   - `summarize my day and save it`

Outputs are emoji-enhanced for fast scanning and fun interaction.

## Prompt Examples 💬

### Tasks
- `add a task to draft Q2 planning notes priority high`
- `list my tasks`
- `complete task 12`

### Journal
- `add journal entry: Focused this morning, blocked by approvals later`

### Milestones
- `create milestone Launch internal demo target 2026-03-31`
- `update milestone 2 status in progress`

### Memos
- `create memo title Team Retrospective with notes about wins and blockers`

### Summary
- `summarize my day`
- `summarize my day and save it`

### Reports
- `generate executive report for this month in markdown`
- `export weekly report in html`
- `create report from 2026-03-01 to 2026-03-09 in html`

## Example Outputs 🧪

### Task list

```text
✅ Open tasks loaded from C:/Users/albert/notes/2026/2026-03/tasks.md
- 🟢 #12 Draft Q2 planning notes (Due: 2026-03-12)
- 🟢 #15 Prepare Company DR discussion notes
- ✅ #09 Finalize plugin README
⚠️ Tip: want me to set priority for task #15?
```

### Daily summary

```text
✅ Daily summary for 2026-03-09

✅ Tasks
- Closed 1 task, 2 still open.

📝 Journal
- Captured 2 notes about focus blocks and approvals.

🎯 Milestones
- 🔵 Internal demo remains In Progress.

🧠 Memos
- Created 1 memo: 2026-03-09_team-retrospective.md

➡️ Next Actions
- Prioritize open planning task as P1.
- Schedule 30 min for milestone review.
```

### Executive report (markdown)

```text
📊 CatPilot Report generated for period: 2026-03-01 to 2026-03-09
✅ Exported to: C:/Users/albert/notes/2026/2026-03/reports/report-20260309-1830.md

Top insights:
1) ✅ Task completion rate improved to 68% (+12pp vs prior period).
2) ⚠️ 3 overdue tasks are concentrated in one milestone stream.
3) 🎯 Milestone throughput increased with 2 milestones moved to Done.
```

## How Storage Works 🗂️

CatPilot resolves targets from `data/config.json`.

Key settings (see also `data/config.template.json`):
- `storage.root`
- `storage.partitioning`: `day`, `week`, `month`
- `migration.mode`: `adopt`, `copy`, `move`

If config is missing/invalid and a write is requested, CatPilot triggers interactive setup automatically.

## Publish to npm 📦

Yes — you need an npm account to publish.

1. Create account at npmjs.com and verify email.
2. Login:

```powershell
npm login
```

3. (Recommended) Dry run package contents:

```powershell
npm pack --dry-run
```

4. Publish:

```powershell
npm publish --access public
```

Notes:
- You can publish only package names/scopes you own.
- You cannot publish under `@github/*` unless you own that npm scope.

## Troubleshooting 🧯

- `❌ copilot not found`: install GitHub Copilot CLI and re-open terminal.
- `⚠️ setup loops`: validate JSON format in `data/config.json`.
- `⚠️ writes in wrong place`: ask CatPilot to show current storage config.
- `❌ npm publish fails`: check package name availability and npm auth.

## Skill Map 🧩

- `interactive-setup`
- `task-management`
- `journal-entry`
- `milestone-tracking`
- `memo-creation`
- `daily-summary`
- `report-generator`

## License 📄

MIT — see `LICENSE`.
