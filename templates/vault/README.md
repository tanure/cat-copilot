# CatPilot Vault Template (Obsidian-ready)

This is a **scaffold** for your private CatPilot vault (Layer 2). Copy it to wherever
you keep your second brain (a local folder or a synced one like OneDrive/iCloud/Dropbox),
open it as an **Obsidian vault**, then point CatPilot at it.

## 1. Copy the scaffold
Copy the contents of this `templates/vault/` folder into your real vault location, e.g.:

```
C:\Users\you\OneDrive\ObsidianVault\
```

## 2. Point CatPilot at the vault
Edit `data/config.json` in the CatPilot repo (or run `cat-pilot setup`) and set:

```json
{
  "storage": {
    "root": "C:/Users/you/OneDrive/ObsidianVault",
    "partitioning": "month"
  }
}
```

CatPilot writes partitioned data under the root, e.g.:

```
<vault>/2026/2026-06/tasks.md
<vault>/2026/2026-06/journal.md
<vault>/2026/2026-06/memos/2026-06-19_handover.md
<vault>/2026/2026-06/learning/az-104.md
<vault>/2026/2026-06/growth/shipped-mcp-server.md
<vault>/2026/2026-06/projects/catpilot.md
```

## 3. Recommended plugins (Obsidian)
- **Dataview** — powers the dashboards in `Dashboards/`.
- **Templates** (core) — use the notes in `_templates/` for new memos/learning/growth/projects.
- **Calendar** (optional) — nice with the month partitioning.

## Folders
- `Dashboards/` — Dataview Maps of Content (MOCs) that aggregate everything.
- `_templates/` — Obsidian note templates with the frontmatter CatPilot/Dataview expect.

The data folders (`2026/...`) are created **on demand** by CatPilot; you don't
pre-create them. Per-file domains (memos, learning, growth, projects) carry
frontmatter so Dataview can query them.

See `../../docs/OBSIDIAN_KNOWLEDGE_BASE.md` for the full guide.
