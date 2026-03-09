---
name: interactive-setup
description: "Runs first-time and reconfiguration setup for storage root, partitioning, and migration behavior used by CatPilot in Copilot CLI."
license: MIT
---

# Skill: interactive-setup

## When to use
Use this skill when:
- The user says "setup", "configure", "reconfigure", or "change storage".
- A write action is requested and `data/config.json` does not exist or is invalid.

## Inputs to capture
**Required**
- Storage root path
- Partitioning mode: `day` | `week` | `month`
- Migration mode: `adopt` | `copy` | `move`

**Optional**
- User confirmation for external paths

## Config target
Write configuration to:
- `data/config.json`

Expected shape:
```json
{
  "version": 1,
  "storage": {
    "root": "data",
    "partitioning": "month",
    "allowExternalPaths": true,
    "files": {
      "tasks": "tasks.md",
      "journal": "journal.md",
      "milestones": "milestones.md",
      "memos": "memos"
    }
  },
  "migration": {
    "mode": "move"
  }
}
```

## Procedure
1. Check if `data/config.json` exists and is valid JSON.
2. If setup is first-run or user asked to reconfigure, ask these questions in order:
   1. "Where should data be stored (path)?"
   2. "How should data be partitioned: day, week, or month?"
   3. "How should existing legacy data be handled: move, copy, or adopt?"
3. Normalize and echo resolved target path.
4. If path is outside workspace, ask explicit confirmation before writing.
5. Write `data/config.json` with captured values.
6. If legacy files exist (`data/tasks.md`, `data/journal.md`, `data/milestones.md`, `memos/`), apply migration mode:
   - `move`: move legacy data into resolved destination and keep a `.bak` backup in legacy location.
   - `copy`: copy legacy data into resolved destination and keep originals.
   - `adopt`: keep legacy locations and set config to use them as current source of truth.
7. Confirm summary:
   - Config file path
   - Effective storage root
   - Partitioning mode
   - Migration mode
   - What moved/copied/adopted

## Safety rules
- Never delete legacy data during setup.
- Reject suspicious traversal-only paths.
- Keep setup idempotent: re-running setup should not duplicate content.

## Response style
- Use `🛠️` while asking setup questions.
- Use `✅` when setup/reconfigure completes.
- Use `⚠️` for external-path risk confirmations.
- Use `❌` for invalid config/path errors.

## Files
- `data/config.json` (required)
- `data/tasks.md` (legacy source)
- `data/journal.md` (legacy source)
- `data/milestones.md` (legacy source)
- `memos/` (legacy source)
