# Surfaces & Parity

CatPilot runs the **same engine** behind four surfaces. Storage is always resolved
from a shared config (global `~/.catpilot/config.json` by default), so data stays in
sync no matter which directory you capture from.

## At a glance

| Capability | CLI (`cat-pilot`) | Copilot CLI plugin | Copilot in VS Code | Copilot App | MCP (any host) |
| --- | --- | --- | --- | --- | --- |
| Tasks | ✅ | ✅ | ✅ | ✅ | ✅ `task_*` |
| SMART task details | ✅ | ✅ | ✅ | ✅ | ✅ `task_add`, `task_smart_set` |
| Eisenhower Matrix | ✅ `task matrix` | ✅ | ✅ | ✅ | ✅ `task_matrix` |
| Focus plan / triage | ✅ `task focus` | ✅ | ✅ | ✅ | ✅ `task_focus` |
| Carry tasks forward | ✅ `task carry` | ✅ | ✅ | ✅ | ✅ `task_carry` |
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
- Each task carries a **progress log** of dated comments (`## Task Log` in the tasks file),
  editable from the CLI (`cat task comment …`), MCP (`task_comment_*`) and the canvas task
  detail timeline.
- Each task can also carry optional **SMART details** — Goal, Measure, Steps, Why, plus
  explicit Importance/Urgency — stored in a `## Task Details` section of the same file and
  editable from the CLI (`cat-pilot task add --goal … / --guided`, `cat-pilot task smart <id>`),
  MCP (`task_smart_set`) and the canvas task modal. They feed the **Eisenhower Matrix**
  (Q1 Do now · Q2 Schedule · Q3 Delegate or batch · Q4 Drop or later), which is derived
  deterministically from due date, priority, project links and SMART fields unless you pin an
  axis explicitly. `prioritization-coach` is the chat skill on top.
- Tasks are stored per **period** (the partition folder, e.g. `2026/2026-09`). A task with a
  due date in a *later* period is written to that period's file, so planning ahead lands in
  the right month; a past due date stays in the current period.

## Canvas views
The browser canvas SPA provides richer review and editing views:
- **Tasks:** four modes — List, Kanban (Backlog, Overdue, To do, In Progress, Blocked, Done),
  Calendar, and the **🎯 Eisenhower Matrix** (four quadrant panels, tasks grouped by
  Overdue / Today / Next 7 days / Later / Completed, drag-and-drop between quadrants,
  per-quadrant quick-add). A **month dropdown** picks which period the List, Board and Matrix
  act on (default: current, with open counts per month). Older months show a **Carry over
  unfinished** banner, and the task detail offers **Move…** to re-file a single task. The
  **Calendar** reads across every period so tasks appear on their due date whichever month's
  file holds them. The task modal has a collapsible **🎯 Make it SMART** section with
  a live 0–5 quality meter and an **✨ Build with Copilot** popup; the toolbar has
  **🎯 Focus plan** and **🧭 Triage with Copilot**. The task detail shows a **Progress log**
  timeline with a markdown write/preview/Copilot editor, the quadrant badge with its
  rationale, and the SMART fields.
- **Knowledge:** stats header, folder and tag filter rails, Grid/List/Folders/By-month
  view modes, search, Markdown detail popup, and a full write/preview editor with
  Save/Delete plus folder/tag editing.
- **Learning:** dashboard stats and progress bars, filters for All/In progress/Completed/Reviews due,
  and a **full-page path detail** (route `#learning/<slug>`) with its own stats dashboard,
  step checklist and in-page actions. "✨ Generate with Copilot" drafts a goal and ordered steps.
- **Projects:** portfolio grid with status/progress and a **full-page project dashboard**
  (route `#projects/<slug>`) covering timeline, requirements, tasks, milestones, linked
  tasks, linked milestones, and achievements. "Ask Copilot about this project" sends project
  context to the agent for suggestions, follow-ups, gaps, and recommendations.
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
