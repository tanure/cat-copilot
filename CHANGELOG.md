# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

### Added
- **Task "In Progress" status.** Tasks now support `Open` · `In Progress` · `Blocked` ·
  `Done`. The canvas Kanban board gained an **In Progress** column (full set:
  Backlog · Overdue · To do · In Progress · Blocked · Done) and the create/edit form and
  status badges include it. `In Progress` tasks stay under `## Open Tasks` on disk with
  their status preserved in the `Status` cell (only `Done` moves to `## Done Tasks`).
- **Knowledge Base (evolved Memos).** Memos grew into a foldered, tagged knowledge base
  stored under `knowledge/<folder>/<slug>.md` (frontmatter `title`, `folder`, `tags`,
  `created`, `updated`). New MCP tools `kb_add`, `kb_list`, `kb_read`, `kb_update`,
  `kb_remove`, `kb_folders`, `kb_move` (legacy `memo_*` kept as aliases). The canvas
  **Knowledge** view adds a stats header, folder + tag rails, **Grid / List / Folders /
  By-month** views, search, and a detail popup that renders markdown with a full editor.
  Legacy flat `memos/` notes remain readable.
- **Learning paths.** Learning is now a goal + ordered **steps** model
  (`learning/<slug>/index.md` + `steps/`). Each step is richer — **progress %**, **status**
  (Todo · In Progress · Blocked · Done), **due date** and markdown **notes** — and path
  progress is the **average** of its steps (partial progress counts, not just done/total),
  with an achievement recorded on completion. New tools `learning_path_add/list/read/complete`
  and `learning_step_add/update` (now accept `progress`, `due`, `notes`). The canvas
  **Learning** view moves filters to the **top**, adds a **Details ›** progress breakdown
  popup, a rich step editor (status + live progress slider + due + notes), and **✨ Generate
  with Copilot** path drafting.
- **Projects.** Projects gained child **items** (requirements / tasks / milestones) that now
  carry **progress %**, **status**, **due** and **notes**; project progress **averages** its
  trackable items and linked tasks (requirements are scope and excluded). Optional **linked
  main tasks** (new optional `project` field on tasks), **linked milestones**, achievements
  and derived progress. New tools `project_create`, `project_read`, `project_item_add/update`
  (now accept `progress`, `due`, `notes`), `project_complete`, `project_board`. The canvas
  **Projects** view moves filters to the **top**, adds a **Details ›** portfolio breakdown
  popup, a rich item editor, and an **Ask Copilot about this project** button.
- **Achievements.** A dedicated log under `achievements/` (tools `achievement_add`,
  `achievement_list`), auto-recorded on learning-path/project completion and surfaced on
  their dashboards.
- **Milestone links.** The milestones table gained an optional **Link** column
  (`project:<slug>` or `learning:<slug>`); linked milestones appear on that project's or
  learning path's dashboard and the canvas Milestones view can filter by link. Backward
  compatible with the old 5-column table.

### Changed
- **Tags on every domain.** Knowledge, Learning, Projects and Achievements all carry a
  `tags` frontmatter list so an Obsidian vault graph connects them.
- **Canvas navigation.** "Memos" renamed to **Knowledge**; dashboard cards and help guide
  updated for the new domains.

### Notes
- **Backward compatible.** New structures write to stable top-level folders
  (`knowledge/`, `projects/<slug>/`, `learning/<slug>/`, `achievements/`) while legacy
  partitioned notes and pre-`project` task rows still read/round-trip. The CLI/MCP engine
  and the canvas store stay byte-compatible.

## [0.8.2] - 2026-07-23

### Fixed
- **Board card footer no longer clipped (canvas).** In the **To do** column, cards with
  many siblings had their footer — the 📅 due-date pill and tag chips — sliced off. The
  column's flex layout was shrinking each card below its natural content height while
  `overflow: hidden` hid the overflow, so the footer only showed in short columns (e.g.
  Done). Cards are now `flex: 0 0 auto`, keeping full height and letting the column scroll,
  so the due date and tags render consistently on every card.

### Added
- **"No due date" chip on undated board cards (canvas).** Open cards without a due date now
  show a muted **🗓️ No due date** chip in the footer, matching the layout of scheduled
  cards (priority → title → due/no-due chip → tags).

### Changed
- **Hardened canvas asset cache-busting (canvas).** The extension now injects a fresh
  per-request version token into `index.html` and sends strict no-cache headers, so the
  WebView always loads the latest `app.js`/`styles.css` after an update.

## [0.8.1] - 2026-07-23

