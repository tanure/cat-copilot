---
catpilot: dashboard
title: Home
---

# 🐱 CatPilot — Home

> Your second brain's front door. Requires the **Dataview** plugin.

## 🎯 Active projects
```dataview
TABLE status, owner, due, summary
FROM ""
WHERE catpilot = "project" AND status != "Done"
SORT due ASC
```

## 📚 Learning in progress
```dataview
TABLE goal, progress, target_date, next_review
FROM ""
WHERE catpilot = "learning" AND status != "Done"
SORT target_date ASC
```

## 🧠 Recent knowledge
```dataview
TABLE folder, tags, updated
FROM ""
WHERE catpilot = "memo"
SORT updated DESC, file.cday DESC
LIMIT 10
```

## 🏆 Recent achievements
```dataview
TABLE date, source_type, source
FROM ""
WHERE catpilot = "achievement"
SORT date DESC
LIMIT 10
```

## 🌱 Recent growth / impact
```dataview
TABLE area, date
FROM ""
WHERE catpilot = "growth"
SORT date DESC
LIMIT 10
```

## 🔗 Sub-dashboards
- [[Tasks]]
- [[Knowledge]]
- [[Learning]]
- [[Growth]]
- [[Projects]]
- [[Achievements]]

> Tasks, journal, and milestones are stored as monthly markdown tables/logs under
> `YYYY/YYYY-MM/`. Use Obsidian search or open the current month's files directly.
