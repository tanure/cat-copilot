---
catpilot: dashboard
title: Achievements
---

# 🏆 Achievements

Achievements are recorded manually or automatically when learning paths and projects
complete. They are created by the `achievement_*` MCP tools.

## Recent
```dataview
TABLE date, source_type, source, tags
FROM ""
WHERE catpilot = "achievement"
SORT date DESC
LIMIT 25
```

## By source type
```dataview
TABLE rows.file.link as Achievements
FROM ""
WHERE catpilot = "achievement"
GROUP BY source_type
SORT source_type ASC
```

## Tags
```dataview
LIST
FROM ""
WHERE catpilot = "achievement"
FLATTEN tags as t
GROUP BY t
```