### Added
- **Backlog column on the Kanban board (canvas).** Open tasks with **no due date** now
  collect in a new **📥 Backlog** column (first in the board) instead of mixing into
  **To do**, which is now reserved for scheduled tasks (due today or later). Its quick-add
  creates an unscheduled task; dragging a card **into** Backlog clears its due date, and
  dragging **out** to To do schedules it for today so cards no longer bounce back.
- **Emoji empty-state for every board column (canvas).** Columns with no cards now show a
  consistent pattern — a large emoji plus a short message (e.g. 📭 *No unscheduled tasks*,
  🎉 *Nothing overdue*, 🧯 *No blockers right now*, 🌱 *Nothing done yet*) — instead of a
  plain one-line hint.

### Fixed
- **Due date now clearly shown on board cards (canvas).** The card footer date was built
  from an HTML string in a low-contrast muted colour and could be hard to see. It is now
  rendered from explicit, high-contrast text nodes as a bold 📅 chip that shows the date
  **and** a relative label (**Today**, **Tomorrow**, **in 3d**, **2d overdue**), so the due
  date is legible at a glance on every scheduled card.

## [0.8.0] - 2026-07-23

### Changed
- **Redesigned Kanban board (canvas).** The Tasks ▦ Board was reworked for clarity and
  extensibility. Columns now have **colour-coded sticky headers** (dot · icon · title ·
  count pill) matched to each status — Overdue (red), To do (violet), Blocked (amber),
  Done (green) — with their own **height limit and vertical scroll** so long columns no
  longer stretch the page. Each real status column gained a header **＋** and a footer
  **＋ New** quick-add that opens the task modal with that column's status prefilled
  (Overdue prefills a due date of today). Cards were rebuilt for readability: solid panel
  background that stands out from the column, a **left accent bar coloured by priority**,
  a clear **header row** (priority / Blocked / Overdue badges + `#id`), a prominent
  **title** (click to open detail), and a divided **footer** with a due-date chip (📅,
  highlighted when due today or overdue) and tag chips. Columns are declared in a single
  `BOARD_COLS` config, so adding or reordering a column is a one-liner. Drag-and-drop
  between columns still updates status.

## [0.7.0] - 2026-07-22

### Added
- **Tasks calendar view (canvas).** Tasks gained a third view mode alongside List and
  Board: a **📅 Calendar** with **Month / Week** layouts, ‹ › + **Today** navigation, and
  the current day highlighted. Each day lists its due tasks as colour-coded chips (left
  edge by priority); a **Fields** menu chooses which extra info shows on each chip
  (Priority / Status / Tags — title always shown). Clicking a task opens the same detail
  popup as the List view. Undated tasks are noted below the grid.
- **Global persistent Pomodoro mini-timer (canvas).** A running Pomodoro now shows a
  floating dock pinned to the bottom-right corner that stays visible and keeps ticking on
  **every** view (Tasks, Dashboard, etc.), not just the Pomodoro page. The dock shows a
  live ring + MM:SS, a colour-coded session-type badge (focus / short break / long break),
  and **Pause / Resume / Stop** controls; clicking it opens the full Pomodoro page. A single
  app-wide timer loop now drives both the dock and the Pomodoro page (and re-syncs with the
  server every ~15s, so a session started from the CLI also surfaces in the canvas).
- **Pause / Resume.** Sessions can be paused and resumed from the dock or the Pomodoro page;
  the countdown freezes while paused and continues seamlessly on resume (backed by
  `POST /api/pomodoro/pause` and `/resume`, modelled via a `pausedAt` stamp so it survives
  process death like the rest of the timer).
- **Per-type colours.** The progress ring and status badge are colour-coded by session type
  (focus = red, short break = green, long break = blue) so the running type is obvious.
- **Dashboard focus analytics + period filter.** The dashboard gained a **Today / Week /
  Month** filter and a 🍅 Focus section (focus sessions, focus time, completed, abandoned)
  driven by that filter.
- **End-of-session notification + break suggestion.** When a session's countdown reaches
  zero you get a sound, a best-effort OS/browser notification, and an in-app prompt. After a
  **focus** session it suggests a **Short break / Long break / Another focus / Skip** (long
  break suggested after every 4th completed focus session, classic Pomodoro); after a break
  it offers **Start focus / Skip**. Nothing auto-starts — you always choose.

## [0.6.0] - 2026-07-22

### Added
- **"Blocked" task status** across every surface (CLI, MCP, Claude adapter, canvas, skill).
  Canonical statuses are now **Open** (shown as "To do"), **Blocked**, and **Done**.
  - CLI: `task add --status <Open|Blocked|Done>`, plus new `task block <id>` and
    `task unblock <id>` commands; `task list --status blocked`.
  - MCP: `task_add` gains an optional `status` enum and a new `task_set_status` tool.
  - Claude adapter: `add_task` honors an optional `status`; new `set_task_status` handler.
  - Canvas: the task **board** now has four columns — **Overdue · To do · Blocked · Done** —
    with drag-and-drop between them; the task modal has a **Status** selector; the list view
    shows a status badge; and a **All / Today / 7 days** due-date filter was added.

