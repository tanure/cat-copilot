# Privacy & Boundaries — The Two-Layer Model

CatPilot is designed so it can be **open-sourced and used publicly** while your
**personal, employer-internal content stays private**. This is achieved with two layers.

## Layer 1 — Public generic engine (this repository)
What lives here, safe to share:
- The agent (`agents/`), skills (`skills/`), MCP server (`mcp/`), CLI/TUI (`bin/`, `lib/`).
- Templates and scaffolds (`templates/`, `data/config.template.json`).
- Documentation.

Rules for Layer 1:
- **No real personal data.** No tasks, journal entries, memos, learning logs, or
  growth/review content with real specifics.
- **No employer-internal vocabulary.** Use neutral, generic domain names
  (e.g. "growth" / "review-prep" rather than any internal performance-review program;
  "learning" rather than a specific certification program name).
- **No secrets, ever.**

## Layer 2 — Private personal vault (outside this repository)
This is your real second brain. It typically lives in an **Obsidian vault** on
local disk or a synced folder (OneDrive/iCloud/Dropbox). Your `data/config.json`
points `storage.root` at this vault.

What lives here:
- Your actual tasks, journal, milestones, memos.
- Learning/certification progress.
- Growth log / brag-doc / review-prep material (including notes you privately map to
  your employer's review program — kept here, never pushed to the public repo).

Rules for Layer 2:
- It is **never committed** to the public repo (`.gitignore` enforces this).
- Secrets are still blocked here by the `sanitize` skill — a private vault is not a
  place for passwords or tokens.
- When you export anything from the vault to share publicly, run `sanitize` first.

## How separation is enforced
- `.gitignore` excludes personal markdown under `data/`, the resolved `data/config.json`,
  and any `vault/` checked out locally. Only templates are tracked.
- The agent runs a **pre-write sanitization guardrail** (see `skills/sanitize`).
- Examples in skills/docs use neutral placeholders (e.g. `[CUSTOMER]`, `[PROJECT]`).

## Quick self-check before publishing or sharing
1. Does the diff contain real customer/partner names, codenames, or metrics? → redact.
2. Any tokens/keys/passwords? → remove (never store).
3. Any internal program/tool names? → keep in the vault, neutralize for sharing.
4. Does `storage.root` in any committed file point at a private path? → it must not;
   only `config.template.json` (with `root: "data"`) is committed.

## TL;DR
- **Engine = public.** **Content = private.**
- The repo ships templates and tools, not your data.
- `sanitize` is the gate between the two.
