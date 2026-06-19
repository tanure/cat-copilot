---
catpilot: dashboard
title: Tasks
---

# ✅ Tasks

CatPilot stores tasks as a monthly markdown table at `YYYY/YYYY-MM/tasks.md`.
Dataview cannot read markdown-table rows directly, so this dashboard links the
relevant files and shows quick capture tips.

## This month
- Open the current month's `tasks.md` (e.g. `2026/2026-06/tasks.md`).

## All task files
```dataview
LIST
FROM ""
WHERE file.name = "tasks"
SORT file.path DESC
```

## Capture from any Copilot surface
- **CLI:** `cat-pilot task add "Prepare review" --due 2026-06-30 --priority P1`
- **Copilot chat (CLI / VS Code / App):** "Add a task to prepare my review, priority high."
- **MCP host:** call the `task_add` tool.