### Fixed
- **Data-loss bug:** the task write layer (`lib/cli-utils.js` and the canvas
  `catpilot-store.mjs`) previously grouped tasks into only *Open* vs *Done* sections and
  silently dropped any other status on save. A task set to `Blocked` would be deleted on the
  next write. The first section now persists **all not-done tasks** (Open *and* Blocked),
  keeping the real value in the `Status` cell. The on-disk markdown format is unchanged and
  fully backward compatible.

## [0.5.0] - 2026-07-22

### Added
- **Pomodoro productivity reports** — a new `report` capability across every surface
  that measures **completed focus sessions**, **focus minutes**, and **completion rate**
  (completed vs abandoned, plus a focus-only rate).
  - Periods: `today`, `this-week`, `last-week`, `this-month`, `last-month`, `last-7`,
    `last-30`, `all`. Grouping: `day`, `week` (ISO week), `task`, or `session`.
  - CLI: `cat-pilot pomodoro report [--period <p>] [--by <day|week|task|session>]`
    (add `--json` for machine output).
  - MCP tool: `pomodoro_report`. Claude adapter handler: `pomodoro_report`.
  - Canvas: a **Productivity** section in the Pomodoro view with a period/grouping
    selector, a focus-minutes bar chart, a completed-vs-abandoned donut, and a grouped
    table.
- **Configurable, persistent Pomodoro durations** — focus / short-break / long-break
  defaults now live in a top-level `pomodoro` block in `config.json`.
  - `cat-pilot setup` prompts for the three durations (Enter accepts 25/5/15).
  - The canvas **Settings → Pomodoro durations** card edits and saves them.
  - `pomodoro start` with no `--minutes` honors the configured default for that type;
    older configs are soft-defaulted so nothing breaks.

## [0.4.0] - 2026-07-21

### Added
- **Pomodoro focus timers** — a new `pomodoro` domain with full parity across every
  surface (standalone CLI, MCP server, Claude adapter, skill, agent, and the canvas UI).
  - Stateless timer model: a running session is stored as a `startedAt` timestamp +
    planned duration in an un-partitioned `pomodoro-active.json`, so `remaining` is
    recomputed on read and a timer survives process restarts and month boundaries and
    stays consistent no matter which surface you use.
  - Session types **focus (25) / short-break (5) / long-break (15)** with per-call or
    per-config overrides, an optional link to an existing task, and an append-only
    partitioned `pomodoro.md` history table.
  - CLI: `cat-pilot pomodoro start|status|stop|cancel|list|stats|run` (alias `pomo`),
    where `run` shows a live blocking terminal countdown.
  - MCP tools: `pomodoro_start|status|complete|cancel|list|stats`.
  - Canvas: a **Pomodoro** view with a live countdown ring, start controls (type +
    minutes + optional task picker), complete/cancel, a today stats strip, and a
    recent-sessions table.

### Changed
- **Version is now read from `package.json`** by the CLI (`--version`) and the MCP
  server instead of being hard-coded separately, removing the drift between the CLI,
  MCP server, and plugin manifest. Consolidated all manifests to `0.4.0`.

## [0.3.0] - 2026-07-20

### Added
- **GitHub Copilot canvas extension (`catpilot-canvas`)** — a modern, themeable side-panel
  UI for CatPilot that reads and writes the **same** config-driven storage as the CLI,
  agent, skills, and MCP server. Lives in `.github/extensions/catpilot-canvas/`.
  - Dashboard (summary cards, priority donut, last-3-days activity chart, focus list, recent feed).
  - Tasks in **list (table)** and **board (kanban)** views with inline complete, local edit/save, and detail popups.
  - Journal, Milestones, Memos, Learning, Growth, Projects — browse, add, and open detail views.
  - **Reports** — generate GitHub Copilot executive reports for any period and open them as markdown/HTML.
  - **Timeline** — a 7/14/30-day activity rail with one-click agent actions.
  - **Settings** — interactive storage/partition/migration wizard that previews exactly which files
    would move and gates the change behind an explicit approval before migrating.
  - **Markdown everywhere** — formatting toolbar, live preview, and ✨ Generate with Copilot on every field.
  - **Help** guide, global **Ask Copilot** button, first-run onboarding, and light/dark theme.
