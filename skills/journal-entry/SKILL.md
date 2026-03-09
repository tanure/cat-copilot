---
name: journal-entry
description: "Captures journal entries in the configuration-resolved journal file for GitHub Copilot CLI personal assistant workflows."
license: MIT
---

# Skill: journal-entry

## When to use
Use this skill when the user says things like:
- "Add a journal entry ..."
- "Log this in my journal ..."
- "Write today's reflection ..."
- "Capture this note in journal ..."

## Inputs to capture (ask only if missing)
**Required**
- Detail text (free-form)

**Optional**
- Entry date (default: today)
- Tags

## Output format (configuration-aware)
Resolve journal target from `data/config.json` before any read/write.

Resolved journal file path:
- `<storage.root>/<partition>/journal.md`
- Partition folder mapping:
  - `day` -> `YYYY/YYYY-MM/YYYY-MM-DD`
  - `week` -> `YYYY/Www` (ISO week)
  - `month` -> `YYYY/YYYY-MM`

If `data/config.json` is missing or invalid, run `interactive-setup` first.

Append-only format:
```markdown
## YYYY-MM-DD
- <entry detail>
```

Rules:
1. Journal is append-only; do not rewrite previous entries.
2. If the date heading is missing, create it.
3. Keep newest entries at the bottom under the date heading.
4. Do not store secrets, tokens, or passwords.

## Procedure
1. Resolve the journal file from `data/config.json`.
2. Read the resolved journal file if it exists; otherwise create it.
3. Ensure heading `## YYYY-MM-DD` exists for the entry date.
4. Append the new bullet entry under that heading.
5. Confirm what was added and where it was written.

## Response style
- Confirm appended entries with `📝` and include the target file path.
- Use `⚠️` for missing details.
- Use `❌` for write failures.

## Files
- `data/config.json` (required to resolve target)
- Resolved journal file (authoritative target)
