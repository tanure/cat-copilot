# Changelog

All notable changes to this project are documented in this file.

## [0.1.7] - 2026-03-12

### Added
- Added `catpilot doctor` command for one-shot diagnostics when `CatPilot` does not appear in `/agents`.
- Added runtime diagnostics covering plugin root, `plugin.json`, agent file discovery, and `copilot --version` availability.
- Added README documentation for doctor workflow and `/agents` troubleshooting.

### Improved
- Added in-place upgrade path with `catpilot update` (no uninstall required).
- Added startup self-check warnings for missing plugin assets.

## [0.1.6] - 2026-03-12

### Added
- Added `catpilot update` command to update globally via npm.
- Added startup checks for `plugin.json`, `agents/`, and `agents/*.agent.md`.
- Added debug mode output via `CATPILOT_DEBUG=1`.
- Added README guidance for update and `/agents` troubleshooting.

[0.1.7]: https://github.com/tanure/cat-copilot/releases/tag/v0.1.7
[0.1.6]: https://github.com/tanure/cat-copilot/releases/tag/v0.1.6
