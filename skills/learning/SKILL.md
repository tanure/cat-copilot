---
name: learning
description: "Tracks certification prep, courses, and study goals as learning paths with ordered steps, derived progress, reviews, and achievements. Use when the user wants to plan or update learning, study for a certification, log study progress, or schedule reviews."
license: MIT
---

# Skill: learning

## When to use
Use this skill when the user says things like:
- "I'm studying for [certification/exam]."
- "Plan a learning path for ..."
- "Track my prep for ..."
- "Add steps for this course ..."
- "What should I review today?"
- "Mark this learning step as done."
- "Mark [certification] as passed / complete."

## Storage model (configuration-aware)
Learning is now a **path + ordered steps** model:
- Parent path: `<storage.root>/learning/<slug>/index.md`
- Child steps: `<storage.root>/learning/<slug>/steps/<slug>.md`

The path frontmatter stores the goal, status, target date, next review, and tags.
Progress is **derived** as the **average of each step's `progress`** (partial progress
counts, not just done/total) and is not manually calculated by the assistant. When all
steps reach 100%, the path can auto-complete and an achievement is recorded.

If `data/config.json` is missing or invalid, run `interactive-setup` first.
Legacy generic `learning_add` / `learning_list` still exist for flat notes, but new
certification or course planning should use learning paths.

## Path format (Obsidian/Dataview-ready frontmatter)
```markdown
---
catpilot: learning
title: "AZ-104"
goal: "Pass the exam"
status: "In Progress"
progress: "0%"
target_date: "2026-09-01"
next_review: "2026-07-30"
tags: [learning, certification]
---

# 📚 AZ-104

## Goal
## Resources
## Notes
```

## Step format
```markdown
---
catpilot: learning-step
learning: "az-104"
status: "In Progress"
progress: 40
order: 1
due: "2026-08-15"
title: "Review identity and governance"
---

# Review identity and governance

Notes, resources and acceptance criteria for the step go in the body.
```

A step carries a **`progress`** percent (0–100), a **`status`** (Todo · In Progress ·
Blocked · Done), an optional **`due`** date and free-form **notes** in the body. Progress
and status stay in sync: setting `progress` to 100 marks it Done, 0 marks it Todo, and any
value in between marks it In Progress (and vice-versa). Legacy steps without a `progress`
field are treated as 100 when `Done`, else 0.

Learning steps are **separate from main tasks**. Never add learning steps to the
tasks file unless the user explicitly asks for a separate task reminder.

## Inputs to capture (ask only if missing)
**Required**
- Path title (topic, course, or certification name)

**Optional**
- Goal, target date (YYYY-MM-DD), next review date, tags, ordered steps, resources

## MCP tools
Use the path tools for current workflows:
- `learning_path_add` — create a parent path.
- `learning_path_list` — list paths with status and derived progress.
- `learning_path_read` — read a path with steps and derived progress.
- `learning_step_add` — add an ordered step (accepts `progress`, `status`, `due`, `notes`).
- `learning_step_update` — update step `progress` (0-100), `status`, `due`, `notes`, title or order.
- `learning_path_complete` — complete a path and record an achievement.

Back-compat tools:
- `learning_add`, `learning_list` — legacy flat learning notes.

## Procedure
- **Create path:** capture title/goal/target date/tags and create `learning/<slug>/index.md`.
- **Add steps:** create ordered `learning-step` notes under `steps/`; keep order stable.
- **Update progress:** set each step's `progress` (0-100) and/or `status`; report the
  path's averaged progress from `learning_path_read`.
- **Review due:** list paths where `next_review <= today`, sorted ascending.
- **Complete:** use `learning_path_complete` when all steps are done or the user confirms completion; mention the achievement recorded.
- **Copilot drafting:** in the canvas Learning view, "✨ Generate with Copilot" drafts a goal plus ordered steps; review the draft before saving.

## Spaced review
When the user logs meaningful progress, suggest a `next_review` date (for example,
+1 week or +1 month). The Learning dashboard surfaces paths due for review.

## Response style
- Use `📚` for confirmations, `⚠️` for missing inputs, `❌` for failures.
- Always include the resolved path or path slug in responses.
- Mention derived progress as the averaged percentage (and `done/total` steps) when available.

## Files
- `data/config.json` (required to resolve target)
- Resolved learning path `index.md` and child `steps/*.md`
- Achievement note recorded on completion
