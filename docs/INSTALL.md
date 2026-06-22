# Installing CatPilot across the GitHub Copilot ecosystem

CatPilot ships **one npm package** that provides the CLI, the TUI, and the
`catpilot-mcp` server. The same engine then plugs into every Copilot surface.

## 0. Install the package (once)
```bash
npm install -g @alberttanure/catpilot-cli
cat-pilot setup        # creates the shared global config at ~/.catpilot/config.json
```

`cat-pilot setup` writes a **global** config (`~/.catpilot/config.json`) by default,
so CatPilot resolves to the **same storage from every directory** — whatever folder
you open Copilot in. Point it at your Obsidian vault:
```bash
cat-pilot setup --yes --root "/path/to/your/ObsidianVault" --partitioning month
```
Use `cat-pilot setup --local` only if you want a per-project config
(`<cwd>/data/config.json`) that overrides the global one inside that folder.

This installs four binaries: `catpilot`, `cat-pilot`, `cat-tui`, and `catpilot-mcp`.

## Surface → command matrix

| Surface | What you install | Command / config | What you get |
| --- | --- | --- | --- |
| **Copilot CLI** | Plugin **+** MCP | `copilot plugin marketplace add tanure/cat-copilot` then `copilot plugin install catpilot@catpilot-marketplace` and `copilot mcp add catpilot -- catpilot-mcp` | Agent + skills **and** MCP tools in chat |
| **Copilot in VS Code** | MCP | `.vscode/mcp.json` (or user `mcp.json`) → server `catpilot` = `catpilot-mcp` | CatPilot tools in Copilot Chat, next to Obsidian |
| **Copilot App** | Plugin **+** MCP | Install plugin, register `catpilot-mcp` as an MCP server | Agent + skills + MCP tools in App sessions |
| **Any MCP host** | MCP | `templates/mcp/generic-mcp.json` | CatPilot tools anywhere MCP is supported |

> Run `cat-pilot install` any time to auto-detect what's configured and print the
> exact next step for whatever is missing.

## 1. GitHub Copilot CLI

**Option A — via the CatPilot marketplace (recommended, also how it shows up in the Copilot App):**
```bash
# Register the marketplace once, then install by name
copilot plugin marketplace add tanure/cat-copilot
copilot plugin marketplace browse catpilot-marketplace   # see CatPilot listed
copilot plugin install catpilot@catpilot-marketplace
```

**Option B — install the repo directly:**
```bash
# Agent + skills (file-based assistant)
copilot plugin install tanure/cat-copilot
copilot agents            # verify "CatPilot" appears
```

**Add the MCP tools (either option):**
```bash
# MCP tools (programmatic task/journal/learning/growth/project tools)
copilot mcp add catpilot -- catpilot-mcp
```
With the global config in place (`cat-pilot setup`), the MCP server resolves the
**same storage from any directory** — no extra environment variable needed.
`CATPILOT_ROOT` is now an **optional override** to pin a specific project folder:
```bash
copilot mcp add catpilot --env CATPILOT_ROOT=/path/to/catpilot -- catpilot-mcp
```

## 2. Copilot in VS Code
1. Copy `templates/mcp/vscode-mcp.json` to `.vscode/mcp.json` in your workspace
   (this repo already includes one), **or** add the `catpilot` server to your
   user-level `mcp.json` so it's available in every workspace.
2. Reload VS Code; open **Copilot Chat** and confirm the `catpilot` tools are listed.
3. Optional: set `CATPILOT_ROOT` in the config `env` only if you want to pin a
   specific project folder instead of the shared global config.

Tip: keep your Obsidian vault open in the same window — capture with Copilot Chat,
review in Obsidian.

## 3. GitHub Copilot App
CatPilot is published as a **plugin marketplace**, so it's discoverable from the App.
1. Register and install the plugin (agent + skills):
   ```bash
   copilot plugin marketplace add tanure/cat-copilot
   copilot plugin install catpilot@catpilot-marketplace
   ```
   (Or install the repo directly: `copilot plugin install tanure/cat-copilot`.)
2. Register the MCP server so App sessions can call the tools:
   `copilot mcp add catpilot -- catpilot-mcp` (or add it via the App's MCP settings
   using `templates/mcp/generic-mcp.json`).
3. Start a session and verify CatPilot is available (the agent responds, and the
   `task_*` / `learning_*` / `growth_*` tools are callable).

## 4. Verify end to end
```bash
cat-pilot install        # surface detection + next steps
npm run test:mcp         # smoke-test the MCP server in an isolated workspace
```

## Notes
- `cat-pilot setup` writes a **global** config at `~/.catpilot/config.json`, so every
  surface resolves the **same storage from any directory**. Resolution order:
  `CATPILOT_CONFIG` → `CATPILOT_ROOT` → `<cwd>/data/config.json` (project-local) →
  `~/.catpilot/config.json` (global).
- Point `storage.root` at your Obsidian vault so all surfaces read/write the **same**
  files — including the vault.
- Keep personal content in the private vault (Layer 2). See
  `PRIVACY_AND_BOUNDARIES.md`.
