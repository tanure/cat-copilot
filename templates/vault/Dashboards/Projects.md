---
catpilot: dashboard
title: Projects
---

# 🎯 Projects

Each project is its own note (created by the `project-tracker` skill / `project_*`
MCP tools) with a status rollup.

## Active
```dataview
TABLE status, owner, due, updated
FROM ""
WHERE catpilot = "project" AND status != "Done"
SORT updated DESC
```

## Done
```dataview
TABLE completed_date, outcome
FROM ""
WHERE catpilot = "project" AND status = "Done"
SORT completed_date DESC
```
