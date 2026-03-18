# Changelog

All notable changes to this project are documented in this file.

## [0.1.9] - 2026-03-18

### Added
- Prepared for phase 3 development

## [0.1.8] - 2026-03-18

### Added
- **Full Gemini AI Adapter** - Complete implementation of 7 tools for Gemini CLI integration with response format normalization
- **Multi-Client Compatibility** - Comprehensive compatibility matrix showing feature parity across Copilot Plugin, CLI, and TUI
- **Phase 2 Documentation** - 5 new guides covering adapter specs, integration examples, release checklist, compatibility matrix, and project status
- **Adapter Integration Tests** - Test framework for validating Claude and Gemini adapters with standardized response formats

### Changed
- **ESM Migration** - Converted all 14 modules from CommonJS to ES6 modules for better tree-shaking and modern JavaScript support
- **README Restructure** - Completely redesigned README to clearly distinguish three separate entry points (Copilot Plugin, CLI, TUI) with capabilities matrix and realistic day-to-day examples
- **Doctor Command Enhanced** - Now runs as both Copilot plugin diagnostic (`catpilot doctor`) and standalone workspace diagnostic (`cat-pilot doctor`)

### Improved
- Clearer separation of concerns: Copilot agent features vs. standalone CLI vs. experimental TUI
- Better user guidance for choosing the right install path and entry point
- More accurate capability documentation with tested examples for each client type
- Reduced promise-making—TUI now explicitly marked as experimental dashboard

### Docs
- Added `docs/PHASE2-COMPATIBILITY.md` - 750+ lines on adapter response formats, capability matrix, verified APIs
- Added `docs/MULTI_CLIENT_EXAMPLES.md` - 600+ lines of practical code examples for each client
- Added `docs/RELEASE-v0.1.8.md` - Release checklist and quality metrics
- Added `docs/PHASE2-SUMMARY.md` - Phase 2 completion summary
- Added `PROJECT-STATUS.md` - Development status, architecture overview, entry points

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

[0.1.9]: https://github.com/tanure/cat-copilot/releases/tag/v0.1.9
[0.1.8]: https://github.com/tanure/cat-copilot/releases/tag/v0.1.8
[0.1.7]: https://github.com/tanure/cat-copilot/releases/tag/v0.1.7
[0.1.6]: https://github.com/tanure/cat-copilot/releases/tag/v0.1.6
