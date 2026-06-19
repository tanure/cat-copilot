---
name: growth
description: "Maintains a private accomplishment log (brag-doc) and turns journal, milestones, and wins into a neutral, review-ready impact summary. Use when the user logs an achievement, prepares for a performance/career review, or asks for an impact summary."
license: MIT
---

# Skill: growth

## When to use
Use this skill when the user says things like:
- "Log a win / accomplishment ..."
- "Add to my brag doc ..."
- "I want to prepare for my review / promotion."
- "Summarize my impact this quarter."
- "Turn my journal and milestones into an impact summary."

## Purpose & boundaries
This is the user's **private** growth log and review-prep source. It stays in the
**private vault (Layer 2)** and is never committed to the public repo.

> Vocabulary rule: keep this domain **neutral and generic** (growth / impact / review-prep).
> Do NOT bake any employer-specific review-program names into files written to the repo.
> The user may privately map these entries to their employer's process in the vault.

Always run the `sanitize` skill before producing anything intended to be shared
outside the vault (remove customer names, codenames, confidential metrics, secrets).

## Storage model (configuration-aware)
Growth entries are **per-file notes** (one per accomplishment), stored under:
- `<storage.root>/<partition>/growth/<YYYY-MM-DD_slug>.md`

If `data/config.json` is missing/invalid, run `interactive-setup` first.
If `storage.files.growth` is absent, default to a `growth` directory.

## Note format (Dataview-ready frontmatter)
```markdown
---
catpilot: growth
title: "Shipped the CatPilot MCP server"
area: "delivery"
date: "2026-06-19"
impact: "Unified tasks/journal across CLI, VS Code, and App"
tags: [growth]
---

# 🌱 Shipped the CatPilot MCP server

## Situation
## What I did
## Impact (quantify where possible)
## Who benefited / collaborators
```

## Inputs to capture (ask only if missing)
**Required**
- Title (the accomplishment)

**Optional**
- Area (delivery, leadership, learning, collaboration, ...), impact statement, date

## Procedure
- **Log a win:** create a growth note; prompt for a one-line quantified impact.
- **Impact summary / review prep:**
  1. Gather signal from the growth notes (and optionally journal + milestones).
  2. Group by `area`; produce concise STAR-style bullets (Situation, Task, Action, Result).
  3. Run `sanitize` and present a neutral, shareable summary.
  4. Offer to save the summary as a memo via `memo-creation`.

## Response style
- Use `🌱` for confirmations, `⚠️` for missing inputs, `❌` for failures.
- Always include the resolved file path. Remind the user this content is private.

## Files
- `data/config.json` (required to resolve target)
- Resolved growth note (authoritative target)
- Optionally reads journal/milestones for summaries
