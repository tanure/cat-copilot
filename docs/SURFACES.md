# Surfaces & Parity

CatPilot runs the **same engine** behind four surfaces. Storage is always resolved
from a shared config (global `~/.catpilot/config.json` by default), so data stays in
sync no matter which directory you capture from.

## At a glance

| Capability | CLI (`cat-pilot`) | Copilot CLI plugin | Copilot in VS Code | Copilot App | MCP (any host) |
| --- | --- | --- | --- | --- | --- |
| Tasks | ✅ | ✅ | ✅ | ✅ | ✅ `task_*` |
| Journal | ✅ | ✅ | ✅ | ✅ | ✅ `journal_*` |
| Milestones | ➖ | ✅ | ✅ | ✅ | ➖ (skill) |
| Knowledge Base | ✅ | ✅ | ✅ | ✅ | ✅ `kb_*` (`memo_*` aliases) |
| Learning paths | ✅ | ✅ | ✅ | ✅ | ✅ `learning_path_*`, `learning_step_*` |
| Growth | ✅ | ✅ | ✅ | ✅ | ✅ `growth_*` |
| Projects | ✅ | ✅ | ✅ | ✅ | ✅ `project_*` |
| Achievements | ✅ | ✅ | ✅ | ✅ | ✅ `achievement_*` |
| Daily summary | ➖ | ✅ | ✅ | ✅ | ➖ (skill) |
| Reports | ➖ | ✅ | ✅ | ✅ | ➖ (skill) |
| Sanitize guardrail | ➖ | ✅ | ✅ | ✅ | ➖ (skill) |
| Config introspection | ✅ `doctor` | ✅ | ✅ | ✅ | ✅ `config_info` |

✅ supported · ➖ not exposed on that surface (use another surface for it)

Notes:
- **Skills** (milestones, daily-summary, reports, sanitize) are reasoning workflows
  that run inside Copilot chat surfaces (CLI plugin, VS Code, App). The MCP server
  exposes the deterministic data tools; the agent composes skills on top.
- The **standalone CLI** is best for fast, scriptable capture and automation.
- **MCP** is the portable core: any MCP-capable host gets the data tools.
- Task statuses are `Open`, `In Progress`, `Blocked`, and `Done`; the canvas shows
  `Open` as **To do** and derives **Overdue** from due dates.

## Canvas views
The browser canvas SPA provides richer review and editing views:
- **Tasks:** Kanban columns for Backlog, Overdue, To do, In Progress, Blocked, and Done.
- **Knowledge:** stats header, folder and tag filter rails, Grid/List/Folders/By-month
  view modes, search, Markdown detail popup, and a full write/preview editor with
  Save/Delete plus folder/tag editing.
- **Learning:** dashboard stats and progress bars, filters for All/In progress/Completed/Reviews due,
  path detail with a step checklist, and "✨ Generate with Copilot" to draft a goal
  and ordered steps.
- **Projects:** portfolio grid with status/progress and a project dashboard covering
  timeline, requirements, tasks, milestones, linked tasks, linked milestones, and
  achievements. "Ask Copilot about this project" sends project context to the agent
  for suggestions, follow-ups, gaps, and recommendations.
- **Achievements:** completed learning paths, completed projects, and manual achievements.
- **Milestones:** supports filtering by optional links such as `project:<slug>` or
  `learning:<slug>`.

## Which surface for what
- **Capture on the go / scripting:** standalone CLI (`cat-pilot task add ...`).
- **Conversational planning + summaries + reports:** Copilot CLI plugin or App.
- **Editor + Obsidian second brain:** Copilot in VS Code (MCP).
- **Embedding CatPilot elsewhere:** MCP from any host.

## The one rule that makes parity work
There is a single storage layer (`lib/cli-utils.js` + `lib/domains.js`) and a single
config, resolved globally (`~/.catpilot/config.json`) so it's the same from any
directory. Every surface calls into it — no duplicated logic, no divergent data. Point
the config root at your Obsidian vault and you have one brain with many doors.

See also: `INSTALL.md`, `USING_IN_VSCODE.md`, `OBSIDIAN_KNOWLEDGE_BASE.md`.
