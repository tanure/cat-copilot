---
name: task-management
description: "Manages tasks by creating well-structured entries in the configuration-resolved tasks file. Use when the user asks to list/add/remove/complete a task, todo, action item, follow-up, or next step."
license: MIT
---

# Skill: task-management

## When to use
Use this skill when the user says things like:
- "Create a task to …"
- "Add a todo …"
- "Capture an action item …"
- "Next step: …"
- "Remind me to …"
- "Complete a task …"
- "Remove a task …"
- "List my tasks"
- "What are my open tasks?"
- "What are my done tasks?"
- "Update task …"
- "List my completed tasks"
- "Log progress on a task …" / "Add a comment/note to task …"

## Inputs to capture (ask only if missing)
**Required**
- Title (short, action-oriented)

**Optional (only if user provides or it is clearly implied)**
- Id (numeric - if referring to an existing task)
- Due date (YYYY-MM-DD)
- Priority (P0/P1/P2/P3) or (High/Med/Low)
- Tags (comma-separated)
- Context (1 line)
- Status (`Open`, `In Progress`, `Blocked`, or `Done`; defaults to `Open`)
- **SMART details** — `goal`, `measure`, `steps`, `why`, plus the Eisenhower axes
  `importance` and `urgency` (see below)

## SMART tasks
A title alone rarely tells you how to start. CatPilot therefore supports optional SMART
fields on every task:

| Field | SMART dimension | The question it answers |
| --- | --- | --- |
| `goal` | **S**pecific | What exactly does "done" look like? |
| `measure` | **M**easurable | How will you know it worked? |
| `steps` | **A**chievable | What are the first concrete steps? |
| `why` | **R**elevant | Why does this matter right now? |
| `dueDate` | **T**ime-bound | When does it need to be done? (reuses the existing Due Date column) |

Plus two Eisenhower axes: `importance` (`High` / `Low`) and `urgency` (`High` / `Low`).
Leaving either empty means *auto* — CatPilot derives it from the due date, the priority,
the linked project and whether the task has a `why` / `measure`.

**None of this is mandatory.** Title is still the only required field.

### Coaching flow (important)
When a user gives you a vague task, be a helpful colleague, not a form:

1. Add the task immediately with whatever you have — never block on SMART questions.
2. Then ask **at most two or three** short, natural questions, with an example each. Prefer:
   - "What would 'done' look like for this?" *(goal)*
   - "How will you know it worked?" *(measure)*
   - "When does it realistically need to land?" *(due date)*
3. If the user shrugs or skips, that's fine — save what you have and move on.
4. Confirm with the SMART score (`x/5`) and mention the single most useful missing piece.
5. Never lecture about the acronym. The user cares about clarity, not methodology.

### Storage format
SMART fields live in a `## Task Details` section near the bottom of the tasks file, grouped
under a `### Task <id>` sub-heading (the same pattern as `## Task Log`), written **before**
`## Task Log`:

```
## Task Details

### Task 3
- **Goal:** Ship the v2 export endpoint behind a feature flag
- **Measure:** p95 < 300ms on staging and all export tests green
- **Why:** Unblocks the Q3 reporting milestone
- **Steps:** Draft schema → implement → test → roll out
- **Importance:** High
- **Urgency:** Low
```

Empty fields are omitted entirely, so a task with no SMART data writes no entry at all and
existing files are untouched. The section round-trips through every add/update/complete/remove.

CLI equivalents: `cat-pilot task add "…" --goal … --measure … --why … --steps …
--importance high --urgency low`, the interactive `cat-pilot task add "…" --guided`
coach, and `cat-pilot task smart <id>` to view or edit.
MCP tools: `task_add` (SMART params), `task_smart_set`.
In the canvas, the task modal has a collapsible **🎯 Make it SMART** section with a live
0–5 quality meter, and an **✨ Build with Copilot** button that drafts every field from a
plain-language description — the draft can be saved directly (**✅ Create this task**) or
opened in the form for edits (**✏️ Edit first**).

## Eisenhower Matrix
Every task is classified into a quadrant from its urgency and importance:

| Quadrant | Meaning | What to do |
| --- | --- | --- |
| **Q1** | Urgent & Important | Do now |
| **Q2** | Not Urgent & Important | Schedule |
| **Q3** | Urgent & Not Important | Delegate or batch |
| **Q4** | Not Urgent & Not Important | Drop or do later |

Derivation rules (all thresholds live in `lib/eisenhower.js`):
- **Urgency** — explicit `urgency` wins; otherwise urgent when the task is overdue, due today,
  due within 3 days, or priority is `P0`.
