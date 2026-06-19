# Installing CatPilot across the GitHub Copilot ecosystem

CatPilot ships **one npm package** that provides the CLI, the TUI, and the
`catpilot-mcp` server. The same engine then plugs into every Copilot surface.

## 0. Install the package (once)
```bash
npm install -g @alberttanure/catpilot-cli
cat-pilot setup        # creates data/config.json (point storage.root at your vault)
```

This installs four binaries: `catpilot`, `cat-pilot`, `cat-tui`, and `catpilot-mcp`.

## Surface → command matrix

| Surface | What you install | Command / config | What you get |
| --- | --- | --- | --- |
| **Copilot CLI** | Plugin **+** MCP | `copilot plugin install tanure/cat-copilot` then `copilot mcp add catpilot -- catpilot-mcp` | Agent + skills **and** MCP tools in chat |
| **Copilot in VS Code** | MCP | `.vscode/mcp.json` (or user `mcp.json`) → server `catpilot` = `catpilot-mcp` | CatPilot tools in Copilot Chat, next to Obsidian |
| **Copilot App** | Plugin **+** MCP | Install plugin, register `catpilot-mcp` as an MCP server | Agent + skills + MCP tools in App sessions |
| **Any MCP host** | MCP | `templates/mcp/generic-mcp.json` | CatPilot tools anywhere MCP is supported |

> Run `cat-pilot install` any time to auto-detect what's configured and print the
> exact next step for whatever is missing.

## 1. GitHub Copilot CLI
```bash
# Agent + skills (file-based assistant)
copilot plugin install tanure/cat-copilot
copilot agents            # verify "CatPilot" appears

# MCP tools (programmatic task/journal/learning/growth/project tools)
copilot mcp add catpilot -- catpilot-mcp
```
Set `CATPILOT_ROOT` if you launch Copilot from outside your CatPilot project:
```bash
copilot mcp add catpilot --env CATPILOT_ROOT=/path/to/catpilot -- catpilot-mcp
```

## 2. Copilot in VS Code
1. Copy `templates/mcp/vscode-mcp.json` to `.vscode/mcp.json` in your workspace
   (this repo already includes one), **or** add the `catpilot` server to your
   user-level `mcp.json` so it's available in every workspace.
2. Reload VS Code; open **Copilot Chat** and confirm the `catpilot` tools are listed.
3. Set `CATPILOT_ROOT` in the config `env` to the folder containing `data/config.json`.

Tip: keep your Obsidian vault open in the same window — capture with Copilot Chat,
review in Obsidian.

## 3. GitHub Copilot App
1. Install the plugin (agent + skills): `copilot plugin install tanure/cat-copilot`.
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
- The MCP server resolves storage from `data/config.json` (or `CATPILOT_ROOT`),
  so all surfaces read/write the **same** files — including your Obsidian vault.
- Keep personal content in the private vault (Layer 2). See
  `PRIVACY_AND_BOUNDARIES.md`.
