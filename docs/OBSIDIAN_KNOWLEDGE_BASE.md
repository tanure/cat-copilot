# Obsidian Knowledge Base Guide

How to use your CatPilot vault as a second brain in Obsidian. This pairs with
`PRIVACY_AND_BOUNDARIES.md` (the two-layer model) and works identically whether you
drive CatPilot from Copilot CLI, Copilot in VS Code, or the Copilot App.

## 1. Set up the vault
1. Copy `templates/vault/` into your real vault location (local or synced folder).
2. Open that folder as a vault in Obsidian.
3. Install the **Dataview** plugin (Settings → Community plugins) and enable it.
4. Point CatPilot's `data/config.json` `storage.root` at the vault path.

## 2. How CatPilot lays out data
Storage is **config-driven and partitioned by month** (default):

```
<vault>/
├── Dashboards/            # Dataview MOCs (from the template)
├── _templates/            # Obsidian note templates (from the template)
└── 2026/
    └── 2026-06/
        ├── tasks.md       # markdown table (Open/Completed)
        ├── journal.md     # append-only daily log
        ├── milestones.md  # markdown table
        ├── memos/         # one .md per memo  (frontmatter: catpilot: memo)
        ├── learning/      # one .md per topic (frontmatter: catpilot: learning)
        ├── growth/        # one .md per win   (frontmatter: catpilot: growth)
        └── projects/      # one .md per project (frontmatter: catpilot: project)
```

Two storage styles, on purpose:
- **Aggregate files** (`tasks`, `journal`, `milestones`) — compact, fast to scan/search.
- **Per-file domains** (`memos`, `learning`, `growth`, `projects`) — each note carries
  YAML frontmatter, so **Dataview** can query, group, and roll them up.

## 3. Dashboards (Dataview)
The scaffold ships these in `Dashboards/`:
- `Home.md` — projects, learning, recent growth, recent memos in one place.
- `Tasks.md`, `Learning.md`, `Growth.md`, `Projects.md` — focused views.

Every queryable note has a `catpilot:` frontmatter key (`project`, `learning`,
`growth`, `memo`) which the queries filter on. Example:

```dataview
TABLE goal, progress, target_date
FROM ""
WHERE catpilot = "learning" AND status != "Done"
SORT target_date ASC
```

## 4. Daily / weekly / quarterly flow
- **Daily:** capture tasks + a journal line from whichever surface you're in.
- **Weekly:** ask Copilot to "summarize my week" (daily-summary) and log a growth note
  for anything notable.
- **Quarterly:** ask Copilot to "generate an impact summary from my growth log"
  (the `growth` skill) — your private, review-ready material.

## 5. Spaced review for certifications
`learning` notes include a `next_review` date. The Learning dashboard surfaces
topics due for review so cert prep doesn't go stale.

## 6. Keep it private
- The vault is **Layer 2** — never committed to the public repo.
- Run the `sanitize` skill before exporting anything to share publicly.
- Internal program names (e.g. your employer's review process) stay in the vault only;
  the public engine uses neutral terms (`growth`, `review-prep`, `learning`).

## 7. Optional power-ups in the private vault
Because the vault is just markdown, you can layer your own tools on top without
touching the public engine: Templater, Tasks plugin, Kanban, Calendar, Excalidraw,
or Git-based versioning of the vault in a **private** repo.
