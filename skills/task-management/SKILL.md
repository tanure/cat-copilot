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

## Inputs to capture (ask only if missing)
**Required**
- Title (short, action-oriented)

**Optional (only if user provides or it is clearly implied)**
- Id (numeric - if referring to an existing task)
- Due date (YYYY-MM-DD)
- Priority (P0/P1/P2/P3) or (High/Med/Low)
- Tags (comma-separated)
- Context (1 line)

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


## Examples

### Example 1 (minimal)
User: "Create a task to prepare REDACTED DR discussion notes"
Write:
| 1 | Open | Prepare REDACTED DR discussion notes |  |  |  |  |

### Example 2 (with metadata)
User: "Add a task: draft plugin demo outline due Friday priority high tag copilot-cli"
If date is not explicit, ask: "What date is Friday (YYYY-MM-DD)?"  
Then write:
| 2 | Open | Draft plugin demo outline | 2026-03-06 | High | copilot-cli | Draft first pass for CLI demo flow |

### Example 3 (avoid duplicates)
If the resolved tasks file already contains an open task "Draft plugin demo outline", do not add.
Reply with the existing reference and suggest updating metadata instead.

## Response style
- Use emojis in confirmations and list outputs.
- For task lists, prefix each row summary with `🟢` for Open and `✅` for Done.
- Use `⚠️` for duplicates or missing required inputs.
- Use `❌` for write/update failures.

## Files
- `data/config.json` (required to resolve target)
- Resolved tasks file (authoritative target)