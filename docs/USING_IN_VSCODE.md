# Using CatPilot in VS Code (with Copilot + Obsidian)

CatPilot in VS Code is powered by the **MCP server** — the same engine as the CLI
and the Copilot App. This is the most "second-brain native" setup because your
Obsidian vault and your Copilot chat live side by side.

## Setup
1. Install the package and create a config:
   ```bash
   npm install -g @alberttanure/catpilot-cli
   cat-pilot setup     # point storage.root at your Obsidian vault
   ```
2. Add the MCP server to VS Code:
   - This repo already ships `.vscode/mcp.json`. For another workspace, copy
     `templates/mcp/vscode-mcp.json` to `.vscode/mcp.json`.
   - Or add the `catpilot` server to your **user-level** `mcp.json` so it's available
     everywhere.
3. Set `CATPILOT_ROOT` (in the config `env`) to the folder containing `data/config.json`.
4. Reload VS Code and open **Copilot Chat**. The `catpilot` tools appear in the tools list.

## Recommended layout
- Open your **Obsidian vault folder** as the VS Code workspace (or a multi-root
  workspace that includes it).
- Keep Obsidian open on the same vault for rich graph/Dataview views.
- Capture and query from Copilot Chat; review and link in Obsidian.

## Example prompts (Copilot Chat in VS Code)
```text
Add a task to finish the AZ-104 practice exam, priority high, due Friday.
Log a growth note: shipped the MCP server; impact: unified capture across surfaces.
What learning topics are due for review?
Give me a portfolio overview of my active projects.
Summarize what I did this week and save it as a memo.
```

## How it stays in sync
Every tool call resolves storage from `data/config.json`. Tasks/journal/milestones
are monthly markdown files; memos/learning/growth/projects are per-file notes with
frontmatter (Dataview-ready). Because the root is your vault, everything shows up in
Obsidian immediately.

## Privacy
Run the `sanitize` skill (or ask Copilot to "sanitize this") before exporting any
growth/review content. Keep employer-internal specifics in the private vault only.
See `PRIVACY_AND_BOUNDARIES.md`.
