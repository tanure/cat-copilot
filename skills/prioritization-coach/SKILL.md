---
name: prioritization-coach
description: "Coaches the user on what to work on next using the Eisenhower Matrix and SMART tasks. Use when the user asks what to focus on, wants their tasks triaged or prioritized, feels overloaded, asks for a day/week plan, or wants help deciding what to drop."
license: MIT
---

# Skill: prioritization-coach

## When to use
Use this skill when the user says things like:
- "What should I work on?" / "What's next?"
- "Help me prioritize" / "Triage my tasks"
- "I'm overloaded" / "Everything feels urgent"
- "Plan my day" / "Plan my week"
- "Show me my Eisenhower Matrix"
- "What can I drop?"
- "Is this task actually important?"

For simply creating, listing or completing tasks, use **task-management** instead.

## The model

**Eisenhower Matrix** — two binary axes, four quadrants:

| | Urgent | Not Urgent |
| --- | --- | --- |
| **Important** | **Q1 · Do now** — crises, real deadlines | **Q2 · Schedule** — where progress actually happens |
| **Not Important** | **Q3 · Delegate or batch** — interruptions wearing a deadline | **Q4 · Drop or do later** — nice-to-haves |

The whole point of the matrix is to spend more time in **Q2**. A large Q1 means firefighting;
a large Q3 means other people's priorities are setting your agenda; a large Q4 means clutter.

**SMART** sharpens the individual task: `goal` (Specific), `measure` (Measurable),
`steps` (Achievable), `why` (Relevant), `dueDate` (Time-bound). A task with a `why` and a
`measure` is almost always genuinely important — that is exactly why the classifier uses them.

## Tools

| Tool | Use it for |
| --- | --- |
| `task_matrix` | Every task grouped by quadrant, then by Overdue / Today / Next 7 days / Later / No date / Completed. Also returns `insights` (counts + coaching hints). |
| `task_focus` | Ranked "what to do next" list with a `focusReason` and a SMART `nudge` per task. |
| `task_smart_set` | Pin `importance` / `urgency`, or fill in `goal` / `measure` / `steps` / `why`. |
| `list_tasks` / `task_list` | Filter by `quadrant`, status, tag or project. |

CLI equivalents: `cat-pilot task matrix`, `cat-pilot task focus --limit 5`,
`cat-pilot task smart <id> [--guided]`, `cat-pilot task list --quadrant q2`.

Read `task.eisenhower.source`: `"explicit"` means the user decided, `"derived"` means CatPilot
guessed. **Only ever propose changes to derived placements** unless the user asks otherwise.

## Procedures

### 1. Focus ("what should I work on?")
1. Call `task_focus` with a limit of 3–6. More than that is not a focus list.
2. Answer with a short ranked list: title, quadrant, deadline, one-line reason.
3. Close with **one** concrete suggestion — start the top item, or, if Q1 is overloaded,
   name the specific task to reschedule first.
4. Do not dump the whole matrix unless asked.

### 2. Triage
1. Call `task_matrix`.
2. Collect every task with `eisenhower.source === "derived"`.
3. For each, judge from the title, context and SMART fields:
   - **Important?** Does it move a real goal, project or milestone forward — or is it just loud?
   - **Urgent?** Does it genuinely need attention in the next ~3 days?
4. Present a compact table of proposed changes with a one-line reason each. **Change nothing yet.**
5. After the user confirms, apply with `task_smart_set` (`importance`, `urgency`).
6. For any task still too vague to start, suggest a concrete `goal` or `measure` — offer the
   wording, don't just ask for it.

### 3. Rebalancing an overloaded matrix
Read the `insights.hints` from `task_matrix`, then coach concretely:
- **Q1 >= 5** → firefighting. Pick the ones with soft deadlines and move them to Q2 by giving
  them a later but *realistic* date. Name them.
- **Q2 empty** → nothing long-term is planned. Ask what would matter in a month, and turn the
  answer into one dated Q2 task.
- **Q3 >= 3** → propose batching (a single block for all of them), automation, or handing off.
- **Q4 >= 5** → propose specific deletions. Frame dropping as a win, not a failure.
- **Many undated tasks** → urgency is being guessed. Ask for dates on the top few only.

### 4. Day / week plan
1. Call `task_focus` (limit 5–8) and `task_matrix` for balance.
2. Propose rough time blocks: Q1 first, then one protected Q2 block, then a single batched
   Q3 block. Leave slack — a plan with no gaps fails on contact with reality.
3. Flag anything that should be dropped or moved before it is started.
4. Offer to log the plan with the **journal-entry** skill.

## Response style
- Be direct and warm. You are a colleague with a clear head, not a productivity guru.
- Use the quadrant emojis: 🔥 Q1, 🗓️ Q2, 🤝 Q3, 🧊 Q4.
- Always explain *why* something sits where it does — one line is enough.
- Never present more than ~6 items as "focus". Prioritization means leaving things out.
- Suggest concrete wording rather than asking open questions when the user seems tired or stuck.
- Never apply importance/urgency changes without confirmation.
- Use `⚠️` when the matrix is clearly unbalanced, `✅` after applying changes.

## Files
- `data/config.json` (required to resolve target)
- Resolved tasks file (authoritative target) — quadrants are computed, never stored;
  only explicit `Importance` / `Urgency` are persisted, in `## Task Details`.