- **Importance** — explicit `importance` wins; otherwise important when priority is
  `P0`/`P1`/`High`, the task is linked to a project, or it has a `why` or a `measure`.

Classification results carry `source: "explicit" | "derived"` and a one-line `rationale`, so
an automatic placement is never a black box. Anything the user sets explicitly always wins.

CLI: `cat-pilot task matrix [--quadrant q1|q2|q3|q4] [--status …] [--json]`,
`cat-pilot task focus [--limit N]`, `cat-pilot task list --quadrant q2`.
MCP tools: `task_matrix`, `task_focus`, `task_carry`.
In the canvas, the Tasks page has a **🎯 Matrix** view mode with drag-and-drop between
quadrants (dropping a card pins its importance/urgency explicitly).

For triage, rebalancing and day planning, use the **prioritization-coach** skill.

## Tasks stranded in an earlier period

Storage is partitioned by period (month by default). A task lives in the file for the period it
was **created** in, and nothing moves it automatically — so after a rollover the current
period's `tasks.md` can be empty while a dozen tasks are still open in the previous one. To the
user this looks exactly like data loss, and *"where are my tasks?"* is the question it produces.

`list_tasks` returns a `stranded` summary (`{ total, partitions, current, hint }`, or `null`
when there is nothing to report). **Always check it**: if the current period looks empty or
thin and `stranded` is set, say where the tasks actually are before anything else — nothing is
lost, they are filed under an earlier period.

Then offer to move them: `task_carry` (`dryRun`, `ids`) or `cat-pilot task carry [--dry-run]
[--ids 4,12]`. Carrying **moves** open tasks into the current period, keeping their ID where
it is free, preserving SMART details and the progress log, and appending a
`Carried forward from …` log entry. Completed tasks stay where they were finished, so each
period keeps an honest record of what got done there.

Do not carry silently — show what will move first. A task that has been carried several months
running is usually a Q4 task in disguise; that is worth saying out loud rather than moving it
again.

## Task statuses
Canonical stored statuses are **`Open`** (shown as "To do" in the canvas),
**`In Progress`**, **`Blocked`**, and **`Done`**. "Overdue" is *derived* from an Open task
whose due date has passed — it is never a stored status and is not selectable. `In Progress`
and `Blocked` tasks live under `## Open Tasks` on disk (only `Done` tasks move to
`## Done Tasks`), so their real status is preserved in the `Status` cell and is never lost on
save.

## Output format (configuration-aware)
Resolve task target from `data/config.json` before any read/write.

Resolved task file path:
- `<storage.root>/<partition>/tasks.md`
- Partition folder mapping:
   - `day` -> `YYYY/YYYY-MM/YYYY-MM-DD`
   - `week` -> `YYYY/Www` (ISO week)
   - `month` -> `YYYY/YYYY-MM`

If `data/config.json` is missing or invalid, run `interactive-setup` first.

Append under `## Open Tasks` as a table, using this format:

| ID | Status | Title | Due Date | Priority | Tags | Context |
| --- | --- | --- | --- | --- | --- | --- |
| <ID> | <STATUS> | <TITLE> | YYYY-MM-DD | P2 | tag1, tag2 | <1-line context> |

Rules:
1. Every new task gets a unique incremental ID (e.g., 1, 2, 3, …).
2. Always keep the table structure with all 7 columns.
3. If due date is missing, leave the `Due Date` cell empty.
4. If priority is missing, leave the `Priority` cell empty.
5. If tags are missing, leave the `Tags` cell empty.
6. If context is missing, leave the `Context` cell empty.
7. Never create duplicates: before writing, scan the resolved tasks file for a similar open task title.

## Procedure

### Adding a new task
1. Resolve the tasks file from `data/config.json`.
2. Read the resolved tasks file.
3. Check if the task (or very similar wording) already exists under `## Open Tasks`.
   - If it exists, do **not** add it again; instead reply with:
     - "Already exists" and point to the existing line.
4. If it does not exist:
   - Append it under `## Open Tasks` as the newest item at the top (immediately after the heading).
5. Confirm to the user:
   - What was added
   - Where it was written (resolved tasks path)
6. Offer one helpful follow-up:
   - Ask for due date or priority only if missing and useful.

### Completing a task
1. Resolve the tasks file from `data/config.json`.
2. Read the resolved tasks file.
3. Find the task by ID or title under `## Open Tasks`.
4. If found, change its status to "Done" and move it under `## Done Tasks`.
5. Confirm to the user:
   - What was completed
   - Where it was updated (resolved tasks path)

### Blocking / unblocking a task
1. Resolve the tasks file from `data/config.json`.
2. Read the resolved tasks file.
3. Find the task by ID or title under `## Open Tasks`.
4. To block: set its status to `Blocked` (keep it under `## Open Tasks`).
   To unblock: set its status back to `Open`.
