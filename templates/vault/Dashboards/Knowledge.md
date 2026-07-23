---
catpilot: dashboard
title: Knowledge
---

# 🧠 Knowledge

Knowledge Base notes live under `knowledge/<folder>/<slug>.md` and legacy `memos/`
notes remain readable. New notes are created by the `memo-creation` skill / `kb_*`
MCP tools with folder and tag frontmatter.

## Recent notes
```dataview
TABLE folder, tags, updated
FROM ""
WHERE catpilot = "memo"
SORT updated DESC, file.cday DESC
LIMIT 25
```

## By folder
```dataview
TABLE rows.file.link as Notes
FROM ""
WHERE catpilot = "memo"
GROUP BY folder
SORT folder ASC
```

## Tags
```dataview
LIST
FROM ""
WHERE catpilot = "memo"
FLATTEN tags as t
GROUP BY t
```
