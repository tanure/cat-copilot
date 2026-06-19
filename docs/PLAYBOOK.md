# CatPilot Playbook

An opinionated routine for turning daily capture into projects shipped, skills
learned, and a review you can write with confidence. Use any surface — the data
lands in the same vault.

## Daily (2–5 min)
**Capture, don't organize.**
- Start: dump today's tasks. `cat-pilot task add "..."` or ask Copilot "add a task...".
- During the day: log wins, decisions, and blockers as they happen.
  - "Log a journal note: decided to use MCP for cross-surface parity."
  - "Log a growth note: unblocked the release; impact: shipped a day early."
- End: `cat-pilot task list` (or ask for a daily summary) to see what's open.

## Weekly (15 min)
**Reflect and roll up.**
- Ask Copilot for a **daily/weekly summary** and save it as a memo.
- Review **learning**: "What learning topics are due for review?" Re-schedule as needed.
- Update **projects**: "Give me a portfolio overview of my active projects." Note status.
- Triage tasks: complete, defer, or drop. Keep the list honest.

## Monthly (30 min)
**Connect the dots.**
- Open Obsidian. Visit the `Dashboards/` pages (Tasks, Learning, Growth, Projects).
- Link related notes; add a Map-of-Content for any project that's growing.
- Convert finished learning into a **growth** entry (what you can now do).

## Quarterly (60 min) — Review prep
**Turn evidence into a narrative.**
1. Ask Copilot: "Summarize my growth notes and milestones this quarter into an
   impact summary, grouped by theme."
2. Run the **`sanitize`** skill on the output — strip any employer-internal specifics.
3. Save the sanitized summary as a memo; copy the private, detailed version into your
   vault's growth area (never the repo).
4. Map the neutral impact summary to whatever review/promotion format you use privately.

## Cert / study sprints
- `learning add "<cert>" --goal "..." --target_date YYYY-MM-DD`.
- Log study sessions as journal/growth notes so progress is visible.
- Weekly: ask for what's due for review; quarterly: roll completed certs into growth.

## Principles
- **One brain, many doors.** Capture wherever you are; it all syncs via `data/config.json`.
- **Neutral by default.** Keep the repo and shared summaries generic; keep specifics in
  the private vault.
- **Capture fast, curate slow.** Daily is for capture; weekly/monthly is for structure.

See `SURFACES.md` for which door to use, and `OBSIDIAN_KNOWLEDGE_BASE.md` for the vault setup.