5. Confirm what changed and where it was written.

CLI equivalents: `cat-pilot task block <id>` and `cat-pilot task unblock <id>`;
`cat-pilot task add "…" --status Blocked` creates a task already blocked.

### Removing a task
1. Resolve the tasks file from `data/config.json`.
2. Read the resolved tasks file.
3. Find the task by ID or title under `## Open Tasks` or `## Done Tasks`.
4. If found, remove it from the file.
5. Confirm to the user:
   - What was removed
   - Where it was updated (resolved tasks path)

### Listing tasks
1. Resolve the tasks file from `data/config.json`.
2. Read the resolved tasks file.
3. If the user asks for open tasks, list all tasks under `## Open Tasks`.

### Listing completed tasks
1. Resolve the tasks file from `data/config.json`.
2. Read the resolved tasks file.
3. If the user asks for completed tasks, list all tasks under `## Done Tasks`.

### Updating a task
1. Resolve the tasks file from `data/config.json`.
2. Read the resolved tasks file.
3. Find the task by ID or title under `## Open Tasks` or `## Done Tasks`.
4. If found, update the relevant fields (e.g., due date, priority, tags, context).
5. Confirm to the user:
   - What was updated
   - Where it was updated (resolved tasks path)

### Logging progress (task comments)
Tasks carry a **progress log** of dated comments so you can record what you're acting on
without editing the task's fields.

1. Resolve the tasks file and find the task by ID.
2. Append the comment to the task's log — stored in a `## Task Log` section at the bottom of
   the tasks file, grouped under a `### Task <id>` sub-heading, one Obsidian-friendly bullet
   per comment:

   ```
   ## Task Log

   ### Task 3
   - **2026-03-06 14:20** — Reviewed the API docs and scoped the change.
   - **2026-03-07 09:05** — Blocked on staging creds; pinged infra.
   ```

   Each comment is single-line (`—` is U+2014); the timestamp is `YYYY-MM-DD HH:MM` local time.
3. The log round-trips through every task edit — adding/removing tasks never drops it.

CLI equivalents: `cat-pilot task comment add <id> "<text>"`,
`cat-pilot task comment list <id>`, `cat-pilot task comment remove <id> <index>`.
MCP tools: `task_comment_add`, `task_comment_list`, `task_comment_edit`, `task_comment_remove`.
In the canvas, open a task's detail to see the **Progress log** timeline and add/edit/remove
updates with the markdown editor.


## Examples

### Example 1 (minimal)
User: "Create a task to prepare release notes draft"
Write:
| 1 | Open | Prepare release notes draft |  |  |  |  |

### Example 2 (with metadata)
User: "Add a task: draft plugin demo outline due Friday priority high tag copilot-cli"
If date is not explicit, ask: "What date is Friday (YYYY-MM-DD)?"  
Then write:
| 2 | Open | Draft plugin demo outline | 2026-03-06 | High | copilot-cli | Draft first pass for CLI demo flow |

### Example 3 (avoid duplicates)
If the resolved tasks file already contains an open task "Draft plugin demo outline", do not add.
Reply with the existing reference and suggest updating metadata instead.

### Example 4 (SMART coaching — the good version)
User: "add a task to fix the export thing"

Do this:
1. Add it right away: `| 4 | Open | Fix the export thing |  |  |  |  |`
2. Then coach, lightly:

> 📝 Added **Fix the export thing** (#4).
>
> Two quick things to make it easier to pick up later:
> - What would "fixed" look like — e.g. *"exports finish under 30s for the biggest account"*?
> - When does it need to be done?

3. User replies "exports under 30s, needed before the demo on the 12th". Update the task with
   `goal` and `dueDate`, then confirm:

> ✅ Sharpened #4 — 🎯 SMART 3/5 · Q1 · Do now (due in 4 days).
> Add a *why* and it'll be a 4/5, but this is already actionable.

**Do not** fire five questions at once, and **do not** refuse to save until the user answers.

### Example 5 (matrix request)
User: "what should I work on?"
Call `task_focus`, then answer with a short ranked list — quadrant, deadline and a one-line
reason per task — and end with one concrete suggestion (start the top item, or reschedule
something out of Q1 if it is overloaded).

## Response style
- Use emojis in confirmations and list outputs.
- For task lists, prefix each row summary with `🟢` for Open, `🚧` for In Progress, `⛔` for Blocked, and `✅` for Done.
- Use `⚠️` for duplicates or missing required inputs.
- Use `❌` for write/update failures.

## Files
- `data/config.json` (required to resolve target)
- Resolved tasks file (authoritative target)