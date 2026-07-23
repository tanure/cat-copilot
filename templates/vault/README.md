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

CatPilot writes data under the root, e.g.:

```
<vault>/2026/2026-06/tasks.md
<vault>/2026/2026-06/journal.md
<vault>/2026/2026-06/milestones.md
<vault>/knowledge/work/handover.md
<vault>/learning/az-104/index.md
<vault>/learning/az-104/steps/identity.md
<vault>/2026/2026-06/growth/shipped-mcp-server.md
<vault>/projects/catpilot/index.md
<vault>/projects/catpilot/items/support-knowledge.md
<vault>/achievements/2026-06-19_passed-az-104.md
```

## 3. Recommended plugins (Obsidian)
- **Dataview** — powers the dashboards in `Dashboards/`.
- **Templates** (core) — use the notes in `_templates/` for new knowledge, learning, growth, projects, and achievements.
- **Calendar** (optional) — nice with the month partitioning.

## Folders
- `Dashboards/` — Dataview Maps of Content (MOCs) that aggregate everything.
  - `Home.md`, `Tasks.md`, `Knowledge.md`, `Learning.md`, `Growth.md`, `Projects.md`, `Achievements.md`
- `_templates/` — Obsidian note templates with the frontmatter CatPilot/Dataview expect.
  - `knowledge.md`, `memo.md` (legacy), `learning.md`, `growth.md`, `project.md`, `achievement.md`

The data folders are created **on demand** by CatPilot; you don't pre-create them.
Per-file domains (knowledge, learning, growth, projects, achievements) carry
frontmatter and `tags: []` so Dataview and the Obsidian graph can query them.

See `../../docs/OBSIDIAN_KNOWLEDGE_BASE.md` for the full guide.
