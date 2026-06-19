---
name: learning
description: "Tracks certification prep, courses, and study topics as per-topic notes with progress and spaced-review dates. Use when the user wants to plan or update learning, study for a certification, log study progress, or schedule reviews."
license: MIT
---

# Skill: learning

## When to use
Use this skill when the user says things like:
- "I'm studying for [certification/exam]."
- "Track my prep for ..."
- "Log study progress on ..."
- "What should I review today?"
- "Add a learning goal ..."
- "Mark [topic] as done / passed."

## Storage model (configuration-aware)
Learning topics are **per-file notes** (one note per topic), stored under the
configuration-resolved learning directory:
- `<storage.root>/<partition>/learning/<YYYY-MM-DD_slug>.md`
- Partition mapping: `day` -> `YYYY/YYYY-MM/YYYY-MM-DD`, `week` -> `YYYY/Www`, `month` -> `YYYY/YYYY-MM`.

If `data/config.json` is missing or invalid, run `interactive-setup` first.
If `storage.files.learning` is absent, default to a `learning` directory.

## Note format (Obsidian/Dataview-ready frontmatter)
```markdown
---
catpilot: learning
title: "AZ-104"
goal: "Pass the exam"
status: "In Progress"
progress: "0%"
target_date: "2026-09-01"
completed_date: ""
next_review: "2026-07-01"
tags: [learning]
---

# 📚 AZ-104

## Goal
## Resources
## Progress log
- 2026-06-19 — started

## Notes
```

## Inputs to capture (ask only if missing)
**Required**
- Title (the topic, course, or certification name)

**Optional**
- Goal, target date (YYYY-MM-DD), next review date, status, resources

## Procedure
- **Add:** create a new note with frontmatter; confirm the resolved path.
- **Update progress:** append a dated bullet under `## Progress log` and update
  `progress`/`status`/`next_review` in frontmatter.
- **Complete:** set `status: Done` and `completed_date`.
- **Review due:** list notes where `next_review <= today`, sorted ascending.
- Avoid duplicates: scan the learning directory for an existing topic of the same name.

## Spaced review
When the user logs solid progress, suggest a `next_review` date (e.g. +1 week, +1 month).
The Obsidian `Learning` dashboard surfaces topics due for review.

## Response style
- Use `📚` for confirmations, `⚠️` for missing inputs, `❌` for failures.
- Always include the resolved file path in responses.

## Files
- `data/config.json` (required to resolve target)
- Resolved learning note (authoritative target)
