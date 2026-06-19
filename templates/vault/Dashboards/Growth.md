---
catpilot: dashboard
title: Growth
---

# 🌱 Growth / Impact Log

Each accomplishment is its own note (created by the `growth` skill / `growth_*`
MCP tools). This is your private brag-doc and review-prep source.

> Keep employer-internal specifics here in the **private vault only**. Run the
> `sanitize` skill before exporting any of this to share publicly.

## By impact area
```dataview
TABLE area, date, impact
FROM ""
WHERE catpilot = "growth"
SORT date DESC
```

## This quarter
```dataview
TABLE area, impact
FROM ""
WHERE catpilot = "growth" AND date >= date(today) - dur(90 days)
SORT date DESC
```

## Tags
```dataview
LIST
FROM ""
WHERE catpilot = "growth"
FLATTEN tags as t
GROUP BY t
```
