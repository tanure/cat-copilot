# `data/` — local workspace scaffold (mostly git-ignored)

This folder holds **local, machine-specific** CatPilot state. Almost everything here
is intentionally **git-ignored** so your personal content never lands in the public repo.

## Tracked (public, safe to commit)
- `config.template.json` — the default config shape used by `setup` and tests.
- `README.md` — this file.

## Ignored (private, never committed)
- `config.json` — your real config; `storage.root` usually points at a private
  Obsidian vault **outside** this repo.
- `*.md`, `*.md.bak`, `memos/` — any personal tasks/journal/milestones/memos.

## How storage actually works
CatPilot resolves all read/write targets from `config.json` → `storage.root`.
In normal use that root is your **private vault** (Layer 2), not this folder.
See `../docs/PRIVACY_AND_BOUNDARIES.md` and `../docs/OBSIDIAN_KNOWLEDGE_BASE.md`.

To initialize a config from the template:

```bash
cat-pilot setup
```
