# CatPilot desktop

The desktop application uses Electron, TypeScript, and Svelte. It runs locally
without an AI account. The Windows application and unsigned installer have been
exercised locally. macOS arm64/x64 build targets and native CI are configured;
their results have not yet been observed. Production distribution still requires
native acceptance, code signing and macOS notarization.

## Run from source

Use Node 24 LTS (Node 22.13 or newer is required for SQLite workspace commands).
The older Markdown CLI continues to use its existing configuration.

```sh
npm ci
npm run desktop:dev
```

In environments where a fresh install rejects a package feed's tarball URL,
resolve the registry-neutral lockfile before installing:

```sh
npm install --package-lock-only --ignore-scripts --no-audit --no-fund
npm ci
```

This does not change the configured registry or remote-fetch permissions.
If npm reports blocked lifecycle scripts, review them through your environment's
normal approval process; do not disable its script policy.

Build and check:

```sh
npm run desktop:check
npm run test:desktop
npm run test:provider
npm run test:electron
npm run test:proposal-ui
npm run test:workflows-ui
npm run test:package
npm run desktop:pack
```

`test:electron` builds the Electron app. The proposal and workflow UI checks
launch that build, then load the current renderer source in a separate window.

`desktop:pack` produces an unpacked application under `apps/desktop/release`.
To produce an installer on its target platform:

```sh
npm run desktop:build
npm run dist --workspace @catpilot/desktop -- --win --x64
npm run dist --workspace @catpilot/desktop -- --mac --arm64
```

Unsigned builds are developer artifacts, not signed production releases. Configure
electron-builder signing credentials through the release environment, never in the
repository. macOS builds must be exercised on both supported architectures. The
Desktop workflow builds and smoke-tests each architecture on its native runner.
Automatic updates are not implemented.

### Signed Windows releases

The separate **Windows signed release** workflow
(`.github/workflows/desktop-windows-signed.yml`) runs manually on the default
branch only. It uses Azure Artifact Signing (formerly Trusted Signing), requires
signing, and verifies trusted Authenticode signatures, publisher names and
timestamps on both `CatPilot.exe` and the NSIS installer before uploading them.
It does not publish a GitHub Release. Normal Desktop CI stays unsigned.

Before the first signed release:

1. Select the Azure subscription and verified publisher explicitly. Create an
   Artifact Signing account, complete identity validation, and create a
   **Public Trust** certificate profile. This is a billable external service;
   eligibility and identity approval must be completed with Microsoft.
2. Create an Entra application/service principal with GitHub OIDC federation:
   issuer `https://token.actions.githubusercontent.com`, audience
   `api://AzureADTokenExchange`, and subject
   `repo:tanure/cat-copilot:environment:windows-signing`. Assign only the
   Certificate Profile Signer role for the intended signing profile.
3. Create the GitHub environment **windows-signing** with required reviewers
   where available and a deployment restriction to the default branch. Add
   environment variables `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`,
   `AZURE_SUBSCRIPTION_ID`, `CATPILOT_SIGNING_ENDPOINT`,
   `CATPILOT_SIGNING_ACCOUNT`, `CATPILOT_SIGNING_PROFILE`, and
   `CATPILOT_SIGNING_PUBLISHER`. The last value must exactly match the
   certificate's publisher common name; the endpoint must be the account's
   regional HTTPS `*.codesigning.azure.net` endpoint. Do not invent these values.
4. Merge the reviewed workflow/configuration to the default branch, then run
   **Windows signed release** in Actions. Download its `catpilot-win-x64-signed`
   artifact only after the workflow succeeds.

OIDC authenticates Azure CLI without a stored client secret; electron-builder's
TrustedSigning integration uses the Azure credential chain. No certificates,
private keys or client secrets belong in Git. Local Windows signing requires
PowerShell 7 (`pwsh`) and Azure CLI. Set the four `CATPILOT_SIGNING_*` variables,
sign in with `az login` to the explicitly
selected subscription using an identity authorized for that profile, then run:

```powershell
npm run desktop:build
npm run dist:win:signed --workspace @catpilot/desktop
```

