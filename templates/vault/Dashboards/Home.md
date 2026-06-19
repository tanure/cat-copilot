---
catpilot: dashboard
title: Home
---

# 🐱 CatPilot — Home

> Your second brain's front door. Requires the **Dataview** plugin.

## 🎯 Active projects
```dataview
TABLE status, owner, updated
FROM ""
WHERE catpilot = "project" AND status != "Done"
SORT updated DESC
```

## 📚 Learning in progress
```dataview
TABLE goal, progress, target_date
FROM ""
WHERE catpilot = "learning" AND status != "Done"
SORT target_date ASC
```

## 🌱 Recent growth / impact
```dataview
TABLE area, date
FROM ""
WHERE catpilot = "growth"
SORT date DESC
LIMIT 10
```

## 🧠 Recent memos
```dataview
LIST
FROM ""
WHERE catpilot = "memo"
SORT file.cday DESC
LIMIT 10
```

## 🔗 Sub-dashboards
- [[Tasks]]
- [[Learning]]
- [[Growth]]
- [[Projects]]

> Tasks, journal, and milestones are stored as monthly markdown tables/logs under
> `YYYY/YYYY-MM/`. Use Obsidian search or open the current month's files directly.
