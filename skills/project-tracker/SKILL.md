---
name: project-tracker
description: "Tracks lightweight per-project status as one note per project, rolling up linked tasks and milestones. Use when the user wants to create or update a project, check project status, or get a portfolio overview."
license: MIT
---

# Skill: project-tracker

## When to use
Use this skill when the user says things like:
- "Create a project ..."
- "Update the status of [project]."
- "What's the status across my projects?"
- "Mark [project] as done."
- "Give me a portfolio overview."

## Storage model (configuration-aware)
Projects are **per-file notes** (one per project), stored under:
- `<storage.root>/<partition>/projects/<YYYY-MM-DD_slug>.md`

If `data/config.json` is missing/invalid, run `interactive-setup` first.
If `storage.files.projects` is absent, default to a `projects` directory.

## Note format (Dataview-ready frontmatter)
```markdown
---
catpilot: project
title: "CatPilot"
status: "Active"
owner: "me"
due: "2026-07-31"
updated: "2026-06-19"
completed_date: ""
outcome: ""
tags: [project]
---

# 🎯 CatPilot

## Summary
## Current status
## Linked milestones / tasks
## Next steps
```

## Inputs to capture (ask only if missing)
**Required**
- Title (project name)

**Optional**
- Status (Active / Blocked / Done), owner, due date, summary

## Procedure
- **Create:** new project note with frontmatter; confirm resolved path.
- **Update:** edit `status`/`due`/`updated`; append to `## Current status` and `## Next steps`.
- **Roll up:** when asked for status, read tasks (`task-management`) and milestones
  (`milestone-tracking`), and relate open items to each project (by tag or name match).
- **Complete:** set `status: Done`, `completed_date`, and a one-line `outcome`.
- **Portfolio overview:** list active projects with status + next step (the Obsidian
  `Projects` dashboard renders this automatically).

## Response style
- Use `🎯` for confirmations, `⚠️` for missing inputs, `❌` for failures.
- Always include the resolved file path.

## Files
- `data/config.json` (required to resolve target)
- Resolved project note (authoritative target)
- Optionally reads tasks/milestones for rollups
