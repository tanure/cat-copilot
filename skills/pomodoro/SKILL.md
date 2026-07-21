---
name: pomodoro
description: "Runs Pomodoro focus/break timers and logs completed sessions. Use when the user wants to start a focus timer, take a break, check how much time is left, stop/cancel a running Pomodoro, or review focus stats. Sessions can optionally be linked to a task."
license: MIT
---

# Skill: pomodoro

## When to use
Use this skill when the user says things like:
- "Start a Pomodoro" / "Start a 25 minute focus timer."
- "Focus on task #7 for 50 minutes."
- "Take a 5 minute break."
- "How much time is left?" / "Pomodoro status."
- "Stop / finish / cancel my Pomodoro."
- "How many focus sessions did I do today/this week?"

## Storage model (configuration-aware)
Two files, both resolved from `data/config.json`:

- **Active session** — a single un-partitioned JSON file at
  `<storage.root>/pomodoro-active.json`. Only one timer runs at a time. Because
  the CLI/MCP/canvas are stateless, "running" is derived from `startedAt` + the
  planned duration, so the timer survives process death and is identical on every
  surface:
  `remaining = plannedMin*60 - (now - startedAt)`.
- **History** — an append-only markdown table `pomodoro.md` in the current
  partition (`<storage.root>/<partition>/pomodoro.md`), mirroring `tasks.md`.

Partition mapping: `day` -> `YYYY/YYYY-MM/YYYY-MM-DD`, `week` -> `YYYY/Www`,
`month` -> `YYYY/YYYY-MM`.

If `data/config.json` is missing or invalid, run `interactive-setup` first.
If `storage.files.pomodoro` is absent, default to `pomodoro.md`.

## Session types & defaults
- `focus` — default **25** min
- `short-break` — default **5** min
- `long-break` — default **15** min

Durations can be overridden per call (`minutes`) or via an optional
`pomodoro` block in config, e.g. `{ "pomodoro": { "focus": 50 } }`.

## History table format
```markdown
# Pomodoro Sessions

## Sessions

| ID | Type | Task | Started | Ended | Planned (min) | Actual (min) | Status | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | focus | #7 Review issues | 2026-07-21T11:00:00.000Z | 2026-07-21T11:25:03.000Z | 25 | 25 | completed |  |
```
`Status` is `completed` or `abandoned`.

## Procedure
- **Start:** refuse if a session is already running (offer to stop/cancel it, or
  pass `force`). Confirm type, planned minutes, and any linked task; echo the
  resolved active-state path.
- **Status:** compute and report remaining time; flag when a session has expired.
- **Complete (stop):** finalize the running session, append a `completed` row with
  the actual minutes, and clear active state.
- **Cancel:** clear active state and append an `abandoned` row.
- **List:** show recent sessions (newest first).
- **Stats:** report session counts and total focus minutes for `today`, `week`,
  `month`, or `all`.

## Task linking
When the user references a task by id (`#7`/`7`) or exact title, store it as a
`#<id> <title>` label so the history is readable and cross-references tasks.

## Response style
- Use `🍅`/`⏱️` for confirmations, `🔔` when a timer finishes, `⚠️` for missing
  inputs, `❌` for failures.
- Always include the resolved file path in write responses.

## Files
- `data/config.json` (required to resolve targets)
- `<storage.root>/pomodoro-active.json` (running timer state)
- Resolved `pomodoro.md` history file (authoritative log)
