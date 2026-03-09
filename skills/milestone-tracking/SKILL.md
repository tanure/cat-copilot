---
name: milestone-tracking
description: "Creates and updates milestones in the configuration-resolved milestones file for Copilot CLI personal assistant workflows."
license: MIT
---

# Skill: milestone-tracking

## When to use
Use this skill when the user says things like:
- "Add milestone ..."
- "Track milestone ..."
- "Update milestone status ..."
- "List milestones"

## Inputs to capture (ask only if missing)
**Required**
- Milestone name

**Optional**
- Target date (YYYY-MM-DD)
- Status (`Planned`, `In Progress`, `Done`)
- Notes

## Output format (configuration-aware)
Resolve milestones target from `data/config.json` before any read/write.

Resolved milestones file path:
- `<storage.root>/<partition>/milestones.md`
- Partition folder mapping:
  - `day` -> `YYYY/YYYY-MM/YYYY-MM-DD`
  - `week` -> `YYYY/Www` (ISO week)
  - `month` -> `YYYY/YYYY-MM`

If `data/config.json` is missing or invalid, run `interactive-setup` first.

Use a table format:

| ID | Name | Target Date | Status | Notes |
| --- | --- | --- | --- | --- |
| <ID> | <NAME> | YYYY-MM-DD | Planned | <notes> |

Rules:
1. Every milestone gets a unique incremental ID.
2. Keep all 5 columns; leave optional cells empty when missing.
3. Allowed status values: `Planned`, `In Progress`, `Done`.
4. Avoid duplicate active milestones with very similar names.

## Procedure
1. Resolve the milestones file from `data/config.json`.
2. Read the resolved milestones file; create it with table headers if missing.
3. For add: insert new milestone row under the table.
4. For update: find by ID or name and update selected fields.
5. For list: return all rows in concise format.
6. Confirm what changed and where.

## Response style
- Use milestone status emojis: `🟡` Planned, `🔵` In Progress, `✅` Done.
- Use `⚠️` for duplicates or missing required fields.
- Use `❌` for write/update failures.

## Files
- `data/config.json` (required to resolve target)
- Resolved milestones file (authoritative target)
