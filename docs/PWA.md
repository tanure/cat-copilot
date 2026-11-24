# CatPilot for Chromebooks

The PWA shares the desktop application's Svelte interface, rich editor and
management workflows. It runs in an up-to-date Chrome browser without Electron,
Linux mode or a native installation. The production build includes its application
assets and SQLite WebAssembly engine in an offline service-worker cache.

## Run and build

Use Node 24 LTS and install the repository's dependencies:

```sh
npm ci
npm run pwa:dev
npm run pwa:check
npm run test:pwa
npm run pwa:build
npm run pwa:preview
```

`pwa:dev` is development-only; installation and offline caching require the
production build. `pwa:preview` prints its local URL. Do not open `index.html`
directly from disk. Browser acceptance uses Playwright Chromium; install that
test browser with `npx playwright install chromium` if missing. An existing
Chromium executable can be selected with `CATPILOT_BROWSER_EXE`; the acceptance
test also accepts `CATPILOT_BROWSER_CHANNEL=msedge`.

The deployable output is **`apps/pwa/dist`**. Publish the entire directory,
including `sw.js`, manifest, icons, JavaScript, CSS and WASM, to a trusted HTTPS
static host. Root and directory-subpath hosting are supported. Serve `.js` as
JavaScript and `.wasm` as `application/wasm`; use revalidation/no-cache for
`index.html` and `sw.js` so browsers can discover updates. Keep the same origin
and path for existing users: browser data belongs to that origin/profile.
No hosting account, public deployment or synchronization service is configured
by this change.

## Install on a Chromebook

1. Open the hosted HTTPS URL in Chrome while online. Wait for **Offline ready**.
2. Choose **Install CatPilot** when Chrome offers it, or use Chrome's app-install
   option in its menu/address bar. Installation remains optional.
3. Create a workspace and keep a full backup outside the app.

ChromeOS administrators can restrict PWA installation or folder access. Secure
context, IndexedDB and Web Locks support are required; localhost is accepted for
development. A Chromebook cannot reach another computer's `localhost` address:
use the hosted HTTPS URL on the Chromebook.

After the first successful load, the app can cold-start and save local changes
offline. Initial installation, uncached application updates and external links
need connectivity. **Update available** activates a downloaded update only when
you click it; pending document drafts must be saved or discarded first.

## Choose your storage

| Backend | Location and persistence |
| --- | --- |
| SQLite | A real SQL.js SQLite database, with its exported bytes and assets committed to IndexedDB. Private to this site's browser profile on this device. |
| Markdown | Actual files in a folder selected through Chrome's File System Access picker. Documents use the same `CatPilot/<UUID>.md` envelope and body format as desktop. |

SQLite is the default and needs no directory permission. It is not a JSON store
disguised as SQLite. Web Locks serialize app operations across same-origin tabs,
and revision checks reject stale saves. This is not a multi-device database.

Browser storage has quotas and can be removed by clearing site data, deleting a
profile or browser eviction. Persistent-storage permission is best-effort, not a
backup guarantee. Installing the PWA does not add synchronization or make browser
data permanent. Export regular backups to Files, Drive or another location you
manage, especially before changing browser profiles, origins or devices.

Markdown access requires an explicit user gesture and read/write permission.
Chrome may ask again after a restart. If access is lost, select the workspace,
then use **Settings > Workspaces > Reconnect Markdown folder**. Permission errors
are shown rather than treating an inaccessible folder as an empty workspace.
Unregistering removes the registration, not the Markdown files.

Do not edit the same Markdown workspace concurrently through desktop, an
external editor and the PWA. Browser Web Locks cannot coordinate with external
filesystem processes. Interrupted Markdown backup restores keep
`.catpilot-browser-recovery.json` in the workspace; retry using the original
backup to finish recovery. Do not delete the journal to bypass an incomplete
import.

## Editing and transfers

**Write** is the default rich experience for supported Markdown. **Markdown**
opens exact source; its optional **Preview Markdown** toggle renders advanced
syntax safely. Comments, activity logs, Focus notes and long-form metadata use
the same editor. Generated reports are read-only rich documents. Structured
properties remain compact form controls.

The PWA uses the same workspace views as desktop: Tasks has a status board,
priority matrix and month calendar; Projects has a portfolio; Concepts combines
Knowledge, Milestones, Learning and Growth, with folders and kinds in contextual
navigation. On narrow screens expand **Folders and kinds** above the list.
Use **+** beside **Folders** to create one and choose it from a concept's
**Folder** dropdown. The folder's **…** actions also let you nest or delete it
without dragging or right-clicking. Empty folders are included in backups.
Focus lets you start a Pomodoro with optional tasks and a purpose. Journal groups reflections by entry date, while
Timeline shows recorded workspace activity and is not a full audit log. Use the
Board's status menu when dragging is not practical. On narrow screens, selecting
a calendar day reveals its tasks below the grid and item panels open full-screen.

Use **Settings > Workspaces > Export full backup** for a portable JSON backup
including records and assets. Create an empty target workspace, choose
**Preview import**, review it and explicitly approve. The approved payload is
the exact previewed file, not a newly selected file. Invalid checksums, duplicate
IDs and unsafe asset paths are rejected before normal imports mutate a target.
These backups transfer between browser SQLite, browser Markdown and desktop;
they do not establish continuous synchronization.

## Desktop-only capabilities

The browser does **not** run the native Copilot SDK, reuse desktop GitHub
credentials, connect to an AI provider or include an AI server. AI settings
explain this boundary instead of showing nonfunctional sign-in/model controls.
Use desktop for AI assistance. Adding browser AI would require a separately
designed, authenticated trusted backend; never embed provider secrets in this PWA.

Native directory-based legacy-vault migration, CLI/MCP process integration and
desktop signing remain outside the PWA. Import legacy data on desktop and
transfer a portable backup instead.

Automated acceptance exercises Chromium with real IndexedDB, SQLite WASM,
service workers, actual browser directory handles and browser-process restarts.
It is not a claim of manual acceptance on physical Chromebook hardware.
