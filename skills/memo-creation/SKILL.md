---
name: memo-creation
description: "Creates and maintains Knowledge Base notes with folders and tags, while keeping legacy memo_* workflows compatible."
license: MIT
---

# Skill: memo-creation

## When to use
Use this skill when the user says things like:
- "Create a memo about ..."
- "Write a note on ..."
- "Capture this in my knowledge base ..."
- "Save this under [folder] with tags ..."
- "List notes tagged ..."

## Knowledge Base model (configuration-aware)
Memos have evolved into a foldered, tagged **Knowledge Base**. New writes go under:
- `<storage.root>/knowledge/<folder>/<slug>.md`

Legacy flat notes under `memos/` remain readable and are merged into lists for
backward compatibility, but new notes should be written to `knowledge/`.

If `data/config.json` is missing or invalid, run `interactive-setup` first.

## Note format (Obsidian/Dataview-ready frontmatter)
```markdown
---
catpilot: memo
title: "Release handover"
folder: "work"
tags: [handover, release]
created: "2026-07-23"
updated: "2026-07-23"
---

# Release handover

## Notes
<body>
```

## Inputs to capture (ask only if missing)
**Required**
- Title
- Body/content

**Optional**
- Folder (default to a sensible folder such as `general` if the user does not specify one)
- Tags (comma-separated or list)

## MCP tools
Prefer the Knowledge Base tools for new work:
- `kb_add` — create a note (`title`, `folder`, `tags`, `body`).
- `kb_list` — list notes, optionally filtered by folder or tag.
- `kb_read` — read a note.
- `kb_update` — edit title, folder, tags, or body.
- `kb_remove` — delete a note.
- `kb_folders` — return folder and tag counts.
- `kb_move` — move a note to another folder.

Compatible aliases still exist for older prompts and hosts:
- `memo_create`, `memo_list`, `memo_read`.

## Procedure
1. Resolve storage from `data/config.json`.
2. For new notes, choose or confirm the Knowledge Base folder and normalize tags.
3. Create or update the note under `knowledge/<folder>/<slug>.md` with the frontmatter above.
4. For list/read requests, include legacy `memos/` notes in results when the tool does so.
5. Confirm what changed and where.

Rules:
1. If a file name collision occurs, append `-2`, `-3`, etc.
2. Slugs should be lowercase and hyphen-separated.
3. Never overwrite an existing note unless the user asked to update it.
4. Do not include secrets, tokens, passwords, or confidential data.

## Examples
- "Save a knowledge note called Release handover in folder work tagged release,handover."
- "List knowledge notes tagged learning."
- "Move the onboarding note to folder team."

## Response style
- Confirm Knowledge Base changes with `🧠` and include the resulting file path.
- Use `⚠️` for missing title/body.
- Use `❌` for write failures.

## Files
- `data/config.json` (required to resolve target)
- Resolved `knowledge/<folder>/<slug>.md` note (authoritative target for new writes)
- Legacy `memos/` notes (readable for compatibility)
