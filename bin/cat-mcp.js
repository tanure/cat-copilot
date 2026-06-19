#!/usr/bin/env node

/**
 * CatPilot MCP server launcher.
 * Thin entry point so `catpilot-mcp` works as an installed bin and as a stdio
 * command in any MCP host (Copilot CLI, VS Code, Copilot App, etc.).
 */

import('../mcp/server.js').catch((err) => {
  process.stderr.write(`Failed to start CatPilot MCP server: ${err.stack || err.message}\n`);
  process.exit(1);
});
