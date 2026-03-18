# CatPilot Compatibility Guarantees

This document outlines backward compatibility commitments for CatPilot across all interfaces and client implementations.

## Data Format Stability

### 1. Configuration Schema (`data/config.json`)

**Guaranteed stable**:
- Will never change required keys: `version`, `storage.root`, `storage.partitioning`, `storage.files`
- New optional keys may be added but will have safe defaults
- Existing user configs will continue to work with zero migration

Example:
```json
{
  "version": 1,
  "storage": {
    "root": "data",
    "partitioning": "month",
    "files": {
      "tasks": "tasks.md",
      "journal": "journal.md",
      "milestones": "milestones.md",
      "memos": "memos"
    }
  }
}
```

### 2. Tasks Table Format

**Exact structure guaranteed**:
```markdown
| ID | Status | Title | Due Date | Priority | Tags | Context |
```

Seven-column format:
- Column 1: `ID` (numeric, unique per file)
- Column 2: `Status` (Open or Done)
- Column 3: `Title` (task title)
- Column 4: `Due Date` (empty or YYYY-MM-DD)
- Column 5: `Priority` (empty or P0|P1|P2|P3)
- Column 6: `Tags` (empty or comma-separated)
- Column 7: `Context` (empty or single-line notes)

**Guarantees**:
- Column order will never change
- Column count will never decrease
- New columns will only be added at the end
- Existing data will parse identically in all clients
- Empty cells remain empty (no migration of old data)

### 3. Journal Entry Format

**Exact format guaranteed**:
```markdown
### YYYY-MM-DD

Entry text here. Can be multi-line.
```

**Guarantees**:
- Date heading format: `### YYYY-MM-DD`
- Entries are separated by blank lines
- Text can contain any markdown
- Date order may vary (not enforced)
- Entries are append-only (never deleted by append operations)

### 4. Memo File Naming

**Exact format guaranteed**:
```
data/YYYY/YYYY-MM/memos/YYYY-MM-DD_<slug>.md
```

- Filename: `{date}_{slug}.md`
- Date format: ISO 8601 (YYYY-MM-DD)
- Slug: lowercase, hyphens, no special chars, max 50 chars after date
- Path structure: Config-driven partitioning (day/week/month)

**Guarantees**:
- Naming scheme will not change
- Slug generation algorithm stable
- Existing memo files readable by all clients
- No renaming or migration of memo files

### 5. Milestone Format

**Same structure as tasks**:
```markdown
## Planned Milestones
## In Progress
## Done
```

Same seven-column table format as tasks.

**Guarantees**:
- Section headings immutable
- Table structure identical to tasks
- All clients write identical format

## File Location Stability

### Partitioning Modes

Three partitioning modes supported forever:

| Mode | Folder Structure | Example |
| --- | --- | --- |
| `day` | `YYYY/YYYY-MM/YYYY-MM-DD` | `2026/2026-03/2026-03-18` |
| `week` | `YYYY/Www` | `2026/W12` (ISO week) |
| `month` | `YYYY/YYYY-MM` | `2026/2026-03` |

**Guarantees**:
- Partition algorithms never change
- Existing data continues to resolve to same paths
- New files follow same partitioning rules
- ISO week calculation is deterministic (RFC 3339)

## Breaking Changes: None Expected

We commit to **zero breaking changes** to:
- Config schema (new keys only, never remove/rename)
- Markdown table structure (columns only grow, never shrink)
- File formats (data layout immutable)
- File paths (partitioning algorithm stable)
- Naming conventions (memo slugs predictable)

## Client Compatibility

### Copilot CLI Agent

**Guaranteed**:
- Agent reads/writes files in original format
- Agent continues to delegate to skills
- Skill routing unchanged
- Config contract (load from `data/config.json`) enforced

### Standalone CLI (`cat-pilot`)

**Guaranteed**:
- CLI reads/writes to exact same files as agent
- CLI uses identical parsing/formatting as skills
- CLI respects same config structure
- Existing user data works without conversion

### Terminal UI (`cat-tui`)

**Guaranteed**:
- TUI reads/writes to same files as CLI and agent
- TUI parses markdown identically
- TUI respects partitioning and config settings
- No data migration or transformation

### Multi-Client Adapters (Claude, Gemini, future)

**Guaranteed**:
- Each adapter implements same data model
- Adapters read/write to identical file paths
- Adapters parse markdown tables identically
- Cross-client consistency tests pass

## Migration Policy

### When Config is Updated

Example: User upgrades CatPilot and config.json changes format.

**Policy**:
- New optional fields initialize with defaults (no user action needed)
- Old configs continue to work in all clients
- No automatic migration script required
- Users can manually update config if using new features

### When File Structure Changes

Example: User's `tasks.md` grows from 7 columns to 8.

**Policy**:
- New files follow new structure from day one
- Existing files parsed as-before (7 columns recognized)
- Reading old + new files mixed works correctly
- No file modification unless user requests

### When Partitioning Mode Changes

Example: User switches from `month` to `week` partitioning.

**Policy**:
- Old files remain in old partition folders
- New files written to new partition folders
- All files remain readable by all clients
- Migration is optional (old partitions work forever)

## Deprecation Policy

If a feature must be deprecated:

1. **Notice**: Announce 2+ versions in advance
2. **Support**: Keep legacy behavior working 3+ versions
3. **Migration**: Provide optional migration tool
4. **Fallback**: Never break reading old data

Example: If we deprecate the `dueDate` column in tasks:
- Version N+1: Support both with/without `dueDate`
- Version N+2: Same (support both)
- Version N+3: Same (support both)
- Version N+4+: Can drop support, but files still parse

## Testing for Compatibility

Every new CatPilot release tests:

1. **Backward test**: Load config from 3+ versions back ✅
2. **Read test**: Parse tasks, journal, memos from old files ✅
3. **Write test**: Write new data, verify old clients read it ✅
4. **Roundtrip test**: CLI writes → agent reads → TUI edits → CLI reads ✅
5. **Cross-client test**: CLI adds → Claude reads → Gemini edits → CLI verifies ✅

## Support Scope

We support migration/compatibility for:

✅ Config schema evolution  
✅ File format changes (columns added, never removed)  
✅ Path structure changes (with migration guide)  
✅ Client interoperability (agent + CLI + TUI + adapters)  

We do NOT support:

❌ User-modified configs (hand-edits without schema)  
❌ Corrupted files (malformed markdown)  
❌ Unsupported partitioning modes  
❌ Files outside storage root  

## Contact & Issues

For compatibility questions or breaking change reports:  
- GitHub Issues: [tanure/cat-copilot](https://github.com/tanure/cat-copilot/issues)
- Compatibility label: `[compat]`

---

**Last updated**: March 2026  
**Applies to**: v0.2.0 and all future versions (v0.1.x is pre-release)
