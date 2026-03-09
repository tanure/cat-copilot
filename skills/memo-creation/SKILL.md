---
name: memo-creation
description: "Creates short memos as markdown files in the configuration-resolved memos folder for Copilot CLI personal assistant workflows."
license: MIT
---

# Skill: memo-creation

## When to use
Use this skill when the user says things like:
- "Create a memo about ..."
- "Write a note on ..."
- "Capture a memo ..."

## Inputs to capture (ask only if missing)
**Required**
- Memo title
- Memo body/content

**Optional**
- Date (default: today)
- Tags

## Output format (configuration-aware)
Resolve memos target from `data/config.json` before any read/write.

Resolved memos folder path:
- `<storage.root>/<partition>/memos/`
- Partition folder mapping:
  - `day` -> `YYYY/YYYY-MM/YYYY-MM-DD`
  - `week` -> `YYYY/Www` (ISO week)
  - `month` -> `YYYY/YYYY-MM`

If `data/config.json` is missing or invalid, run `interactive-setup` first.

Create memo file format:
- File name: `YYYY-MM-DD_<slug>.md`
- Content:
```markdown
# <title>

Date: YYYY-MM-DD
Tags: tag1, tag2

## Notes
<body>
```

Rules:
1. If file name collision occurs, append `-2`, `-3`, etc.
2. Slug should be lowercase and hyphen-separated.
3. Never overwrite an existing memo file.
4. Do not include secrets, tokens, or passwords.

## Procedure
1. Resolve the memos folder from `data/config.json`.
2. Ensure target folder exists.
3. Build slug and target filename.
4. Create memo file with structured content.
5. Confirm what was written and where.

## Response style
- Confirm memo creation with `🧠` and include the resulting file path.
- Use `⚠️` for missing title/body.
- Use `❌` for write failures.

## Files
- `data/config.json` (required to resolve target)
- Resolved memos folder and memo file (authoritative target)
