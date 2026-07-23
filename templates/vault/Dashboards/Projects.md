---
catpilot: dashboard
title: Projects
---

# 🎯 Projects

Each project has an `index.md` note plus child `project-item` notes for requirements,
tasks, and milestones. CatPilot rolls up progress from project items and linked main
tasks.

## Active
```dataview
TABLE status, owner, start, due, summary
FROM ""
WHERE catpilot = "project" AND status != "Done"
SORT due ASC
```

## Project items
```dataview
TABLE project, type, status, due, order
FROM ""
WHERE catpilot = "project-item"
SORT project ASC, order ASC
```

## Done
```dataview
TABLE owner, due, summary
FROM ""
WHERE catpilot = "project" AND status = "Done"
SORT due DESC
```

## Tags
```dataview
LIST
FROM ""
WHERE catpilot = "project"
FLATTEN tags as t
GROUP BY t
```
