---
catpilot: dashboard
title: Learning
---

# 📚 Learning

Each learning path has an `index.md` note plus ordered `learning-step` notes under
`steps/`. Progress is derived from step completion by CatPilot.

## In progress
```dataview
TABLE goal, progress, target_date, next_review
FROM ""
WHERE catpilot = "learning" AND status != "Done"
SORT target_date ASC
```

## Steps
```dataview
TABLE learning, order, status
FROM ""
WHERE catpilot = "learning-step"
SORT learning ASC, order ASC
```

## Completed
```dataview
TABLE goal, progress, target_date
FROM ""
WHERE catpilot = "learning" AND status = "Done"
SORT target_date DESC
```

## Due for review (spaced repetition)
```dataview
TABLE next_review, progress
FROM ""
WHERE catpilot = "learning" AND next_review <= date(today) AND status != "Done"
SORT next_review ASC
```
