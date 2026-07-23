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
- Ask Copilot for a **daily/weekly summary** and save it as a Knowledge Base note.
- Review **learning**: "What learning paths are due for review?" Re-schedule as needed.
- Update **projects**: "Give me a portfolio overview of my active projects." Note status.
- Triage tasks: complete, defer, block, start, or drop. Keep the list honest.

## Monthly (30 min)
**Connect the dots.**
- Open Obsidian. Visit the `Dashboards/` pages (Tasks, Knowledge, Learning, Growth, Projects, Achievements).
- Link related notes; add tags so the graph connects knowledge, projects, learning, and achievements.
- Convert finished learning into a **growth** entry (what you can now do).

## Quarterly (60 min) — Review prep
**Turn evidence into a narrative.**
1. Ask Copilot: "Summarize my growth notes, achievements, and milestones this quarter
   into an impact summary, grouped by theme."
2. Run the **`sanitize`** skill on the output — strip any employer-internal specifics.
3. Save the sanitized summary as a Knowledge Base note; copy the private, detailed
   version into your vault's growth area (never the repo).
4. Map the neutral impact summary to whatever review/promotion format you use privately.

## Build a Knowledge Base
**Foldered notes beat scattered notes.**
- Create notes with a folder and tags: "Save this as a Knowledge Base note in `work`, tagged `handover` and `release`."
- Use folders for broad areas and tags for cross-cutting themes.
- Weekly: list stale or high-value notes by folder/tag and update them instead of duplicating.

## Plan a certification with Copilot
**Turn a goal into ordered steps.**
- Ask: "Generate a learning path for AZ-104 with a goal, target date, and ordered steps."
- In the canvas Learning view, use **✨ Generate with Copilot** to draft the path, then save it.
- Mark steps done as you study; progress is derived from the checklist, not from main tasks.
- Weekly: ask what reviews are due; completed paths record achievements automatically.

## Run a project
**Make the work visible.**
- Create the project with a summary, owner, start date, optional due date, and tags.
- Add project items as `requirement`, `task`, or `milestone` so the dashboard rolls up progress.
- Link main tasks to the project when they belong on the project dashboard.
- Use **Ask Copilot about this project** to get suggested next tasks, follow-ups, gaps, and risk recommendations grounded in the project's context.

## Record achievements
**Separate completion evidence from growth narrative.**
- Learning path and project completion record achievements automatically.
- Add manual achievements for meaningful wins that are not tied to a path or project.
- Review achievements before quarterly impact summaries; turn the best ones into growth notes if useful.

## Link a milestone
**Connect outcomes to the right dashboard.**
- Use the milestone `Link` value `project:<slug>` to show it on a project dashboard.
- Use `learning:<slug>` to show it on a learning path dashboard.
- Leave `Link` empty for standalone milestones.

## Cert / study sprints
- `learning_path_add` a path for the cert with a goal and target date.
- Add ordered steps with `learning_step_add`; do not put those steps in the main tasks file.
- Log study sessions as journal/growth notes so progress is visible.
- Weekly: ask for what's due for review; quarterly: roll completed certs into growth.

## Principles
- **One brain, many doors.** Capture wherever you are; it all syncs via `data/config.json`.
- **Neutral by default.** Keep the repo and shared summaries generic; keep specifics in
  the private vault.
- **Capture fast, curate slow.** Daily is for capture; weekly/monthly is for structure.

See `SURFACES.md` for which door to use, and `OBSIDIAN_KNOWLEDGE_BASE.md` for the vault setup.