- Published the canvas to the **[Awesome Copilot](https://awesome-copilot.github.com/extensions/)** marketplace
  (`copilot plugin install catpilot-canvas@awesome-copilot`).

### Changed
- Documented canvas install paths (Copilot CLI marketplace, project-scoped, user-scoped, gist) and
  how the canvas renders in the **GitHub Copilot app** side panel.

### Packaging
- Added `publishConfig.access: "public"` so the scoped package publishes publicly, and added
  `canvas` / `copilot-extension` / `github-copilot-app` keywords.

## [0.2.2] - 2026-06-22

### Added
- Global shared storage configuration so every CatPilot surface (CLI, agent, MCP) reads/writes one location.

### Fixed
- `cat-pilot` first-time setup flow.

## [0.2.1] - 2026-06-22

### Fixed
- MCP server packaging — include `adapters/` in the published tarball.

### Added
- Plugin marketplace metadata and knowledge-OS domains.

## [0.2.0] - 2026-06-19

### Added
- Multi-surface MCP server, knowledge-OS domains, and Obsidian vault scaffold.

## [0.1.10] - 2026-03-18


### Fixed
- **Critical: Missing CLI executables in npm package** - `.gitignore` was excluding `bin/cat-cli.js` and `bin/cat-tui.js`, preventing `cat-pilot` and `cat-tui` commands from being available globally after install
- Updated `.gitignore` to include all three bin executables: `catpilot.js`, `cat-cli.js`, `cat-tui.js`
- Verified npm package now includes all CLI entry points and generates correct Windows command shims

## [0.1.9] - 2026-03-18

### Added
- Prepared for phase 3 development

## [0.1.8] - 2026-03-18

### Added
- **Full Gemini AI Adapter** - Complete implementation of 7 tools for Gemini CLI integration with response format normalization
- **Multi-Client Compatibility** - Comprehensive compatibility matrix showing feature parity across Copilot Plugin, CLI, and TUI
- **Phase 2 Documentation** - 5 new guides covering adapter specs, integration examples, release checklist, compatibility matrix, and project status
- **Adapter Integration Tests** - Test framework for validating Claude and Gemini adapters with standardized response formats

### Changed
- **ESM Migration** - Converted all 14 modules from CommonJS to ES6 modules for better tree-shaking and modern JavaScript support
- **README Restructure** - Completely redesigned README to clearly distinguish three separate entry points (Copilot Plugin, CLI, TUI) with capabilities matrix and realistic day-to-day examples
- **Doctor Command Enhanced** - Now runs as both Copilot plugin diagnostic (`catpilot doctor`) and standalone workspace diagnostic (`cat-pilot doctor`)

### Improved
- Clearer separation of concerns: Copilot agent features vs. standalone CLI vs. experimental TUI
- Better user guidance for choosing the right install path and entry point
- More accurate capability documentation with tested examples for each client type
- Reduced promise-making—TUI now explicitly marked as experimental dashboard

### Docs
- Added `docs/PHASE2-COMPATIBILITY.md` - 750+ lines on adapter response formats, capability matrix, verified APIs
- Added `docs/MULTI_CLIENT_EXAMPLES.md` - 600+ lines of practical code examples for each client
- Added `docs/RELEASE-v0.1.8.md` - Release checklist and quality metrics
- Added `docs/PHASE2-SUMMARY.md` - Phase 2 completion summary
- Added `PROJECT-STATUS.md` - Development status, architecture overview, entry points

## [0.1.7] - 2026-03-12

### Added
- Added `catpilot doctor` command for one-shot diagnostics when `CatPilot` does not appear in `/agents`.
- Added runtime diagnostics covering plugin root, `plugin.json`, agent file discovery, and `copilot --version` availability.
- Added README documentation for doctor workflow and `/agents` troubleshooting.

### Improved
- Added in-place upgrade path with `catpilot update` (no uninstall required).
- Added startup self-check warnings for missing plugin assets.

## [0.1.6] - 2026-03-12

### Added
- Added `catpilot update` command to update globally via npm.
- Added startup checks for `plugin.json`, `agents/`, and `agents/*.agent.md`.
- Added debug mode output via `CATPILOT_DEBUG=1`.
- Added README guidance for update and `/agents` troubleshooting.

[0.1.10]: https://github.com/tanure/cat-copilot/releases/tag/v0.1.10
[0.1.9]: https://github.com/tanure/cat-copilot/releases/tag/v0.1.9
[0.1.8]: https://github.com/tanure/cat-copilot/releases/tag/v0.1.8
[0.1.7]: https://github.com/tanure/cat-copilot/releases/tag/v0.1.7
[0.1.6]: https://github.com/tanure/cat-copilot/releases/tag/v0.1.6
