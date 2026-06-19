---
catpilot: dashboard
title: Learning
---

# 📚 Learning

Each learning topic is its own note (created by the `learning` skill / `learning_*`
MCP tools) with frontmatter Dataview can query.

## In progress
```dataview
TABLE goal, progress, target_date, file.cday as created
FROM ""
WHERE catpilot = "learning" AND status != "Done"
SORT target_date ASC
```

## Completed
```dataview
TABLE goal, completed_date
FROM ""
WHERE catpilot = "learning" AND status = "Done"
SORT completed_date DESC
```

## Due for review (spaced repetition)
```dataview
TABLE next_review
FROM ""
WHERE catpilot = "learning" AND next_review <= date(today)
SORT next_review ASC
```
