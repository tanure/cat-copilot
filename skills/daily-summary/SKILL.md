---
name: daily-summary
description: "Creates a daily summary from tasks, journal, milestones, and memos using configuration-resolved paths in Copilot CLI workflows."
license: MIT
---

# Skill: daily-summary

## When to use
Use this skill when the user says things like:
- "Summarize my day"
- "Create a daily summary"
- "What did I do today?"

## Inputs to capture (ask only if missing)
**Required**
- Summary date (default: today)

**Optional**
- Focus area (work/personal/project)

## Output format (configuration-aware)
Resolve all targets from `data/config.json` before any read/write.

Resolved paths:
- Tasks: `<storage.root>/<partition>/tasks.md`
- Journal: `<storage.root>/<partition>/journal.md`
- Milestones: `<storage.root>/<partition>/milestones.md`
- Memos: `<storage.root>/<partition>/memos/`

If `data/config.json` is missing or invalid, run `interactive-setup` first.

Summary output style:
- Return concise sections: `Tasks`, `Journal`, `Milestones`, `Memos`, `Next Actions`.
- Optionally persist summary memo in resolved memos folder as `YYYY-MM-DD_daily-summary.md` when user asks to save it.

Rules:
1. Read-only by default unless user explicitly asks to save summary.
2. Keep summaries concise and action-oriented.
3. If a source file is missing, continue with available sources and note the gap.

## Procedure
1. Resolve configured paths from `data/config.json`.
2. Read available sources for the summary date/partition.
3. Build concise summary sections.
4. If user requests persistence, write summary memo file.
5. Confirm outcome and file path when saved.

## Response style
- Use emoji section labels: `✅ Tasks`, `📝 Journal`, `🎯 Milestones`, `🧠 Memos`, `➡️ Next Actions`.
- Use `ℹ️` if any source file is missing.
- Use `❌` on read/write failures.

## Files
- `data/config.json` (required to resolve targets)
- Resolved tasks/journal/milestones files and memos folder
