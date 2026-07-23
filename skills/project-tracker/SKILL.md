---
name: project-tracker
description: "Tracks projects as indexed workspaces with requirements, tasks, milestones, linked main tasks, achievements, and progress rollups. Use when the user wants to create or update a project, check project status, ask Copilot about a project, or get a portfolio overview."
license: MIT
---

# Skill: project-tracker

## When to use
Use this skill when the user says things like:
- "Create a project ..."
- "Add a requirement/task/milestone to [project]."
- "What's the status of [project]?"
- "Give me a portfolio overview."
- "Ask Copilot about this project."
- "Mark [project] as done."

## Storage model (configuration-aware)
Projects are now **indexed workspaces**:
- Project index: `<storage.root>/projects/<slug>/index.md`
- Project items: `<storage.root>/projects/<slug>/items/<slug>.md`

The project index carries summary/status metadata. Child items represent project
requirements, project tasks, and project milestones. Main tasks can also link to a
project through the optional task `project` field/column; old task rows without that
field still parse. Milestones can link with `project:<slug>` in their optional Link
column.

If `data/config.json` is missing/invalid, run `interactive-setup` first.
Legacy generic `project_add` / `project_list` still exist for older flat project notes,
but new project work should use the project workspace tools.

## Project index format (Dataview-ready frontmatter)
```markdown
---
catpilot: project
title: "CatPilot"
status: "Active"
start: "2026-07-23"
due: "2026-08-31"
owner: "me"
summary: "Personal-secretary CLI/MCP plugin and canvas SPA"
tags: [project]
---

# 🎯 CatPilot

## Summary
## Notes
```

## Project item format
```markdown
---
catpilot: project-item
project: "catpilot"
type: task
status: "In Progress"
progress: 40
title: "Support Knowledge Base folders and tags"
due: "2026-08-01"
order: 1
---

# Support Knowledge Base folders and tags

Description, acceptance criteria and notes go in the body.
```

Allowed item types: `requirement`, `task`, `milestone`. Task and milestone items carry a
**`progress`** percent (0–100), a **`status`** (Open · In Progress · Blocked · Done), an
optional **`due`** date and free-form **notes** in the body; progress and status stay in
sync (100 → Done, 0 → Open, in-between → In Progress). Requirements describe scope and are
**excluded** from progress. Progress is **derived** as the **average** of trackable items
(tasks + milestones) plus linked main tasks. Legacy items without a `progress` field are
treated as 100 when `Done`, else 0.
Requirements, linked milestones, achievements, and the project summary are included
in project dashboards and reads.

## Inputs to capture (ask only if missing)
**Required**
- Title (project name)

**Optional**
- Start date, due date, status, summary, owner, tags
- Item type (`requirement`, `task`, `milestone`), title, status, progress (0-100), due date, notes, order

## MCP tools
Use the current project tools:
- `project_create` — create a project (`title`, `start`, `due`, `status`, `summary`, `owner`, `tags`).
- `project_board` — portfolio board of projects.
- `project_read` — read requirements, tasks, milestones, linked main tasks, achievements, and progress.
- `project_item_add` — add a requirement/task/milestone item (accepts `progress`, `status`, `due`, `notes`).
- `project_item_update` — update item fields such as `progress` (0-100), `status`, `due`, `notes`, `type`, or order.
- `project_complete` — complete a project and auto-record an achievement.

Back-compat tools:
- `project_add`, `project_list` — legacy flat project notes.

## Procedure
- **Create:** create `projects/<slug>/index.md` with project frontmatter; confirm resolved path.
- **Add/update items:** write child notes under `items/`; keep item order stable.
- **Roll up:** use `project_read` for status so linked main tasks, linked milestones, achievements, and derived progress are included.
- **Complete:** use `project_complete`; mention the achievement recorded.
- **Portfolio overview:** use `project_board` and report status/progress across active projects.

## Ask Copilot about this project
When the canvas button sends project context to the agent, ground suggestions in the
project's summary, requirements, project tasks, project milestones, linked main tasks,
linked milestones, and achievements. Useful responses include:
- suggested next tasks or follow-ups,
- gaps between requirements and planned work,
- blocked or overdue areas,
- recommendations to reduce risk or clarify scope.

Do not invent project facts; call out missing information as a gap.

## Response style
- Use `🎯` for confirmations, `⚠️` for missing inputs, `❌` for failures.
- Always include the resolved file path or project slug.
- Include derived progress when reporting status.

## Files
- `data/config.json` (required to resolve target)
- Resolved project `index.md` and child `items/*.md`
- Optionally reads tasks, milestones, and achievements for rollups