Missing metadata, unavailable signing access, an invalid signature, missing
timestamp or unexpected publisher fails the signed release. The separate config
does not enable signing for macOS or modify unsigned developer builds. Public
signing cannot be completed until a verified publisher profile is available;
adding this workflow alone does not sign existing installers.

See [Artifact Signing setup](https://learn.microsoft.com/azure/artifact-signing/quickstart)
and [electron-builder Windows signing](https://www.electron.build/v26/docs/features/code-signing/code-signing-win/).

The Windows x64 NSIS installer is
`apps/desktop/release/CatPilot Setup 0.9.0.exe`; the unpacked executable is
`apps/desktop/release/win-unpacked/CatPilot.exe`.
The packaged smoke test also supports `CATPILOT_TEST_LARGE=1`: it creates a
synthetic SQLite workspace with 10,000 tasks and 1,000 notes. A packaged Windows
run measured 2.27s for the IPC snapshot, 0.32s for navigation, 719 MiB combined
process working sets, and 0.90s for a second process launch with the large
workspace selected. Lists mount bounded pages rather than all records at once.
Regression budgets are 5s for the snapshot, 10s for navigation/second-process
startup, and 1 GiB combined working sets. These are engineering gates, not
guarantees for arbitrary hardware.
The native CI matrix runs the fixture; its macOS results have not yet been observed.

## Workspaces and storage

Create a workspace using the top-left switcher. SQLite is the default; Markdown
allows selection of a directory. Workspaces have separate records and can be
renamed or unregistered in Settings. Unregistering never deletes their data.
Switching a desktop workspace does not retarget an external CLI or MCP process.
The last successfully opened workspace is remembered in the desktop profile and
validated against the registry on startup; removed IDs fall back safely.

The registry is `~/.catpilot/workspaces.json`; `CATPILOT_HOME` can select an
alternative registry directory. This is separate from the legacy config resolver.
The desktop stores window/browser state in Electron's normal user-data directory.

Navigation and editing controls use local Lucide SVG icons; the original
1024-pixel CatPilot artwork is smoothly downsampled rather than pixelated.
Status colors consistently distinguish open, active, blocked and completed work.
Priority badges include both P0-P3 codes and plain-language labels. Tags receive
stable, name-based colors across views and themes without changing saved metadata.
Color always accompanies a readable label, not a color-only state.
After `desktop:build`, `npm run test:design-ui` exercises these controls, light/dark
contrast, compact layout and status-write failure recovery.

SQLite stores records in `<directory>/catpilot.sqlite` with WAL, transactions,
and revision checks. It uses Node's built-in SQLite rather than an independently
rebuilt native addon, so Electron and CLI can open the same database without a
third-party addon ABI mismatch. Keep databases on local disks, not shared drives
or cloud-synced folders. The database is **not encrypted**.

Markdown stores one note per UUID in `<directory>/CatPilot`. Its YAML frontmatter
contains a `catpilot` object with the record metadata; the remaining text is the
Markdown body. Folder/tag organization is metadata rather than physical folders.
Do not rename the UUID files or remove their metadata. External edits to note
bodies are detected using content hashes. Unsupported/malformed records produce
an error rather than being silently dropped.

Writes use same-directory temporary files and a cross-process lock. After a
crash, a leftover `.lock` produces an actionable error. Close all CatPilot
processes before removing a stale lock; do not remove a lock held by another
running process.

Existing legacy Markdown tables, Obsidian layouts, and configuration are **not
automatically converted** to this record format. The existing CLI, Canvas, and
legacy MCP tools continue to operate on those unchanged files unless an explicit
record workspace is selected. Use the previewed legacy-directory importer to
create a separate managed copy; do not
point an agent at the new workspace directory with instructions to edit legacy
task tables.

## Shared CLI, TUI, MCP and Canvas access

The CLI adds explicit workspace commands:

```sh
cat-pilot workspace list
cat-pilot workspace create Work --backend sqlite
cat-pilot workspace create Personal --backend markdown --directory "C:\CatPilot\Personal"
cat-pilot workspace add tasks "Ship the desktop" --workspace Work
cat-pilot workspace records --workspace Work --domain tasks
cat-pilot workspace update RECORD_ID --workspace Work --revision REVISION --title "Updated"
cat-pilot workspace export --workspace Work
cat-pilot workspace import backup.json --workspace Personal
cat-pilot workspace import backup.json --workspace Personal --apply
cat-pilot workspace legacy-import "C:\OldCatPilot" --workspace Personal
cat-pilot workspace legacy-import "C:\OldCatPilot" --workspace Personal --apply
```

Use a native directory path on your platform. Legacy import and backup import
require an empty destination; the first command previews and `--apply` approves.
Updates and removals require the last observed revision to prevent lost writes.
Names and IDs can select workspaces. `workspace export` emits JSON to stdout.
For a source checkout, run `npm run build:core` before using workspace commands;
the published npm package includes the compiled services.

MCP adds `workspace_list`, `workspace_records`, `workspace_record_save`,
`workspace_record_remove` and `workspace_manage`. Pass an explicit workspace to
each operation. CLI `workspace manage` and MCP `workspace_manage` expose the
shared management requests for comments/logs, completion, carry-forward,
prioritization, rollups, reports and persisted timers.

Set `CATPILOT_WORKSPACE` when launching MCP or the Claude/Gemini tool adapters to
pin their supported tools to a registered record workspace. They share the same
UUID records and management services as the desktop. Unsupported legacy-only
operations and conflicting selectors fail explicitly rather than falling back to
unrelated files. Without a selector, legacy commands/tools retain their existing
Markdown configuration and behavior.

The terminal UI also opens an explicit record workspace:

```sh
cat-tui --workspace Work
cat-tui --workspace Work --snapshot
```

Its terminal commands include `list [domain]`, `read UUID`, `add DOMAIN TITLE`,
`update UUID JSON_PATCH`, `complete UUID`, `comment UUID TEXT`,
`carry UUID PERIOD`, `remove UUID`, `report FROM TO`, `help` and `quit`.
Unselected `cat-tui` retains the legacy interface.

For the Copilot CatPilot Canvas, open with input `{ "workspace": "Work" }`
(name or UUID), or launch its host with `CATPILOT_WORKSPACE`. Each selected panel
uses an immutable workspace context and an authenticated loopback bridge; focus
preserves that context and unsaved browser drafts. Explicit switching or closing
releases the displaced bridge. The `workspace_request` action accepts
`{ "request": { "action": "snapshot" } }` and shared `put`, `remove` or
`management` requests; do not include another workspace selector inside them.
Legacy Canvas actions do not acquire a different workspace through desktop
navigation.

The selected Canvas bridge needs an installed CatPilot CLI package and Node
22.13+ (24 LTS recommended) on `PATH`. `CATPILOT_PACKAGE_ROOT` can identify the
package directory, and `CATPILOT_NODE` can specify an absolute Node executable.
The extension discovers installed packages rather than bundling a second
SQLite implementation. Missing runtime/package support produces an explicit
error, not an empty success or a legacy-storage fallback.

Workspace records use UUIDs, a domain, a title, a Markdown `body`, and a `fields`
object. Use `fields.due` (not legacy `dueDate`), `status` (`Open`, `In Progress`,
`Blocked`, `Done`), `priority` (`P0`-`P3`), `folder`, `tags`, `project`, and optional
SMART fields (`goal`, `measure`, `steps`, `why`, `importance`, `urgency`).
Project/learning children can use `parent`; progress is an integer from 0 to 100.
Unknown field keys are preserved. Read before updating and merge only intended
changes; never substitute legacy numeric IDs or a fictitious Markdown filename.

## Editing and backup

Tasks has List, Board, Matrix and Calendar views. Drag a card between Board
columns or use its status menu. The month calendar groups tasks by due date and
keeps undated work separate; create a task from a day to prefill the due date.
The Matrix explains its automatic placement. Optional SMART guidance in task
properties checks clarity, without setting priority or urgency. Planning-view
details open in a panel without resetting the view underneath.

Projects opens a portfolio of goals, linked progress, blockers and next
milestones, with status groups in the sidebar. In Concepts, use **+** beside
**Folders** to create a folder, then choose it from the **Folder** dropdown
when editing a concept. Folders sort alphabetically and persist when empty.
Drag a folder onto another folder to nest it, or onto **All folders** to move
it to the top level. Right-click a folder or open its **…** actions to create a
subfolder, move it without dragging, or delete it. Deletion keeps the contents
by default: subfolders move up a level and concepts directly in the deleted
folder move to its parent or **Unfiled**. Choose **Delete everything inside**
to remove the entire branch. Folder edits organize CatPilot records; moving a
folder updates its concepts without moving their Markdown files. Full backups
include empty folders.
Kind colors are stored on this device per workspace. Journal offers month
navigation and Achievements groups records by completion year (or creation year
when no completion date is recorded). Projects and Achievements do not show a
Folder field; any older folder metadata stays in storage. Sections without contextual navigation
use the full content pane.

Start a Pomodoro from **Focus** or choose **Focus on this task** on a saved task
to preselect it. You can start with one, several, or no tasks and add an optional
purpose. Linked tasks and purpose are saved with the session; completing a
session does not complete the tasks. Short and long breaks have their own presets.

Journal groups entries by the day they describe (or their creation
day for entries without an explicit date). Timeline shows recorded creation,
latest update and completion or cancellation timestamps; it is not an edit or
deletion audit log.

Items use Content, Properties, Activity and AI assistant tabs. Most items need
only a title; new Journal entries also need a date and reflection. New drafts
require an explicit **Create** action and never silently create records. Validation
identifies missing or invalid fields. After creation, valid edits save after a
one-second pause, with visible saving/error state and explicit retry; manual save
and Ctrl/Cmd+S remain available.

Document bodies, comments/activity logs, Focus notes, and Steps/Why fields share
the rich editor. AI instructions use the same compact editor; generated AI drafts
and reports use its read-only view. Short titles, dates, tags and other structured
properties stay ordinary form controls. Exact before/after AI source diffs stay
source views rather than editable rich text.

Supported documents open directly in **Write**, with **Markdown** as the other
primary mode. Rich text already shows formatting; it does not need a separate
preview. **Preview Markdown** is an optional toggle inside Markdown mode for
advanced or unsupported syntax. Type `/` in an empty paragraph or use the inline
plus button for a keyboard-accessible block menu. Headings, lists, checklists,
quotes, code and tables are available without an Insert block dropdown.
A formatting toolbar and keyboard-accessible block movement remain available.
Edits made while a save is in flight remain a newer draft, not overwritten by
its response. A changed workspace revision does not falsely conflict an
unchanged selected record.
Unsupported HTML/comments/wiki links are kept in source mode rather than silently
discarded by rich-text conversion. Source frontmatter is preserved separately.
Saved, unsaved, recovered, and conflicting edits are distinguished in the UI.
Recovery drafts live in local browser storage scoped to workspace and record.

The same editor and management UI are available in the installable
[Chromebook PWA](PWA.md). Browser storage, folder permissions and AI availability
differ from Electron; installing the PWA does not synchronize desktop workspaces.

Settings offers full-fidelity JSON backup export and previewed import. To transfer
between backends, export the source, create an empty destination with the desired
backend, preview the import, and approve it. IDs, dates, nested metadata, and
Markdown bodies are verified after import. A nonempty destination is rejected.
The source remains unchanged; selecting the new workspace is explicit.

Backups include managed attachments, checksums, and original legacy source files.
Files are limited to 20 MB each, 50 MB total and 20,000 files per transfer;
the desktop accepts JSON backup files up to 250 MB (base64 increases their size).
An interrupted import keeps a recovery journal and blocks ordinary writes until
the same backup is retried. Records and assets are verified before the journal
is removed. Do not delete the journal or staging directories while an import
needs recovery. A changed destination is not silently overwritten. If destination
records or staged files were changed externally, preserve that incomplete copy
and import the original backup into a new empty workspace.

Settings can preview an existing legacy Markdown directory and import it into
a separate empty workspace. Period-local task IDs become stable UUIDs; task
details/logs, dated journals, Pomodoro sessions and tagged domain notes are mapped.
Unambiguous project/learning parents and project references become UUID links;
ambiguous references stop the import. Relative document/image links become
portable managed-asset references. Every source file, including unknown content,
is archived byte-for-byte; source-archive notes expose those originals.
Template/plugin documents are archived without creating fake management items.
Git metadata and dependency directories are explicitly excluded in the preview.
Unsupported metadata and unmatched links produce warnings, not silent deletion.
The source directory is never modified. Symbolic links, case collisions,
nonportable paths and oversized sources require correction before import.

Attachments are imported through a native file picker into `CatPilotAssets`.
References use `catpilot-asset:<relative path>`, without machine paths or workspace
IDs. Supported image formats render through temporary workspace-scoped Blob URLs;
other files can be saved through a native dialog. Remote images are not fetched.
JSON exports take a consistent record snapshot under the same cross-process lock
used by service writes and managed assets, rather than copying a live WAL database.
Merge-into-nonempty imports remain intentionally unsupported.

## AI

Copilot is accessed through the published `@github/copilot-sdk`; runtime artifacts
are optional platform packages included during packaging. The app does not fetch
runtime executables on startup. Claude and Gemini are clearly marked as planned,
not working providers.

The first integration supports GitHub.com device-code sign-in, connection
diagnostics, model discovery/selection, and streamed Markdown drafting from
user-selected context. Credentials remain with the SDK's secure storage;
plaintext credential persistence is refused. It has no shell, filesystem, or MCP tools.
Opening Settings > Agents explicitly checks the existing connection and refreshes
the model catalog when authenticated. Sign-in displays a selectable code label,
automatically copies it to the clipboard (with manual copy/fallback feedback),
and waits for browser authorization. Completion updates the connected state,
removes the sign-in/code controls, and refreshes selectable models automatically.
Refresh connection and Refresh models remain available. Model catalog failures
do not falsely disconnect an authenticated account. Model selections are saved
per workspace; discovery bypasses the SDK convenience method's session-long cache.
The streamed draft must be applied and saved by the user. Cancelling discards the
operation and removes its event subscriptions. Document content is not sent to
Copilot until a draft or structured edit is explicitly requested. Authentication, entitlement, and runtime
failures are shown rather than simulated.

For a saved selected item, structured editing exposes only
`catpilot_propose_record_change`. This SDK tool creates an in-memory proposal;
it cannot choose another workspace/record or write data. CatPilot shows the full
before/after title, Markdown and changed task/SMART metadata for explicit approval.
A main-process token binds that approval to the original workspace, record and
revision. Saving preserves unknown metadata, rejects concurrent changes and
consumes the token. Ordinary Markdown drafting remains tool-free.

The packaged Windows runtime, streamed drafts and actual structured-edit review
and approval UI have been exercised with synthetic context; its native runtime
bundle is explicitly unpacked from ASAR for spawning.
Interactive device-code sign-in, model catalog selection, and provider requests
on macOS still require release-account verification.
Legacy skill-driven workflows are not automatically equivalent to the desktop's
scoped selected-record assistant.

## Shared management and release acceptance

Shared management services now provide revision-safe comments, explicit
carry-forward, SMART/Eisenhower prioritization, project/learning rollups and
deterministic reports. Parent completion and completion achievements are derived
from current records rather than unsafe multi-record side effects.
History supports editing and confirmed deletion through the same revision checks.
Focus uses persisted timer start/status/complete/cancel operations and hydrates
active sessions after restart; historical timer records are not silently rewritten.
Selected-workspace CLI, TUI, MCP, provider adapters and Canvas use those services.
An installed npm tarball has been exercised outside the checkout with SQLite,
Markdown, binary transfers and approved source-preserving legacy import.
Legacy source archives preserve nonstandard material; this is not a claim that
every third-party vault plugin or custom table becomes a native CatPilot item.

The native workflow builds Windows NSIS and macOS DMG/ZIP artifacts and exercises
source and unpacked applications on Windows x64, macOS arm64 and macOS x64.
Those configured jobs are not evidence of a successful remote run. Fresh-account
device login, clean-machine installer/upgrade/uninstall behavior, exact minimum
OS versions, signing/notarization and native macOS execution remain release
acceptance requirements. No signed production release or automatic updater is
claimed.
