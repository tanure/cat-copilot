# Surfaces & Parity

CatPilot runs the **same engine** behind four surfaces. Storage is always resolved
from a shared config (global `~/.catpilot/config.json` by default), so data stays in
sync no matter which directory you capture from.

## At a glance

| Capability | CLI (`cat-pilot`) | Copilot CLI plugin | Copilot in VS Code | Copilot App | MCP (any host) |
| --- | --- | --- | --- | --- | --- |
| Tasks | ✅ | ✅ | ✅ | ✅ | ✅ `task_*` |
| Journal | ✅ | ✅ | ✅ | ✅ | ✅ `journal_*` |
| Milestones | ➖ | ✅ | ✅ | ✅ | ➖ (skill) |
| Memos | ✅ | ✅ | ✅ | ✅ | ✅ `memo_*` |
| Learning | ✅ | ✅ | ✅ | ✅ | ✅ `learning_*` |
| Growth | ✅ | ✅ | ✅ | ✅ | ✅ `growth_*` |
| Projects | ✅ | ✅ | ✅ | ✅ | ✅ `project_*` |
| Daily summary | ➖ | ✅ | ✅ | ✅ | ➖ (skill) |
| Reports | ➖ | ✅ | ✅ | ✅ | ➖ (skill) |
| Sanitize guardrail | ➖ | ✅ | ✅ | ✅ | ➖ (skill) |
| Config introspection | ✅ `doctor` | ✅ | ✅ | ✅ | ✅ `config_info` |

✅ supported · ➖ not exposed on that surface (use another surface for it)

Notes:
- **Skills** (milestones, daily-summary, reports, sanitize) are reasoning workflows
  that run inside Copilot chat surfaces (CLI plugin, VS Code, App). The MCP server
  exposes the deterministic data tools; the agent composes skills on top.
- The **standalone CLI** is best for fast, scriptable capture and automation.
- **MCP** is the portable core: any MCP-capable host gets the data tools.

## Which surface for what
- **Capture on the go / scripting:** standalone CLI (`cat-pilot task add ...`).
- **Conversational planning + summaries + reports:** Copilot CLI plugin or App.
- **Editor + Obsidian second brain:** Copilot in VS Code (MCP).
- **Embedding CatPilot elsewhere:** MCP from any host.

## The one rule that makes parity work
There is a single storage layer (`lib/cli-utils.js` + `lib/domains.js`) and a single
config, resolved globally (`~/.catpilot/config.json`) so it's the same from any
directory. Every surface calls into it — no duplicated logic, no divergent data. Point
the config root at your Obsidian vault and you have one brain with many doors.

See also: `INSTALL.md`, `USING_IN_VSCODE.md`, `OBSIDIAN_KNOWLEDGE_BASE.md`.
