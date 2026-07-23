// catpilot-store.mjs
// Self-contained storage engine for the CatPilot canvas.
//
// This mirrors the EXACT file formats used by CatPilot's lib/cli-utils.js and
// lib/domains.js so everything written here is read back identically by the
// CatPilot agent, the `cat-pilot` CLI, and the CatPilot MCP server. It is kept
// dependency-free and self-contained so the extension folder is portable and
// can be shared as a unit (repo commit or gist).

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const GLOBAL_CONFIG_DIR = path.join(os.homedir(), ".catpilot");
const GLOBAL_CONFIG_PATH = path.join(GLOBAL_CONFIG_DIR, "config.json");

const DEFAULT_FILES = {
    tasks: "tasks.md",
    journal: "journal.md",
    milestones: "milestones.md",
    memos: "memos",
    knowledge: "knowledge",
    learning: "learning",
    growth: "growth",
    projects: "projects",
    achievements: "achievements",
    reports: "reports",
    pomodoro: "pomodoro.md",
};

// Stable (non-partitioned) domain directory names — knowledge/project/learning/
// achievement trees live directly under storage.root so folders + tags map to an
// Obsidian graph and cross-item aggregation is a single tree walk.
const STABLE_DIR_DEFAULTS = {
    knowledge: "knowledge",
    projects: "projects",
    learning: "learning",
    achievements: "achievements",
};

const DOMAIN_TAG = { learning: "learning", growth: "growth", projects: "project" };

// ---------------------------------------------------------------------------
// Config resolution (matches lib/cli-utils.js resolveConfigPath order)
// ---------------------------------------------------------------------------
function resolveConfigPath(projectRoot = process.cwd()) {
    if (process.env.CATPILOT_CONFIG) return { path: process.env.CATPILOT_CONFIG, scope: "env-config" };
    if (process.env.CATPILOT_ROOT) return { path: path.join(process.env.CATPILOT_ROOT, "data", "config.json"), scope: "env-root" };
    const localPath = path.join(projectRoot, "data", "config.json");
    if (fs.existsSync(localPath)) return { path: localPath, scope: "local" };
    if (fs.existsSync(GLOBAL_CONFIG_PATH)) return { path: GLOBAL_CONFIG_PATH, scope: "global" };
    return { path: GLOBAL_CONFIG_PATH, scope: "none" };
}

function configBaseDir(configPath) {
    const dir = path.dirname(configPath);
    if (path.basename(dir).toLowerCase() === "data") return path.dirname(dir);
    return dir;
}

export function configStatus(projectRoot = process.cwd()) {
    const { path: configPath, scope } = resolveConfigPath(projectRoot);
    const exists = scope !== "none" && fs.existsSync(configPath);
    return { configured: exists, configPath, scope };
}

export function loadConfig(projectRoot = process.cwd()) {
    const { path: configPath } = resolveConfigPath(projectRoot);
    if (!fs.existsSync(configPath)) {
        const err = new Error("CatPilot is not set up yet.");
        err.code = "NOT_CONFIGURED";
        throw err;
    }
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    config.__baseDir = configBaseDir(configPath);
    config.__configPath = configPath;
    return config;
}

// Write a global config during onboarding. First-run setup has no prior
// configured location, so there is nothing to move/copy — always adopt the
// chosen root. (Move/Copy migration is offered later from Settings, where the
// plan/preview/approve flow in applyConfigChange handles it safely.)
export function writeConfig({ root, partitioning = "month" } = {}) {
    if (!root || !String(root).trim()) throw new Error("A storage root path is required.");
    if (!["day", "week", "month"].includes(partitioning)) throw new Error("partitioning must be day, week, or month.");
    const config = {
        version: 1,
        storage: {
            root: String(root).trim(),
            partitioning,
            allowExternalPaths: true,
            files: { ...DEFAULT_FILES },
        },
        migration: { mode: "adopt" },
        pomodoro: { ...POMODORO_DEFAULTS },
    };
    fs.mkdirSync(GLOBAL_CONFIG_DIR, { recursive: true });
    fs.writeFileSync(GLOBAL_CONFIG_PATH, JSON.stringify(config, null, 2), "utf8");
    config.__baseDir = configBaseDir(GLOBAL_CONFIG_PATH);
    config.__configPath = GLOBAL_CONFIG_PATH;
    return config;
}

// ---------------------------------------------------------------------------
// Path resolution (matches getPartitionFolder / resolveFilePath)
// ---------------------------------------------------------------------------
function getISOWeek(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

function getPartitionFolder(partitioning = "month") {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const date = String(now.getDate()).padStart(2, "0");
    if (partitioning === "day") return `${year}/${year}-${month}/${year}-${month}-${date}`;
    if (partitioning === "week") return `${year}/W${String(getISOWeek(now)).padStart(2, "0")}`;
    return `${year}/${year}-${month}`;
}

function resolveFilePath(type, config) {
    const partition = getPartitionFolder(config.storage.partitioning);
    const base = config.__baseDir || process.cwd();
    const storageRoot = path.resolve(base, config.storage.root);
    const fileName = (config.storage.files && config.storage.files[type]) || DEFAULT_FILES[type];
    if (!fileName) throw new Error(`Unknown file type: ${type}`);
    return path.join(storageRoot, partition, fileName);
}

// Stable (non-partitioned) directory for a domain, e.g. <root>/knowledge.
// Used by the Knowledge Base, Projects, Learning and Achievements trees.
function resolveStableDir(type, config) {
    const base = config.__baseDir || process.cwd();
    const storageRoot = path.resolve(base, config.storage.root);
    const dirName = (config.storage.files && config.storage.files[type]) || STABLE_DIR_DEFAULTS[type] || type;
    return path.join(storageRoot, dirName);
}

function ensureDir(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// Never overwrite an existing file: if the target path is taken, append
// -2, -3, … before the extension so a "Create" action can never destroy data.
function uniquePath(p) {
    if (!fs.existsSync(p)) return p;
    const dir = path.dirname(p);
    const ext = path.extname(p);
    const stem = path.basename(p, ext);
    for (let i = 2; i < 10000; i++) {
        const candidate = path.join(dir, `${stem}-${i}${ext}`);
        if (!fs.existsSync(candidate)) return candidate;
    }
    throw new Error(`Could not allocate a unique filename for ${p}`);
}

function readFileOrCreate(filePath, def = "") {
    ensureDir(path.dirname(filePath));
    if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, def, "utf8");
    return fs.readFileSync(filePath, "utf8");
}

function todayISO() {
    return new Date().toISOString().split("T")[0];
}

function slugify(title) {
    return String(title)
        .toLowerCase()
        .replace(/[^\w\s-]/g, "")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
        .substring(0, 50) || "note";
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------
// Markdown-table cells are pipe/newline delimited, so any user value that
// contains `|` or a line break must be escaped on write and restored on read,
// otherwise it spills into extra cells/rows and corrupts the table.
function encodeCell(v) {
    return String(v == null ? "" : v).replace(/\r?\n/g, "<br>").replace(/\|/g, "\\|");
}

function decodeCell(v) {
    return String(v == null ? "" : v).replace(/<br\s*\/?>/gi, "\n").replace(/\\\|/g, "|").trim();
}

function splitCells(line) {
    return line.split(/(?<!\\)\|/).map(decodeCell);
}

function parseTasksTable(content) {
    const lines = content.split("\n");
    const tasks = [];
    let inTable = false;
    let headerIndex = -1;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.match(/^##\s+(Open|Completed) Tasks$/)) { inTable = true; headerIndex = -1; continue; }
        if (line.match(/^##\s/) && inTable) { inTable = false; continue; }
        if (!inTable) continue;
        if (line.match(/^[\s\-|]+$/) || !line.trim()) continue;
        if (line.includes("|") && headerIndex === -1) { headerIndex = i; continue; }
        if (line.includes("|") && headerIndex !== -1) {
            const cells = splitCells(line);
            if (cells.length && cells[0] === "") cells.shift();
            if (cells.length && cells[cells.length - 1] === "") cells.pop();
            if (cells.length >= 7) {
                tasks.push({
                    id: parseInt(cells[0], 10) || 0,
                    status: cells[1] || "Open",
                    title: cells[2] || "",
                    dueDate: cells[3] || "",
                    priority: cells[4] || "",
                    tags: cells[5] || "",
                    context: cells[6] || "",
                    project: cells[7] || "",
                });
            }
        }
    }
    return tasks;
}

function formatTasksTable(tasks) {
    const isDone = (t) => t.status === "Done" || t.status === "done";
    // Section 1 = every NOT-done task (Open, Blocked, etc.) so custom statuses
    // persist across the round-trip; section 2 = completed tasks.
    const open = tasks.filter((t) => !isDone(t));
    const done = tasks.filter(isDone);
    const header = "| ID | Status | Title | Due Date | Priority | Tags | Context | Project |\n| --- | --- | --- | --- | --- | --- | --- | --- |\n";
    let out = "";
    if (open.length) {
        out += "## Open Tasks\n\n" + header;
        open.forEach((t) => { out += `| ${t.id} | ${encodeCell(t.status)} | ${encodeCell(t.title)} | ${encodeCell(t.dueDate)} | ${encodeCell(t.priority)} | ${encodeCell(t.tags)} | ${encodeCell(t.context)} | ${encodeCell(t.project)} |\n`; });
        out += "\n";
    }
    if (done.length) {
        out += "## Completed Tasks\n\n" + header;
        done.forEach((t) => { out += `| ${t.id} | ${encodeCell(t.status)} | ${encodeCell(t.title)} | ${encodeCell(t.dueDate)} | ${encodeCell(t.priority)} | ${encodeCell(t.tags)} | ${encodeCell(t.context)} | ${encodeCell(t.project)} |\n`; });
    }
    return out.trimEnd();
}

function nextId(rows) {
    if (!rows.length) return 1;
    return Math.max(...rows.map((r) => r.id || 0)) + 1;
}

// Canonical task statuses. "Overdue" is derived from the due date, never stored.
export const TASK_STATUSES = ["Open", "In Progress", "Blocked", "Done"];

function normalizeTaskStatus(value, fallback = "Open") {
    if (value === undefined || value === null || value === "") return fallback;
    const match = TASK_STATUSES.find((s) => s.toLowerCase() === String(value).trim().toLowerCase());
    if (!match) throw new Error(`Invalid status "${value}". Use one of: ${TASK_STATUSES.join(", ")}`);
    return match;
}

export function listTasks(status = "all") {
    const config = loadConfig();
    const p = resolveFilePath("tasks", config);
    const tasks = parseTasksTable(readFileOrCreate(p));
    if (status === "all") return tasks;
    return tasks.filter((t) => t.status.toLowerCase() === status.toLowerCase());
}

export function addTask(params = {}) {
    if (!params.title) throw new Error("title is required");
    const config = loadConfig();
    const p = resolveFilePath("tasks", config);
    const tasks = parseTasksTable(readFileOrCreate(p));
    const task = {
        id: nextId(tasks),
        status: normalizeTaskStatus(params.status),
        title: params.title,
        dueDate: params.due || "",
        priority: params.priority || "",
        tags: params.tags || "",
        context: params.context || "",
        project: params.project || "",
    };
    tasks.push(task);
    fs.writeFileSync(p, formatTasksTable(tasks), "utf8");
    return task;
}

export function updateTask(id, patch = {}) {
    const config = loadConfig();
    const p = resolveFilePath("tasks", config);
    const tasks = parseTasksTable(readFileOrCreate(p));
    const t = tasks.find((x) => x.id === parseInt(id, 10));
    if (!t) throw new Error(`Task #${id} not found`);
    for (const k of ["status", "title", "dueDate", "priority", "tags", "context", "project"]) {
        if (patch[k] !== undefined) t[k] = k === "status" ? normalizeTaskStatus(patch[k]) : patch[k];
    }
    fs.writeFileSync(p, formatTasksTable(tasks), "utf8");
    return t;
}

export function completeTask(id) {
    return updateTask(id, { status: "Done" });
}

export function removeTask(id) {
    const config = loadConfig();
    const p = resolveFilePath("tasks", config);
    const tasks = parseTasksTable(readFileOrCreate(p));
    const idx = tasks.findIndex((x) => x.id === parseInt(id, 10));
    if (idx === -1) throw new Error(`Task #${id} not found`);
    const [removed] = tasks.splice(idx, 1);
    fs.writeFileSync(p, formatTasksTable(tasks), "utf8");
    return removed;
}

// ---------------------------------------------------------------------------
// Pomodoro
// ---------------------------------------------------------------------------
// Mirrors lib/pomodoro.js + lib/cli-utils.js file formats exactly so the CLI,
// MCP server and this canvas read/write the same timer state and history.
const POMODORO_TYPES = ["focus", "short-break", "long-break"];
const POMODORO_DEFAULTS = { focus: 25, "short-break": 5, "long-break": 15 };
const POMODORO_HISTORY_HEADER = "# Pomodoro Sessions\n\n";

function pomodoroActivePath(config) {
    const base = config.__baseDir || process.cwd();
    const storageRoot = path.resolve(base, config.storage.root);
    return path.join(storageRoot, "pomodoro-active.json");
}

function normalizePomodoroType(type) {
    if (!type) return "focus";
    const t = String(type).toLowerCase().trim();
    if (["break", "short", "shortbreak", "short_break"].includes(t)) return "short-break";
    if (["long", "longbreak", "long_break"].includes(t)) return "long-break";
    return POMODORO_TYPES.includes(t) ? t : "focus";
}

function pomodoroDefaultMinutes(type, config) {
    const t = normalizePomodoroType(type);
    const override = config && config.pomodoro && config.pomodoro[t];
    const n = parseInt(override, 10);
    return Number.isFinite(n) && n > 0 ? n : POMODORO_DEFAULTS[t];
}

function decoratePomodoro(session, at = Date.now()) {
    if (!session) return null;
    const started = Date.parse(session.startedAt);
    const plannedSec = Math.round((session.plannedMin || 0) * 60);
    // While paused the clock freezes: measure elapsed up to the pause instant.
    const paused = !!session.pausedAt;
    const effectiveAt = paused ? Date.parse(session.pausedAt) : at;
    const elapsedSec = Math.max(0, Math.round((effectiveAt - started) / 1000));
    const remainingSec = Math.max(0, plannedSec - elapsedSec);
    return { ...session, paused, elapsedSec, remainingSec, plannedSec, isExpired: remainingSec === 0 };
}

function readPomodoroActive(config) {
    const p = pomodoroActivePath(config);
    if (!fs.existsSync(p)) return null;
    try {
        const data = JSON.parse(fs.readFileSync(p, "utf8"));
        return data && data.startedAt ? data : null;
    } catch { return null; }
}

function parsePomodoroTable(content) {
    const lines = content.split("\n");
    const sessions = [];
    let inTable = false;
    let headerSeen = false;
    for (const line of lines) {
        if (line.match(/^##\s+Sessions$/)) { inTable = true; headerSeen = false; continue; }
        if (line.match(/^##\s/) && inTable) { inTable = false; continue; }
        if (!inTable) continue;
        if (line.match(/^[\s\-|]+$/) || !line.trim()) continue;
        if (line.includes("|") && !headerSeen) { headerSeen = true; continue; }
        if (line.includes("|") && headerSeen) {
            const cells = splitCells(line);
            if (cells.length && cells[0] === "") cells.shift();
            if (cells.length && cells[cells.length - 1] === "") cells.pop();
            if (cells.length >= 9) {
                sessions.push({
                    id: parseInt(cells[0], 10) || 0,
                    type: cells[1] || "focus",
                    task: cells[2] || "",
                    started: cells[3] || "",
                    ended: cells[4] || "",
                    plannedMin: cells[5] || "",
                    actualMin: cells[6] || "",
                    status: cells[7] || "completed",
                    notes: cells[8] || "",
                });
            }
        }
    }
    return sessions;
}

function formatPomodoroTable(sessions) {
    let out = "## Sessions\n\n";
    out += "| ID | Type | Task | Started | Ended | Planned (min) | Actual (min) | Status | Notes |\n";
    out += "| --- | --- | --- | --- | --- | --- | --- | --- | --- |\n";
    sessions.forEach((s) => {
        out += `| ${s.id} | ${encodeCell(s.type)} | ${encodeCell(s.task)} | ${encodeCell(s.started)} | ${encodeCell(s.ended)} | ${encodeCell(s.plannedMin)} | ${encodeCell(s.actualMin)} | ${encodeCell(s.status)} | ${encodeCell(s.notes)} |\n`;
    });
    return out.trimEnd();
}

function loadPomodoroHistory(config) {
    const filePath = resolveFilePath("pomodoro", config);
    const content = readFileOrCreate(filePath, POMODORO_HISTORY_HEADER + formatPomodoroTable([]));
    return { filePath, sessions: parsePomodoroTable(content) };
}

function appendPomodoro(config, session, status, notes) {
    const { filePath, sessions } = loadPomodoroHistory(config);
    const started = Date.parse(session.startedAt);
    const endedAt = new Date();
    const actualMin = Math.max(0, Math.round(((endedAt.getTime() - started) / 1000) / 60));
    const record = {
        id: nextId(sessions),
        type: session.type,
        task: session.task || session.label || "",
        started: session.startedAt,
        ended: endedAt.toISOString(),
        plannedMin: session.plannedMin,
        actualMin,
        status,
        notes: notes ? String(notes) : "",
    };
    sessions.push(record);
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, POMODORO_HISTORY_HEADER + formatPomodoroTable(sessions), "utf8");
    return record;
}

export function pomodoroStatus() {
    const config = loadConfig();
    return { active: decoratePomodoro(readPomodoroActive(config)) };
}

export function pomodoroStart(params = {}) {
    const config = loadConfig();
    const existing = readPomodoroActive(config);
    if (existing && !params.force) {
        const err = new Error("A Pomodoro session is already running.");
        err.active = decoratePomodoro(existing);
        throw err;
    }
    const type = normalizePomodoroType(params.type);
    const minutes = params.minutes != null && Number.isFinite(parseInt(params.minutes, 10))
        ? parseInt(params.minutes, 10)
        : pomodoroDefaultMinutes(type, config);
    if (!(minutes > 0)) throw new Error("minutes must be a positive number");
    const session = {
        type,
        task: params.task ? String(params.task) : "",
        label: params.label ? String(params.label) : "",
        plannedMin: minutes,
        startedAt: new Date().toISOString(),
    };
    ensureDir(path.dirname(pomodoroActivePath(config)));
    fs.writeFileSync(pomodoroActivePath(config), JSON.stringify(session, null, 2), "utf8");
    return { active: decoratePomodoro(session) };
}

export function pomodoroComplete(params = {}) {
    const config = loadConfig();
    const active = readPomodoroActive(config);
    if (!active) throw new Error("No Pomodoro session is currently running.");
    const record = appendPomodoro(config, active, "completed", params.notes);
    fs.rmSync(pomodoroActivePath(config), { force: true });
    return { record };
}

export function pomodoroCancel(params = {}) {
    const config = loadConfig();
    const active = readPomodoroActive(config);
    if (!active) throw new Error("No Pomodoro session is currently running.");
    const record = appendPomodoro(config, active, "abandoned", params.notes);
    fs.rmSync(pomodoroActivePath(config), { force: true });
    return { record };
}

export function pomodoroPause() {
    const config = loadConfig();
    const active = readPomodoroActive(config);
    if (!active) throw new Error("No Pomodoro session is currently running.");
    if (!active.pausedAt) {
        active.pausedAt = new Date().toISOString();
        fs.writeFileSync(pomodoroActivePath(config), JSON.stringify(active, null, 2), "utf8");
    }
    return { active: decoratePomodoro(active) };
}

export function pomodoroResume() {
    const config = loadConfig();
    const active = readPomodoroActive(config);
    if (!active) throw new Error("No Pomodoro session is currently running.");
    if (active.pausedAt) {
        // Shift startedAt forward by the paused span so remaining continues seamlessly.
        const pausedFor = Date.now() - Date.parse(active.pausedAt);
        active.startedAt = new Date(Date.parse(active.startedAt) + Math.max(0, pausedFor)).toISOString();
        delete active.pausedAt;
        fs.writeFileSync(pomodoroActivePath(config), JSON.stringify(active, null, 2), "utf8");
    }
    return { active: decoratePomodoro(active) };
}

export function pomodoroList({ limit } = {}) {
    const config = loadConfig();
    const { sessions } = loadPomodoroHistory(config);
    const ordered = sessions.slice().reverse();
    const n = parseInt(limit, 10);
    return { sessions: Number.isFinite(n) && n > 0 ? ordered.slice(0, n) : ordered };
}

export function pomodoroStats({ period = "all" } = {}) {
    const config = loadConfig();
    const { sessions } = loadPomodoroHistory(config);
    const now = Date.now();
    const inPeriod = sessions.filter((s) => {
        if (period === "all") return true;
        const d = Date.parse(s.started);
        if (!Number.isFinite(d)) return false;
        if (period === "today") {
            const t = new Date();
            return d >= new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime();
        }
        if (period === "week") return d >= now - 7 * 864e5;
        if (period === "month") return d >= now - 30 * 864e5;
        return true;
    });
    const completed = inPeriod.filter((s) => s.status === "completed");
    const focus = completed.filter((s) => s.type === "focus");
    const focusMinutes = focus.reduce((sum, s) => sum + (parseInt(s.actualMin, 10) || 0), 0);
    return {
        period,
        totalSessions: inPeriod.length,
        completedSessions: completed.length,
        abandonedSessions: inPeriod.length - completed.length,
        focusSessions: focus.length,
        focusMinutes,
    };
}

// ---------------------------------------------------------------------------
// Pomodoro reporting
// ---------------------------------------------------------------------------
function pomoPad2(n) { return String(n).padStart(2, "0"); }
function pomoLocalDayKey(d) { return `${d.getFullYear()}-${pomoPad2(d.getMonth() + 1)}-${pomoPad2(d.getDate())}`; }
function pomoIsoWeekKey(d) {
    const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const day = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    const week = Math.ceil((((date - yearStart) / 864e5) + 1) / 7);
    return `${date.getUTCFullYear()}-W${pomoPad2(week)}`;
}
function pomoRate(num, den) { return den > 0 ? Math.round((num / den) * 1000) / 1000 : 0; }

function pomoResolvePeriodRange(period, now = Date.now()) {
    const d = new Date(now);
    const startOfDay = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const mondayOf = (x) => {
        const s = new Date(x.getFullYear(), x.getMonth(), x.getDate());
        const day = s.getDay() || 7;
        s.setDate(s.getDate() - (day - 1));
        return s.getTime();
    };
    switch (period) {
        case "today": return { from: startOfDay(d), to: null };
        case "this-week": return { from: mondayOf(d), to: null };
        case "last-week": { const tw = mondayOf(d); return { from: tw - 7 * 864e5, to: tw }; }
        case "this-month": return { from: new Date(d.getFullYear(), d.getMonth(), 1).getTime(), to: null };
        case "last-month": return { from: new Date(d.getFullYear(), d.getMonth() - 1, 1).getTime(), to: new Date(d.getFullYear(), d.getMonth(), 1).getTime() };
        case "last-7": case "week": return { from: now - 7 * 864e5, to: null };
        case "last-30": case "month": return { from: now - 30 * 864e5, to: null };
        case "all": default: return { from: null, to: null };
    }
}

function pomoSummarize(rows) {
    const total = rows.length;
    const completed = rows.filter((s) => s.status === "completed");
    const abandoned = rows.filter((s) => s.status !== "completed");
    const focus = rows.filter((s) => s.type === "focus");
    const completedFocus = focus.filter((s) => s.status === "completed");
    const focusMinutes = completedFocus.reduce((sum, s) => sum + (parseInt(s.actualMin, 10) || 0), 0);
    const breakMinutes = completed.filter((s) => s.type !== "focus").reduce((sum, s) => sum + (parseInt(s.actualMin, 10) || 0), 0);
    return {
        totalSessions: total,
        completedSessions: completed.length,
        abandonedSessions: abandoned.length,
        focusSessions: focus.length,
        completedFocusSessions: completedFocus.length,
        focusMinutes,
        breakMinutes,
        completionRate: pomoRate(completed.length, total),
        focusCompletionRate: pomoRate(completedFocus.length, focus.length),
    };
}

export function pomodoroReport({ period = "this-week", groupBy = "day" } = {}) {
    const config = loadConfig();
    const { sessions } = loadPomodoroHistory(config);
    const now = Date.now();
    const { from, to } = pomoResolvePeriodRange(period, now);
    const rows = sessions.filter((s) => {
        const t = Date.parse(s.started);
        if (!Number.isFinite(t)) return false;
        if (from != null && t < from) return false;
        if (to != null && t >= to) return false;
        return true;
    });

    const summary = { period, from, to, ...pomoSummarize(rows) };
    let groups = [];

    if (groupBy === "session") {
        groups = rows
            .slice()
            .sort((a, b) => Date.parse(b.started) - Date.parse(a.started))
            .map((s) => ({
                key: String(s.id),
                label: s.started,
                type: s.type,
                task: s.task || "",
                started: s.started,
                plannedMin: parseInt(s.plannedMin, 10) || 0,
                actualMin: parseInt(s.actualMin, 10) || 0,
                status: s.status,
            }));
    } else {
        const buckets = new Map();
        for (const s of rows) {
            let key;
            if (groupBy === "week") key = pomoIsoWeekKey(new Date(Date.parse(s.started)));
            else if (groupBy === "task") key = s.task || "(no task)";
            else key = pomoLocalDayKey(new Date(Date.parse(s.started)));
            if (!buckets.has(key)) buckets.set(key, []);
            buckets.get(key).push(s);
        }
        groups = Array.from(buckets.entries()).map(([key, list]) => {
            const sum = pomoSummarize(list);
            return { key, label: key, ...sum };
        });
        if (groupBy === "task") {
            groups.sort((a, b) => b.focusMinutes - a.focusMinutes || b.completedFocusSessions - a.completedFocusSessions);
        } else {
            groups.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
        }
    }

    return { period, groupBy, summary, groups };
}

// ---------------------------------------------------------------------------
// Journal
// ---------------------------------------------------------------------------
function parseJournalEntries(content) {
    const lines = content.split("\n");
    const entries = [];
    let date = null;
    let text = [];
    for (const line of lines) {
        if (line.match(/^###\s+\d{4}-\d{2}-\d{2}$/)) {
            if (date) entries.push({ date, text: text.join("\n").trim() });
            date = line.replace("### ", "").trim();
            text = [];
        } else if (date) {
            text.push(line);
        }
    }
    if (date) entries.push({ date, text: text.join("\n").trim() });
    return entries;
}

export function listJournal(days = 3650) {
    const config = loadConfig();
    const p = resolveFilePath("journal", config);
    const entries = parseJournalEntries(readFileOrCreate(p));
    return entries.slice(-days).reverse();
}

export function addJournal(text) {
    if (!text || !String(text).trim()) throw new Error("text is required");
    const config = loadConfig();
    const p = resolveFilePath("journal", config);
    const content = readFileOrCreate(p);
    const today = todayISO();
    const heading = `### ${today}`;
    let next;
    if (content.includes(heading)) next = content.replace(heading, `${heading}\n\n${text}`);
    else next = content ? `${content}\n\n${heading}\n\n${text}` : `${heading}\n\n${text}`;
    fs.writeFileSync(p, next, "utf8");
    return { date: today, text };
}

// ---------------------------------------------------------------------------
// Milestones (table: ID | Name | Target Date | Status | Notes)
// ---------------------------------------------------------------------------
function parseMilestones(content) {
    const lines = content.split("\n");
    const rows = [];
    for (const line of lines) {
        if (!line.includes("|")) continue;
        if (line.match(/^[\s\-|]+$/)) continue;
        const cells = splitCells(line);
        if (cells.length && cells[0] === "") cells.shift();
        if (cells.length && cells[cells.length - 1] === "") cells.pop();
        if (!cells.length) continue;
        if (/^id$/i.test(cells[0])) continue; // header
        const id = parseInt(cells[0], 10);
        if (!Number.isFinite(id)) continue;
        rows.push({
            id,
            name: cells[1] || "",
            targetDate: cells[2] || "",
            status: cells[3] || "Planned",
            notes: cells[4] || "",
            link: cells[5] || "",
        });
    }
    return rows;
}

function formatMilestones(rows) {
    let out = "# Milestones\n\n| ID | Name | Target Date | Status | Notes | Link |\n| --- | --- | --- | --- | --- | --- |\n";
    rows.forEach((m) => { out += `| ${m.id} | ${encodeCell(m.name)} | ${encodeCell(m.targetDate)} | ${encodeCell(m.status)} | ${encodeCell(m.notes)} | ${encodeCell(m.link || "")} |\n`; });
    return out.trimEnd();
}

export function listMilestones() {
    const config = loadConfig();
    const p = resolveFilePath("milestones", config);
    return parseMilestones(readFileOrCreate(p));
}

export function addMilestone(params = {}) {
    if (!params.name) throw new Error("name is required");
    const config = loadConfig();
    const p = resolveFilePath("milestones", config);
    const rows = parseMilestones(readFileOrCreate(p));
    const m = {
        id: nextId(rows),
        name: params.name,
        targetDate: params.targetDate || "",
        status: params.status || "Planned",
        notes: params.notes || "",
        link: params.link || "",
    };
    rows.push(m);
    fs.writeFileSync(p, formatMilestones(rows), "utf8");
    return m;
}

export function updateMilestone(id, patch = {}) {
    const config = loadConfig();
    const p = resolveFilePath("milestones", config);
    const rows = parseMilestones(readFileOrCreate(p));
    const m = rows.find((x) => x.id === parseInt(id, 10));
    if (!m) throw new Error(`Milestone #${id} not found`);
    for (const k of ["name", "targetDate", "status", "notes", "link"]) if (patch[k] !== undefined) m[k] = patch[k];
    fs.writeFileSync(p, formatMilestones(rows), "utf8");
    return m;
}

// ---------------------------------------------------------------------------
// Memos
// ---------------------------------------------------------------------------
export function listMemos() {
    const config = loadConfig();
    const dir = resolveFilePath("memos", config);
    ensureDir(dir);
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".md")).sort().reverse();
    return files.map((filename) => {
        let title = filename.replace(/\.md$/, "");
        try {
            const first = fs.readFileSync(path.join(dir, filename), "utf8").split("\n")[0];
            title = first.replace(/^#\s+/, "").trim() || title;
        } catch { /* ignore */ }
        const dateMatch = filename.match(/^(\d{4}-\d{2}-\d{2})_/);
        return { filename, title, date: dateMatch ? dateMatch[1] : "" };
    });
}

export function readMemo(filename) {
    const config = loadConfig();
    const dir = resolveFilePath("memos", config);
    const safe = path.basename(String(filename || ""));
    const p = path.join(dir, safe);
    if (path.dirname(path.resolve(p)) !== path.resolve(dir)) throw new Error("Invalid memo path");
    if (!fs.existsSync(p)) throw new Error(`Memo not found: ${safe}`);
    const content = fs.readFileSync(p, "utf8");
    const lines = content.split("\n");
    const title = (lines[0] || "").replace(/^#\s+/, "").trim();
    const body = lines.slice(2).join("\n").trim();
    return { filename: safe, title, content: body };
}

export function createMemo(params = {}) {
    if (!params.title) throw new Error("title is required");
    const config = loadConfig();
    const dir = resolveFilePath("memos", config);
    ensureDir(dir);
    const filename = `${todayISO()}_${slugify(params.title)}.md`;
    const p = uniquePath(path.join(dir, filename));
    fs.writeFileSync(p, `# ${params.title}\n\n${params.content || "Add your memo content here."}`, "utf8");
    return { filename: path.basename(p), title: params.title };
}

// ---------------------------------------------------------------------------
// Per-file domains: learning, growth, projects (YAML frontmatter notes)
// ---------------------------------------------------------------------------
function toFrontmatter(obj) {
    const lines = ["---"];
    for (const [k, v] of Object.entries(obj)) {
        if (Array.isArray(v)) lines.push(`${k}: [${v.map((x) => JSON.stringify(String(x))).join(", ")}]`);
        else lines.push(`${k}: ${JSON.stringify(v == null ? "" : String(v))}`);
    }
    lines.push("---");
    return lines.join("\n");
}

function parseFrontmatter(content) {
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return {};
    const data = {};
    for (const line of match[1].split("\n")) {
        const idx = line.indexOf(":");
        if (idx === -1) continue;
        const key = line.slice(0, idx).trim();
        let raw = line.slice(idx + 1).trim();
        if (raw.startsWith("[") && raw.endsWith("]")) {
            raw = raw.slice(1, -1).split(",").map((s) => s.trim().replace(/^"|"$/g, "")).filter(Boolean);
        } else {
            raw = raw.replace(/^"|"$/g, "");
        }
        data[key] = raw;
    }
    return data;
}

function assertDomain(domain) {
    if (!(domain in DOMAIN_TAG)) throw new Error(`Unknown domain: ${domain}`);
}

export function listNotes(domain) {
    assertDomain(domain);
    const config = loadConfig();
    const dir = resolveFilePath(domain, config);
    ensureDir(dir);
    return fs.readdirSync(dir)
        .filter((f) => f.endsWith(".md"))
        .sort()
        .reverse()
        .map((filename) => {
            let frontmatter = {};
            try { frontmatter = parseFrontmatter(fs.readFileSync(path.join(dir, filename), "utf8")); } catch { /* ignore */ }
            return { filename, frontmatter };
        });
}

export function readNote(domain, filename) {
    assertDomain(domain);
    const config = loadConfig();
    const dir = resolveFilePath(domain, config);
    const safe = path.basename(String(filename || ""));
    const p = path.join(dir, safe);
    if (path.dirname(path.resolve(p)) !== path.resolve(dir)) throw new Error("Invalid note path");
    if (!fs.existsSync(p)) throw new Error(`Note not found: ${safe}`);
    const content = fs.readFileSync(p, "utf8");
    return { filename: safe, frontmatter: parseFrontmatter(content), body: content.replace(/^---\n[\s\S]*?\n---\n?/, "").trim() };
}

export function addNote(domain, params = {}) {
    assertDomain(domain);
    if (!params.title) throw new Error("title is required");
    const config = loadConfig();
    const dir = resolveFilePath(domain, config);
    ensureDir(dir);
    const filename = `${todayISO()}_${slugify(params.title)}.md`;
    const p = uniquePath(path.join(dir, filename));
    if (path.dirname(path.resolve(p)) !== path.resolve(dir)) throw new Error("Invalid note path");
    const frontmatter = { catpilot: DOMAIN_TAG[domain], title: params.title, date: todayISO(), ...(params.frontmatter || {}) };
    const body = params.body ? `\n${params.body}\n` : "\n";
    fs.writeFileSync(p, `${toFrontmatter(frontmatter)}\n\n# ${params.title}\n${body}`, "utf8");
    return { filename: path.basename(p), frontmatter };
}

// ---------------------------------------------------------------------------
// Dashboard summary aggregation
// ---------------------------------------------------------------------------
function daysAgoISO(n) {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d.toISOString().split("T")[0];
}

// ---------------------------------------------------------------------------
// Cross-partition aggregation. Range-based reads (dashboard last-3-days,
// timeline, report journal) must see data across every day/week/month
// partition, not just the current one. ID-keyed editable domains (tasks,
// milestones) intentionally stay current-partition to match their list views
// and avoid cross-partition ID collisions on edit.
// ---------------------------------------------------------------------------
function walkFind(root, targetName, isDir, depth, acc) {
    if (depth > 5 || !fs.existsSync(root)) return acc;
    let entries;
    try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return acc; }
    for (const e of entries) {
        const full = path.join(root, e.name);
        if (e.name === targetName && ((isDir && e.isDirectory()) || (!isDir && e.isFile()))) {
            acc.push(full);
        } else if (e.isDirectory() && !e.name.startsWith(".")) {
            // Skip dotfolders (.trash, .git, .obsidian, …) — they are tooling
            // state, not CatPilot partitions.
            walkFind(full, targetName, isDir, depth + 1, acc);
        }
    }
    return acc;
}

function allPartitionPaths(config, type) {
    const base = config.__baseDir || process.cwd();
    const storageRoot = path.resolve(base, config.storage.root);
    const fileName = (config.storage.files && config.storage.files[type]) || DEFAULT_FILES[type];
    if (!fileName) return [];
    const isDir = !/\.[a-z]+$/i.test(fileName);
    return walkFind(storageRoot, fileName, isDir, 0, []);
}

function collectJournal(config) {
    const out = [];
    for (const p of allPartitionPaths(config, "journal")) {
        try { out.push(...parseJournalEntries(fs.readFileSync(p, "utf8"))); } catch { /* ignore */ }
    }
    return out;
}

function collectMemos(config) {
    const out = [];
    for (const dir of allPartitionPaths(config, "memos")) {
        let files = [];
        try { files = fs.readdirSync(dir).filter((f) => f.endsWith(".md")); } catch { /* ignore */ }
        for (const filename of files) {
            let title = filename.replace(/\.md$/, "");
            try {
                const first = fs.readFileSync(path.join(dir, filename), "utf8").split("\n")[0];
                title = first.replace(/^#\s+/, "").trim() || title;
            } catch { /* ignore */ }
            const m = filename.match(/^(\d{4}-\d{2}-\d{2})_/);
            out.push({ filename, title, date: m ? m[1] : "" });
        }
    }
    return out;
}

function collectNotes(config, domain) {
    const out = [];
    for (const dir of allPartitionPaths(config, domain)) {
        let files = [];
        try { files = fs.readdirSync(dir).filter((f) => f.endsWith(".md")); } catch { /* ignore */ }
        for (const filename of files) {
            let frontmatter = {};
            try { frontmatter = parseFrontmatter(fs.readFileSync(path.join(dir, filename), "utf8")); } catch { /* ignore */ }
            out.push({ filename, frontmatter });
        }
    }
    return out;
}

function collectReports(config) {
    const out = [];
    for (const dir of allPartitionPaths(config, "reports")) {
        let files = [];
        try { files = fs.readdirSync(dir).filter((f) => /\.(md|html?)$/i.test(f)); } catch { /* ignore */ }
        for (const filename of files) {
            let title = filename;
            try {
                const c = fs.readFileSync(path.join(dir, filename), "utf8");
                const h = c.match(/^#\s+(.+)$/m) || c.match(/<title>([\s\S]*?)<\/title>/i);
                if (h) title = h[1].replace(/<[^>]+>/g, "").trim();
            } catch { /* ignore */ }
            out.push({ filename, title, date: reportDate(filename) });
        }
    }
    return out;
}

// Existing destination paths that a migration would otherwise overwrite.
function destConflicts(src, dest, isDir) {
    const out = [];
    try {
        if (isDir) {
            const names = fs.existsSync(src) ? fs.readdirSync(src) : [];
            for (const name of names) if (fs.existsSync(path.join(dest, name))) out.push(path.join(dest, name));
        } else if (fs.existsSync(dest)) {
            out.push(dest);
        }
    } catch { /* ignore */ }
    return out;
}

export function summary() {
    const config = loadConfig();
    const tasks = parseTasksTable(readFileOrCreate(resolveFilePath("tasks", config)));
    const milestones = parseMilestones(readFileOrCreate(resolveFilePath("milestones", config)));
    const journal = parseJournalEntries(readFileOrCreate(resolveFilePath("journal", config)));
    const memos = listMemos();
    const growth = safeList("growth");
    let knowledgeDocs = [], learningPaths = [], projectList2 = [], achievements = [];
    try { knowledgeDocs = kbList(); } catch { /* ignore */ }
    try { learningPaths = learningList(); } catch { /* ignore */ }
    try { projectList2 = projectList(); } catch { /* ignore */ }
    try { achievements = achievementList(); } catch { /* ignore */ }

    const today = todayISO();
    const open = tasks.filter((t) => t.status.toLowerCase() === "open");
    const done = tasks.filter((t) => t.status.toLowerCase() === "done");
    const blocked = tasks.filter((t) => t.status.toLowerCase() === "blocked");
    const overdue = open.filter((t) => t.dueDate && t.dueDate < today);
    const dueToday = open.filter((t) => t.dueDate === today);

    // Priority distribution among open tasks
    const priorityBuckets = { P0: 0, P1: 0, P2: 0, P3: 0, Other: 0 };
    for (const t of open) {
        const key = (t.priority || "").toUpperCase().replace(/\s/g, "");
        if (key === "P0" || key === "HIGH") priorityBuckets.P0++;
        else if (key === "P1") priorityBuckets.P1++;
        else if (key === "P2" || key === "MED" || key === "MEDIUM") priorityBuckets.P2++;
        else if (key === "P3" || key === "LOW") priorityBuckets.P3++;
        else priorityBuckets.Other++;
    }

    // Last-3-days activity spans partition boundaries, so aggregate across
    // every partition rather than just the current one.
    const journalAll = collectJournal(config);
    const memosAll = collectMemos(config);
    const learningAll = collectNotes(config, "learning");
    const growthAll = collectNotes(config, "growth");
    const projectsAll = collectNotes(config, "projects");

    const since = daysAgoISO(2); // today, -1, -2 => 3 days inclusive
    const last3 = [];
    for (let i = 0; i < 3; i++) {
        const day = daysAgoISO(i);
        const j = journalAll.find((e) => e.date === day);
        const memoCount = memosAll.filter((m) => m.date === day).length;
        const noteCount = [...learningAll, ...growthAll, ...projectsAll].filter((n) => n.frontmatter?.date === day).length;
        last3.push({ date: day, journal: j ? 1 : 0, memos: memoCount, notes: noteCount, doneTasks: 0 });
    }

    const recentActivity = buildTimeline({ journal: journalAll, memos: memosAll, learning: learningAll, growth: growthAll, projects: projectsAll, since });

    const milestoneStatus = { Planned: 0, "In Progress": 0, Done: 0 };
    for (const m of milestones) {
        const s = m.status || "Planned";
        if (milestoneStatus[s] === undefined) milestoneStatus[s] = 0;
        milestoneStatus[s]++;
    }

    return {
        counts: {
            tasksOpen: open.length,
            tasksDone: done.length,
            tasksBlocked: blocked.length,
            tasksOverdue: overdue.length,
            tasksDueToday: dueToday.length,
            milestones: milestones.length,
            memos: memos.length,
            knowledge: knowledgeDocs.length,
            journal: journal.length,
            learning: learningPaths.length,
            growth: growth.length,
            projects: projectList2.length,
            achievements: achievements.length,
        },
        priorityBuckets,
        milestoneStatus,
        last3,
        recentActivity,
        overdue: overdue.slice(0, 6),
        dueToday: dueToday.slice(0, 6),
        upcomingMilestones: milestones
            .filter((m) => (m.status || "").toLowerCase() !== "done")
            .sort((a, b) => (a.targetDate || "9999").localeCompare(b.targetDate || "9999"))
            .slice(0, 5),
        storageRoot: path.resolve(config.__baseDir, config.storage.root),
        partition: getPartitionFolder(config.storage.partitioning),
    };
}

function safeList(domain) {
    try { return listNotes(domain); } catch { return []; }
}

function buildTimeline({ journal, memos, learning, growth, projects, since }) {
    const events = [];
    for (const e of journal) if (e.date >= since) events.push({ date: e.date, type: "journal", label: e.text.slice(0, 80) || "Journal entry" });
    for (const m of memos) if (m.date && m.date >= since) events.push({ date: m.date, type: "memo", label: m.title });
    for (const n of learning) if (n.frontmatter?.date >= since) events.push({ date: n.frontmatter.date, type: "learning", label: n.frontmatter.title || n.filename });
    for (const n of growth) if (n.frontmatter?.date >= since) events.push({ date: n.frontmatter.date, type: "growth", label: n.frontmatter.title || n.filename });
    for (const n of projects) if (n.frontmatter?.date >= since) events.push({ date: n.frontmatter.date, type: "project", label: n.frontmatter.title || n.filename });
    return events.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 25);
}

// ---------------------------------------------------------------------------
// Timeline / activity feed (parametrized, grouped by day)
// ---------------------------------------------------------------------------
function oneLine(s, n = 120) {
    const t = String(s || "").replace(/\s+/g, " ").trim();
    return t.length > n ? t.slice(0, n - 1) + "…" : t;
}

export function activity({ days = 14 } = {}) {
    const config = loadConfig();
    const since = daysAgoISO(Math.max(0, days - 1));
    const journal = collectJournal(config);
    const memos = collectMemos(config);
    const learning = collectNotes(config, "learning");
    const growth = collectNotes(config, "growth");
    const projects = collectNotes(config, "projects");
    const milestones = parseMilestones(readFileOrCreate(resolveFilePath("milestones", config)));
    let reports = [];
    try { reports = collectReports(config); } catch { /* ignore */ }

    const events = [];
    const today = todayISO();
    for (const e of journal) if (e.date >= since) events.push({ date: e.date, type: "journal", label: "Journal entry", detail: oneLine(e.text) });
    for (const m of memos) if (m.date && m.date >= since) events.push({ date: m.date, type: "memo", label: m.title, detail: m.filename });
    for (const n of learning) if (n.frontmatter?.date >= since) events.push({ date: n.frontmatter.date, type: "learning", label: n.frontmatter.title || n.filename, detail: n.frontmatter.status || "" });
    for (const n of growth) if (n.frontmatter?.date >= since) events.push({ date: n.frontmatter.date, type: "growth", label: n.frontmatter.title || n.filename, detail: n.frontmatter.impact || "" });
    for (const n of projects) if (n.frontmatter?.date >= since) events.push({ date: n.frontmatter.date, type: "project", label: n.frontmatter.title || n.filename, detail: n.frontmatter.status || "" });
    for (const m of milestones) if (m.targetDate && m.targetDate >= since && m.targetDate <= today) events.push({ date: m.targetDate, type: "milestone", label: m.name, detail: `Target · ${m.status || "Planned"}` });
    for (const r of reports) if (r.date && r.date >= since) events.push({ date: r.date, type: "report", label: r.title, detail: r.filename });

    events.sort((a, b) => b.date.localeCompare(a.date));
    const groups = [];
    const idx = {};
    for (const e of events) {
        if (!idx[e.date]) { idx[e.date] = { date: e.date, items: [] }; groups.push(idx[e.date]); }
        idx[e.date].items.push(e);
    }
    const byType = {};
    for (const e of events) byType[e.type] = (byType[e.type] || 0) + 1;
    return { since, days, count: events.length, byType, groups, events };
}

// ---------------------------------------------------------------------------
// Reports (Copilot-generated executive reports; shares the partitioned
// `reports/` folder used by the CatPilot report-generator skill)
// ---------------------------------------------------------------------------
function nowStamp() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

function reportDate(filename) {
    const m = filename.match(/(\d{4})-?(\d{2})-?(\d{2})/);
    return m ? `${m[1]}-${m[2]}-${m[3]}` : "";
}

export function listReports() {
    const config = loadConfig();
    const dir = resolveFilePath("reports", config);
    ensureDir(dir);
    const files = fs.readdirSync(dir).filter((f) => /\.(md|html?)$/i.test(f));
    const rows = files.map((filename) => {
        const full = path.join(dir, filename);
        let mtime = 0, size = 0;
        try { const st = fs.statSync(full); mtime = st.mtimeMs; size = st.size; } catch { /* ignore */ }
        const ext = path.extname(filename).slice(1).toLowerCase();
        let title = filename;
        try {
            const c = fs.readFileSync(full, "utf8");
            if (ext === "md") {
                const h = c.match(/^#\s+(.+)$/m);
                if (h) title = h[1].trim();
            } else {
                const h = c.match(/<title>([\s\S]*?)<\/title>/i) || c.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
                if (h) title = h[1].replace(/<[^>]+>/g, "").trim();
            }
        } catch { /* ignore */ }
        return { filename, title, date: reportDate(filename), ext, format: ext === "md" ? "markdown" : "html", mtime, size };
    });
    rows.sort((a, b) => (b.mtime - a.mtime) || b.filename.localeCompare(a.filename));
    return rows;
}

export function readReport(filename) {
    const config = loadConfig();
    const dir = resolveFilePath("reports", config);
    const safe = path.basename(String(filename || ""));
    const full = path.join(dir, safe);
    if (!path.resolve(full).startsWith(path.resolve(dir))) throw new Error("Invalid report path");
    if (!fs.existsSync(full)) { const e = new Error(`Report not found: ${safe}`); e.code = "NOT_FOUND"; throw e; }
    const ext = path.extname(safe).slice(1).toLowerCase();
    const content = fs.readFileSync(full, "utf8");
    let title = safe;
    const h = content.match(/^#\s+(.+)$/m);
    if (h) title = h[1].trim();
    return { filename: safe, title, content, format: ext === "md" ? "markdown" : "html", date: reportDate(safe) };
}

export function saveReport({ title, body, format = "markdown" } = {}) {
    const config = loadConfig();
    const dir = resolveFilePath("reports", config);
    ensureDir(dir);
    const ext = format === "html" ? "html" : "md";
    const slug = slugify(title || "report");
    const filename = `report-${nowStamp()}${slug ? "-" + slug : ""}.${ext}`;
    let content = body || "";
    if (ext === "md" && title && !/^#\s/m.test(content)) content = `# ${title}\n\n${content}`;
    const full = uniquePath(path.join(dir, filename));
    fs.writeFileSync(full, content, "utf8");
    const finalName = path.basename(full);
    return { filename: finalName, title: title || finalName, content, format: ext === "md" ? "markdown" : "html", date: reportDate(finalName) };
}

export function deleteReport(filename) {
    const config = loadConfig();
    const dir = resolveFilePath("reports", config);
    const safe = path.basename(String(filename || ""));
    const full = path.join(dir, safe);
    if (!path.resolve(full).startsWith(path.resolve(dir))) throw new Error("Invalid report path");
    if (fs.existsSync(full)) fs.unlinkSync(full);
    return { ok: true, filename: safe };
}

function periodRange(period = "this-week") {
    const now = new Date();
    const iso = (d) => d.toISOString().split("T")[0];
    const startOfWeek = (d) => { const x = new Date(d); const day = (x.getDay() + 6) % 7; x.setDate(x.getDate() - day); return x; };
    let since, until, label;
    if (period === "today") { since = iso(now); until = iso(now); label = "Today"; }
    else if (period === "last-week") { const s = startOfWeek(now); s.setDate(s.getDate() - 7); const e = new Date(s); e.setDate(e.getDate() + 6); since = iso(s); until = iso(e); label = "Last week"; }
    else if (period === "this-month") { since = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`; until = iso(now); label = "This month"; }
    else if (period === "last-month") { const m = new Date(now.getFullYear(), now.getMonth() - 1, 1); const e = new Date(now.getFullYear(), now.getMonth(), 0); since = iso(m); until = iso(e); label = "Last month"; }
    else if (period === "last-7") { const s = new Date(now); s.setDate(s.getDate() - 6); since = iso(s); until = iso(now); label = "Last 7 days"; }
    else if (period === "last-30") { const s = new Date(now); s.setDate(s.getDate() - 29); since = iso(s); until = iso(now); label = "Last 30 days"; }
    else if (period === "all") { since = "0000-01-01"; until = "9999-12-31"; label = "All time"; }
    else { const s = startOfWeek(now); since = iso(s); until = iso(now); label = "This week"; }
    return { since, until, label };
}

// Build a professional executive report (markdown) from tasks + milestones +
// journal, mirroring the CatPilot report-generator skill's section layout, then
// persist it to the reports folder.
export function generateReport({ period = "this-week", title } = {}) {
    const config = loadConfig();
    const tasks = parseTasksTable(readFileOrCreate(resolveFilePath("tasks", config)));
    const milestones = parseMilestones(readFileOrCreate(resolveFilePath("milestones", config)));
    const journal = collectJournal(config);
    const { since, until, label } = periodRange(period);
    const today = todayISO();

    const isDone = (t) => /^(done|completed)$/i.test(t.status || "");
    const done = tasks.filter(isDone);
    const open = tasks.filter((t) => !isDone(t));
    const total = tasks.length;
    const rate = total ? Math.round((done.length / total) * 100) : 0;
    const overdue = open.filter((t) => t.dueDate && t.dueDate < today);
    const dueToday = open.filter((t) => t.dueDate === today);

    const msStatus = milestones.reduce((a, m) => { const s = m.status || "Planned"; a[s] = (a[s] || 0) + 1; return a; }, {});
    const msDue = milestones.filter((m) => m.targetDate && m.targetDate >= since && m.targetDate <= until);
    const jHits = journal.filter((j) => j.date >= since && j.date <= until);

    const bar = (v, max, w = 20) => { const n = max ? Math.round((v / max) * w) : 0; return "█".repeat(n) + "░".repeat(w - n); };
    const rptTitle = title || `CatPilot Report — ${label}`;

    const insights = [];
    if (overdue.length) insights.push(`⚠️ **${overdue.length} overdue task${overdue.length > 1 ? "s" : ""}** need attention.`);
    if (rate >= 70) insights.push(`✅ Strong completion rate at **${rate}%**.`);
    else if (total) insights.push(`ℹ️ Completion rate is **${rate}%** — room to close out open work.`);
    if ((msStatus["In Progress"] || 0) > 0) insights.push(`🎯 **${msStatus["In Progress"]} milestone${msStatus["In Progress"] > 1 ? "s" : ""}** in progress.`);
    if (!jHits.length) insights.push(`ℹ️ No journal entries in ${label.toLowerCase()} — capture context as you go.`);
    if (!insights.length) insights.push("ℹ️ Limited data for this period. Add tasks and milestones to enrich future reports.");

    const recs = [];
    if (overdue.length) recs.push(`Reschedule or close the ${overdue.length} overdue item${overdue.length > 1 ? "s" : ""}.`);
    if (dueToday.length) recs.push(`Prioritise ${dueToday.length} task${dueToday.length > 1 ? "s" : ""} due today.`);
    if ((msStatus.Planned || 0) > 0) recs.push(`Kick off ${msStatus.Planned} planned milestone${msStatus.Planned > 1 ? "s" : ""}.`);
    recs.push("Review this report with stakeholders and set next-period targets.");

    const md = [
        `# 📊 ${rptTitle}`,
        "",
        `## 🧭 Executive Summary`,
        `Over **${label.toLowerCase()}** (${since} → ${until}), the workspace tracked **${total} task${total !== 1 ? "s" : ""}** ` +
        `(${done.length} completed, ${open.length} open, ${rate}% completion) across **${milestones.length} milestone${milestones.length !== 1 ? "s" : ""}**. ` +
        (overdue.length ? `There ${overdue.length === 1 ? "is" : "are"} **${overdue.length} overdue** item${overdue.length > 1 ? "s" : ""} to address.` : `Nothing is overdue.`),
        "",
        `## 🔢 KPI Snapshot`,
        `| Metric | Value |`,
        `| --- | --- |`,
        `| Total tasks | ${total} |`,
        `| Open tasks | ${open.length} |`,
        `| Completed tasks | ${done.length} |`,
        `| Completion rate | ${rate}% |`,
        `| Overdue | ${overdue.length} |`,
        `| Due today | ${dueToday.length} |`,
        `| Milestones | ${milestones.length} |`,
        `| Journal entries (period) | ${jHits.length} |`,
        "",
        `## ✅ Tasks Analysis`,
        `\`\`\``,
        `Completed  ${bar(done.length, total)}  ${done.length}/${total}`,
        `Open       ${bar(open.length, total)}  ${open.length}/${total}`,
        `\`\`\``,
        overdue.length ? "**Overdue:**\n" + overdue.slice(0, 8).map((t) => `- ${t.title}${t.dueDate ? ` _(due ${t.dueDate})_` : ""}`).join("\n") : "_No overdue tasks._",
        "",
        `## 🎯 Milestones Analysis`,
        Object.keys(msStatus).length
            ? Object.entries(msStatus).map(([s, n]) => `- **${s}:** ${n}`).join("\n")
            : "_No milestones tracked yet._",
        msDue.length ? "\n**Targeting this period:**\n" + msDue.map((m) => `- ${m.name} — ${m.targetDate} _(${m.status})_`).join("\n") : "",
        "",
        `## 📈 Trends`,
        `- ${jHits.length} journal entr${jHits.length === 1 ? "y" : "ies"} logged in ${label.toLowerCase()}.`,
        `- ${done.length} task${done.length !== 1 ? "s" : ""} marked done overall.`,
        "",
        `## ⚠️ Risks & Insights`,
        insights.map((i) => `- ${i}`).join("\n"),
        "",
        `## 🚀 Recommendations`,
        recs.map((r, i) => `${i + 1}. ${r}`).join("\n"),
        "",
        `---`,
        `_Generated by the CatPilot canvas on ${today}. Period: ${label}._`,
    ].join("\n");

    return saveReport({ title: rptTitle, body: md, format: "markdown" });
}

// ---------------------------------------------------------------------------
// Config editing + interactive data migration
// ---------------------------------------------------------------------------

// Resolve every domain path for a given (root, partitioning) pair without
// mutating the active config.
function resolveDomainPaths(baseDir, root, partitioning, files = DEFAULT_FILES) {
    const storageRoot = path.resolve(baseDir, root);
    const partition = getPartitionFolder(partitioning);
    const out = {};
    for (const [type, fileName] of Object.entries({ ...DEFAULT_FILES, ...(files || {}) })) {
        out[type] = { path: path.join(storageRoot, partition, fileName), isDir: !/\.[a-z]+$/i.test(fileName) };
    }
    return { storageRoot, partition, paths: out };
}

function countEntries(p, isDir) {
    try {
        if (isDir) return fs.existsSync(p) ? fs.readdirSync(p).length : 0;
        return fs.existsSync(p) ? 1 : 0;
    } catch { return 0; }
}

// Return the current config plus a normalized view for the settings UI.
export function getConfig() {
    const status = configStatus();
    if (!status.configured) return { configured: false };
    const config = loadConfig();
    const { storageRoot, partition } = resolveDomainPaths(config.__baseDir, config.storage.root, config.storage.partitioning, config.storage.files);
    return {
        configured: true,
        configPath: config.__configPath,
        scope: status.scope,
        root: config.storage.root,
        resolvedRoot: storageRoot,
        partitioning: config.storage.partitioning,
        partition,
        migration: config.migration?.mode || "adopt",
        allowExternalPaths: config.storage.allowExternalPaths !== false,
        pomodoro: {
            focus: pomodoroDefaultMinutes("focus", config),
            "short-break": pomodoroDefaultMinutes("short-break", config),
            "long-break": pomodoroDefaultMinutes("long-break", config),
        },
    };
}

// Persist the Pomodoro session durations block into the active config file.
export function savePomodoroDurations(durations = {}) {
    const status = configStatus();
    if (!status.configured) throw Object.assign(new Error("CatPilot is not set up yet."), { code: "NOT_CONFIGURED" });
    const config = loadConfig();
    const next = { ...POMODORO_DEFAULTS, ...(config.pomodoro || {}) };
    for (const key of Object.keys(POMODORO_DEFAULTS)) {
        const n = parseInt(durations[key], 10);
        if (Number.isFinite(n) && n > 0) next[key] = n;
    }
    config.pomodoro = next;
    const { __baseDir, __configPath, ...clean } = config;
    fs.writeFileSync(config.__configPath, JSON.stringify(clean, null, 2), "utf8");
    return { pomodoro: next };
}

// Build a preview of what changing the config would do — no writes.
export function planConfigChange({ root, partitioning, migration = "move" } = {}) {
    const current = getConfig();
    if (!current.configured) throw Object.assign(new Error("CatPilot is not set up yet."), { code: "NOT_CONFIGURED" });
    const config = loadConfig();
    const baseDir = config.__baseDir;
    const nextRoot = (root && String(root).trim()) || current.root;
    const nextPart = partitioning || current.partitioning;

    const from = resolveDomainPaths(baseDir, current.root, current.partitioning, config.storage.files);
    const to = resolveDomainPaths(baseDir, nextRoot, nextPart, config.storage.files);

    const rootChanged = path.resolve(from.storageRoot) !== path.resolve(to.storageRoot);
    const partChanged = current.partitioning !== nextPart;

    const mkItem = (type, isDir, srcPath, destPath) => {
        const count = countEntries(srcPath, isDir);
        const samePath = path.resolve(srcPath) === path.resolve(destPath);
        const willMove = !samePath && count > 0 && migration !== "adopt";
        return {
            type,
            isDir,
            from: srcPath,
            to: destPath,
            count,
            willMove,
            exists: count > 0,
            conflicts: willMove ? destConflicts(srcPath, destPath, isDir) : [],
        };
    };

    const items = [];
    if (rootChanged && !partChanged) {
        // Root-only change: migrate EVERY partition, preserving the relative
        // layout, so historical data is not left behind in the old root.
        for (const [type, fileName] of Object.entries({ ...DEFAULT_FILES, ...(config.storage.files || {}) })) {
            const isDir = !/\.[a-z]+$/i.test(fileName);
            const srcs = allPartitionPaths(config, type);
            if (!srcs.length) {
                items.push(mkItem(type, from.paths[type].isDir, from.paths[type].path, to.paths[type].path));
                continue;
            }
            for (const src of srcs) {
                const rel = path.relative(from.storageRoot, src);
                items.push(mkItem(type, isDir, src, path.join(to.storageRoot, rel)));
            }
        }
    } else {
        // Partitioning change (re-bucketing history is ambiguous) or same root:
        // operate on the current partition only.
        for (const [type, meta] of Object.entries(from.paths)) {
            items.push(mkItem(type, meta.isDir, meta.path, to.paths[type].path));
        }
    }

    const moving = items.filter((i) => i.willMove);
    const conflicts = items.flatMap((i) => i.conflicts || []);
    return {
        current: { root: current.root, partitioning: current.partitioning, resolvedRoot: from.storageRoot, migration: current.migration },
        next: { root: nextRoot, partitioning: nextPart, resolvedRoot: to.storageRoot, migration },
        rootChanged,
        partitioningChanged: partChanged,
        needsMigration: (rootChanged || partChanged) && migration !== "adopt",
        totalItems: moving.reduce((a, i) => a + i.count, 0),
        conflicts,
        hasConflicts: conflicts.length > 0,
        items,
    };
}

// Move or copy without ever overwriting an existing destination. Returns the
// count of entries moved and the count skipped because the destination existed.
function moveOrCopyPath(src, dest, isDir, mode) {
    if (!fs.existsSync(src)) return { moved: 0, skipped: 0 };
    if (isDir) {
        ensureDir(dest);
        let moved = 0, skipped = 0;
        for (const name of fs.readdirSync(src)) {
            const s = path.join(src, name);
            const d = path.join(dest, name);
            if (fs.existsSync(d)) { skipped++; continue; }
            if (mode === "copy") fs.copyFileSync(s, d);
            else fs.renameSync(s, d);
            moved++;
        }
        return { moved, skipped };
    }
    if (fs.existsSync(dest)) return { moved: 0, skipped: 1 };
    ensureDir(path.dirname(dest));
    if (mode === "copy") fs.copyFileSync(src, dest);
    else fs.renameSync(src, dest);
    return { moved: 1, skipped: 0 };
}

// Persist an in-memory config object back to its own config file, preserving
// any custom fields (storage.files, allowExternalPaths, active config path).
function persistConfig(config) {
    const { __baseDir, __configPath, ...clean } = config;
    const target = __configPath || GLOBAL_CONFIG_PATH;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(clean, null, 2), "utf8");
    return target;
}

// Apply a config change, optionally migrating data across partitions. Requires
// an explicit confirm flag so the UI can gate it behind user approval. If any
// item fails to migrate, the whole operation aborts BEFORE the config is
// rewritten, so config and data never drift out of sync.
export function applyConfigChange({ root, partitioning, migration = "move", confirm = false } = {}) {
    if (!confirm) throw new Error("applyConfigChange requires confirm=true");
    const config = loadConfig();
    const plan = planConfigChange({ root, partitioning, migration });

    let moved = 0, skipped = 0;
    const errors = [];
    if (plan.needsMigration && (migration === "move" || migration === "copy")) {
        for (const item of plan.items) {
            if (!item.willMove) continue;
            try {
                const r = moveOrCopyPath(item.from, item.to, item.isDir, migration);
                moved += r.moved;
                skipped += r.skipped;
            } catch (err) {
                errors.push({ type: item.type, from: item.from, to: item.to, error: String(err && err.message || err) });
            }
        }
    }

    if (errors.length) {
        // Config is left untouched; already-moved files stay where they landed
        // but the source→config mapping is unchanged, so a retry is safe.
        throw Object.assign(new Error(`Migration failed for ${errors.length} item(s); configuration was not changed.`), {
            code: "MIGRATION_FAILED",
            details: errors,
            moved,
            skipped,
        });
    }

    config.storage.root = plan.next.root;
    config.storage.partitioning = plan.next.partitioning;
    config.migration = { ...(config.migration || {}), mode: migration };
    const configPath = persistConfig(config);

    return { ok: true, migrated: moved, moved, skipped, config: getConfig(), applied: plan.next, note: configPath };
}


// ===========================================================================
// Knowledge Base (evolved memos: stable non-partitioned tree + folders + tags)
// Mirrors lib/knowledge.js exactly.
// ===========================================================================
const KB_DEFAULT_FOLDER = "General";
const KB_LEGACY_FOLDER = "Legacy";

function kbStorageRoot(config) {
    const base = config.__baseDir || process.cwd();
    return path.resolve(base, config.storage.root);
}
function kbRoot(config) { return resolveStableDir("knowledge", config); }
function toPosix(p) { return p.split(path.sep).join("/"); }
function kbIdToPath(id, config) {
    const root = kbStorageRoot(config);
    const clean = String(id).replace(/\\/g, "/").replace(/\.md$/i, "");
    const abs = path.resolve(root, clean + ".md");
    if (!abs.startsWith(path.resolve(root))) throw new Error("Invalid knowledge id");
    return abs;
}
function kbPathToId(abs, config) {
    return toPosix(path.relative(kbStorageRoot(config), abs)).replace(/\.md$/i, "");
}
function kbIsLegacy(id) { return !String(id).replace(/\\/g, "/").startsWith("knowledge/"); }
function kbNormTags(tags) {
    if (Array.isArray(tags)) return tags.map((t) => String(t).trim()).filter(Boolean);
    if (typeof tags === "string") return tags.split(",").map((t) => t.trim()).filter(Boolean);
    return [];
}
function kbReadDoc(abs, config) {
    const content = fs.readFileSync(abs, "utf8");
    const fm = parseFrontmatter(content);
    const id = kbPathToId(abs, config);
    const legacy = kbIsLegacy(id);
    const rel = legacy ? "" : toPosix(path.relative(kbRoot(config), abs));
    const folder = fm.folder || (legacy ? KB_LEGACY_FOLDER : (rel.includes("/") ? rel.split("/").slice(0, -1).join("/") : KB_DEFAULT_FOLDER));
    const tags = Array.isArray(fm.tags) ? fm.tags : (fm.tags ? [fm.tags] : []);
    const title = fm.title || path.basename(abs, ".md").replace(/^\d{4}-\d{2}-\d{2}_/, "");
    let stat = null; try { stat = fs.statSync(abs); } catch { /* ignore */ }
    return {
        id, title, folder, tags, legacy,
        created: fm.created || fm.date || (stat ? stat.birthtime.toISOString().split("T")[0] : ""),
        updated: fm.updated || (stat ? stat.mtime.toISOString().split("T")[0] : ""),
        path: abs, frontmatter: fm,
    };
}
function kbDocBody(abs) {
    const content = fs.readFileSync(abs, "utf8");
    if (/^---\n[\s\S]*?\n---/.test(content)) {
        return content.replace(/^---\n[\s\S]*?\n---\n?/, "").replace(/^\s*#\s+.*\n?/, "").trim();
    }
    const lines = content.split("\n");
    if (lines[0] && lines[0].startsWith("# ")) return lines.slice(1).join("\n").trim();
    return content.trim();
}
function kbListLegacy(config) {
    const root = kbStorageRoot(config);
    const memoDirName = (config.storage.files && config.storage.files.memos) || "memos";
    const dirs = walkFind(root, memoDirName, true, 0, []);
    const out = [];
    for (const dir of dirs) {
        if (toPosix(dir).includes("/knowledge/")) continue;
        let files = []; try { files = fs.readdirSync(dir).filter((f) => f.endsWith(".md")); } catch { continue; }
        for (const f of files) { try { out.push(kbReadDoc(path.join(dir, f), config)); } catch { /* ignore */ } }
    }
    return out;
}
export function kbList(filter = {}) {
    const config = loadConfig();
    const kroot = kbRoot(config);
    const docs = [];
    const walk = (dir) => {
        let entries = []; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const e of entries) {
            const full = path.join(dir, e.name);
            if (e.isDirectory()) walk(full);
            else if (e.name.endsWith(".md")) { try { docs.push(kbReadDoc(full, config)); } catch { /* ignore */ } }
        }
    };
    walk(kroot);
    docs.push(...kbListLegacy(config));
    let result = docs;
    if (filter.folder) result = result.filter((d) => (d.folder || "").toLowerCase() === String(filter.folder).toLowerCase());
    if (filter.tag) result = result.filter((d) => d.tags.map((t) => t.toLowerCase()).includes(String(filter.tag).toLowerCase()));
    if (filter.q) { const q = String(filter.q).toLowerCase(); result = result.filter((d) => d.title.toLowerCase().includes(q) || d.tags.join(" ").toLowerCase().includes(q)); }
    result.sort((a, b) => String(b.updated || b.created).localeCompare(String(a.updated || a.created)));
    return result;
}
export function kbFolders() {
    const docs = kbList({});
    const fc = {}, tc = {};
    for (const d of docs) { fc[d.folder] = (fc[d.folder] || 0) + 1; for (const t of d.tags) tc[t] = (tc[t] || 0) + 1; }
    return {
        folders: Object.entries(fc).map(([folder, count]) => ({ folder, count })).sort((a, b) => b.count - a.count || a.folder.localeCompare(b.folder)),
        tags: Object.entries(tc).map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag)),
    };
}
function kbWriteDoc(abs, fm, body) {
    ensureDir(path.dirname(abs));
    fs.writeFileSync(abs, `${toFrontmatter(fm)}\n\n# ${fm.title}\n\n${(body || "").trim()}\n`, "utf8");
}
export function kbAdd(params = {}) {
    if (!params.title) throw new Error("title is required");
    const config = loadConfig();
    const folder = (params.folder && String(params.folder).trim()) || KB_DEFAULT_FOLDER;
    const kroot = kbRoot(config);
    const folderDir = path.join(kroot, folder.split("/").map(slugify).join(path.sep));
    ensureDir(folderDir);
    let filePath = path.join(folderDir, `${slugify(params.title)}.md`);
    if (fs.existsSync(filePath)) filePath = path.join(folderDir, `${slugify(params.title)}-${Date.now().toString(36)}.md`);
    const fm = { catpilot: "memo", title: params.title, folder, tags: kbNormTags(params.tags), created: todayISO(), updated: todayISO() };
    kbWriteDoc(filePath, fm, params.body || "");
    return kbReadDoc(filePath, config);
}
export function kbRead(id) {
    const config = loadConfig();
    const abs = kbIdToPath(id, config);
    if (!fs.existsSync(abs)) throw new Error(`Knowledge doc not found: ${id}`);
    const doc = kbReadDoc(abs, config); doc.body = kbDocBody(abs); return doc;
}
export function kbUpdate(id, patch = {}) {
    const config = loadConfig();
    const abs = kbIdToPath(id, config);
    if (!fs.existsSync(abs)) throw new Error(`Knowledge doc not found: ${id}`);
    const current = kbReadDoc(abs, config);
    const body = patch.body !== undefined ? patch.body : kbDocBody(abs);
    const title = patch.title !== undefined ? patch.title : current.title;
    const folder = patch.folder !== undefined ? (String(patch.folder).trim() || KB_DEFAULT_FOLDER) : (current.legacy ? KB_DEFAULT_FOLDER : current.folder);
    const tags = patch.tags !== undefined ? kbNormTags(patch.tags) : current.tags;
    const fm = { catpilot: "memo", title, folder, tags, created: current.created || todayISO(), updated: todayISO() };
    const kroot = kbRoot(config);
    const folderDir = path.join(kroot, folder.split("/").map(slugify).join(path.sep));
    const migrating = current.legacy || (patch.folder !== undefined && folder !== current.folder) || (patch.title !== undefined && slugify(title) !== path.basename(abs, ".md"));
    if (migrating) {
        ensureDir(folderDir);
        let dest = path.join(folderDir, `${slugify(title)}.md`);
        if (fs.existsSync(dest) && path.resolve(dest) !== path.resolve(abs)) dest = path.join(folderDir, `${slugify(title)}-${Date.now().toString(36)}.md`);
        kbWriteDoc(dest, fm, body);
        if (path.resolve(dest) !== path.resolve(abs)) { try { fs.unlinkSync(abs); } catch { /* ignore */ } }
        return kbRead(kbPathToId(dest, config));
    }
    kbWriteDoc(abs, fm, body);
    return kbRead(id);
}
export function kbMove(id, folder) { return kbUpdate(id, { folder }); }
export function kbRemove(id) {
    const config = loadConfig();
    const abs = kbIdToPath(id, config);
    if (!fs.existsSync(abs)) throw new Error(`Knowledge doc not found: ${id}`);
    const doc = kbReadDoc(abs, config); fs.unlinkSync(abs); return doc;
}


// ===========================================================================
// Achievements (stable-root log) — mirrors lib/achievements.js
// ===========================================================================
function achRoot(config) { return resolveStableDir("achievements", config); }
function achNormTags(t) {
    if (Array.isArray(t)) return t.map((x) => String(x).trim()).filter(Boolean);
    if (typeof t === "string") return t.split(",").map((x) => x.trim()).filter(Boolean);
    return [];
}
function achRead(abs) {
    const content = fs.readFileSync(abs, "utf8");
    const fm = parseFrontmatter(content);
    const body = content.replace(/^---\n[\s\S]*?\n---\n?/, "").replace(/^\s*#\s+.*\n?/, "").trim();
    return {
        filename: path.basename(abs), path: abs,
        title: fm.title || path.basename(abs, ".md").replace(/^\d{4}-\d{2}-\d{2}_/, ""),
        date: fm.date || "", sourceType: fm.source_type || "", source: fm.source || "",
        tags: Array.isArray(fm.tags) ? fm.tags : (fm.tags ? [fm.tags] : []), body,
    };
}
export function achievementAdd(params = {}) {
    if (!params.title) throw new Error("title is required");
    const config = loadConfig();
    const dir = achRoot(config); ensureDir(dir);
    const date = params.date || todayISO();
    let p = path.join(dir, `${date}_${slugify(params.title)}.md`);
    if (fs.existsSync(p)) p = path.join(dir, `${date}_${slugify(params.title)}-${Date.now().toString(36)}.md`);
    const fm = { catpilot: "achievement", title: params.title, date, source_type: params.sourceType || params.source_type || "", source: params.source || "", tags: achNormTags(params.tags) };
    fs.writeFileSync(p, `${toFrontmatter(fm)}\n\n# ${params.title}\n\n${(params.body || "").trim()}\n`, "utf8");
    return achRead(p);
}
export function achievementList(filter = {}) {
    const config = loadConfig();
    const dir = achRoot(config);
    if (!fs.existsSync(dir)) return [];
    let items = fs.readdirSync(dir).filter((f) => f.endsWith(".md")).map((f) => { try { return achRead(path.join(dir, f)); } catch { return null; } }).filter(Boolean);
    if (filter.sourceType) items = items.filter((a) => a.sourceType === filter.sourceType);
    if (filter.source) items = items.filter((a) => a.source === filter.source);
    items.sort((a, b) => String(b.date).localeCompare(String(a.date)) || b.filename.localeCompare(a.filename));
    return items;
}

// ===========================================================================
// Shared step/item progress helpers (learning steps + project items)
// A child item carries a granular progress (0-100). Status and progress are
// kept in sync: Done=100, Todo/Open=0, anything in between = In Progress.
// ===========================================================================
function clampPct(v) { const n = parseInt(v, 10); return isNaN(n) ? 0 : Math.max(0, Math.min(100, n)); }
function statusFromPct(p, zero) { return p >= 100 ? "Done" : p > 0 ? "In Progress" : zero; }
function childProgress(fm) {
    if (fm.progress !== undefined && fm.progress !== "") return clampPct(fm.progress);
    return String(fm.status || "").toLowerCase() === "done" ? 100 : 0;
}
function noteBodyOf(content) {
    return content.replace(/^---\n[\s\S]*?\n---\n?/, "").replace(/^\s*#\s+.*\n?/, "").trim();
}
function resolveProgressStatus({ curProgress = 0, curStatus, patchProgress, patchStatus, zero = "Todo" }) {
    let progress = curProgress;
    let status = curStatus || zero;
    const hasP = patchProgress !== undefined && patchProgress !== null && patchProgress !== "";
    const hasS = patchStatus !== undefined && patchStatus !== null && patchStatus !== "";
    if (hasP) {
        progress = clampPct(patchProgress);
        status = hasS ? patchStatus : statusFromPct(progress, zero);
    } else if (hasS) {
        status = patchStatus;
        const k = String(patchStatus).toLowerCase().replace(/\s/g, "");
        if (k === "done") progress = 100;
        else if (k === "inprogress" || k === "blocked") progress = curProgress > 0 && curProgress < 100 ? curProgress : (curProgress >= 100 ? 99 : 50);
        else progress = 0;
    }
    return { progress, status };
}

// ===========================================================================
// Learning paths (index + steps + derived progress) — mirrors lib/learning.js
// ===========================================================================
function lpRoot(config) { return resolveStableDir("learning", config); }
function lpNormTags(t) { return achNormTags(t); }
function lpDir(slug, config) {
    const dir = path.join(lpRoot(config), slug);
    if (!dir.startsWith(lpRoot(config))) throw new Error("Invalid learning slug");
    return dir;
}
function lpReadIndex(slug, config) {
    const idx = path.join(lpDir(slug, config), "index.md");
    if (!fs.existsSync(idx)) return null;
    const content = fs.readFileSync(idx, "utf8");
    const fm = parseFrontmatter(content);
    const body = content.replace(/^---\n[\s\S]*?\n---\n?/, "").replace(/^\s*#\s+.*\n?/, "").trim();
    return { slug, path: idx, fm, body };
}
function lpListSteps(slug, config) {
    const dir = path.join(lpDir(slug, config), "steps");
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter((f) => f.endsWith(".md")).map((f) => {
        const content = fs.readFileSync(path.join(dir, f), "utf8");
        const fm = parseFrontmatter(content);
        const progress = childProgress(fm);
        return { id: f.replace(/\.md$/, ""), title: fm.title || f.replace(/\.md$/, ""), status: fm.status || statusFromPct(progress, "Todo"), progress, due: fm.due || "", notes: noteBodyOf(content), order: parseInt(fm.order, 10) || 0 };
    }).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}
function lpProgress(steps, fm) {
    if (steps.length) return Math.round(steps.reduce((a, s) => a + childProgress(s), 0) / steps.length);
    return String(fm.status || "").toLowerCase() === "done" ? 100 : (parseInt(fm.progress, 10) || 0);
}
function lpSummary(idx, steps) {
    return {
        slug: idx.slug, legacy: false, title: idx.fm.title || idx.slug, goal: idx.fm.goal || "",
        status: idx.fm.status || "In Progress", progress: lpProgress(steps, idx.fm),
        targetDate: idx.fm.target_date || "", nextReview: idx.fm.next_review || "",
        tags: Array.isArray(idx.fm.tags) ? idx.fm.tags : (idx.fm.tags ? [idx.fm.tags] : []),
        stepCount: steps.length, doneCount: steps.filter((s) => childProgress(s) >= 100).length, path: idx.path,
    };
}
function lpListLegacy(config) {
    const base = config.__baseDir || process.cwd();
    const storageRoot = path.resolve(base, config.storage.root);
    const dirName = (config.storage.files && config.storage.files.learning) || "learning";
    const dirs = walkFind(storageRoot, dirName, true, 0, []).filter((d) => path.resolve(d) !== path.resolve(lpRoot(config)));
    const out = [];
    for (const dir of dirs) {
        let files = []; try { files = fs.readdirSync(dir).filter((f) => f.endsWith(".md")); } catch { continue; }
        for (const f of files) {
            try {
                const fm = parseFrontmatter(fs.readFileSync(path.join(dir, f), "utf8"));
                out.push({ slug: "legacy:" + f.replace(/\.md$/, ""), legacy: true, title: fm.title || f.replace(/\.md$/, ""), goal: fm.goal || "", status: fm.status || "", progress: String(fm.status || "").toLowerCase() === "done" ? 100 : 0, targetDate: fm.target_date || "", nextReview: fm.next_review || "", tags: Array.isArray(fm.tags) ? fm.tags : (fm.tags ? [fm.tags] : []), stepCount: 0, doneCount: 0, path: path.join(dir, f) });
            } catch { /* ignore */ }
        }
    }
    return out;
}
export function learningList(filter = {}) {
    const config = loadConfig();
    const r = lpRoot(config);
    const out = [];
    if (fs.existsSync(r)) for (const e of fs.readdirSync(r, { withFileTypes: true })) { if (!e.isDirectory()) continue; const idx = lpReadIndex(e.name, config); if (idx) out.push(lpSummary(idx, lpListSteps(e.name, config))); }
    out.push(...lpListLegacy(config));
    let result = out;
    if (filter.status) result = result.filter((p) => (p.status || "").toLowerCase() === String(filter.status).toLowerCase());
    if (filter.reviewDue) { const today = todayISO(); result = result.filter((p) => p.nextReview && p.nextReview <= today && p.progress < 100); }
    result.sort((a, b) => a.progress - b.progress || a.title.localeCompare(b.title));
    return result;
}
export function learningRead(slug) {
    const config = loadConfig();
    const idx = lpReadIndex(slug, config);
    if (!idx) throw new Error(`Learning path not found: ${slug}`);
    const steps = lpListSteps(slug, config);
    let linkedMilestones = []; try { linkedMilestones = listMilestones().filter((m) => m.link === `learning:${slug}`); } catch { /* ignore */ }
    return { ...lpSummary(idx, steps), body: idx.body, steps, linkedMilestones };
}
export function learningAddPath(params = {}) {
    if (!params.title) throw new Error("title is required");
    const config = loadConfig();
    let slug = slugify(params.title);
    const r = lpRoot(config); ensureDir(r);
    if (fs.existsSync(path.join(r, slug))) slug = `${slug}-${Date.now().toString(36)}`;
    const dir = path.join(r, slug); ensureDir(dir);
    const fm = { catpilot: "learning", title: params.title, goal: params.goal || "", status: params.status || "In Progress", target_date: params.target_date || params.targetDate || "", next_review: params.next_review || params.nextReview || "", tags: lpNormTags(params.tags), created: todayISO(), updated: todayISO() };
    fs.writeFileSync(path.join(dir, "index.md"), `${toFrontmatter(fm)}\n\n# ${params.title}\n\n${(params.body || "").trim()}\n`, "utf8");
    if (Array.isArray(params.steps)) params.steps.forEach((s, i) => learningAddStep(slug, typeof s === "string" ? { title: s, order: i + 1 } : { ...s, order: s.order || i + 1 }));
    return learningRead(slug);
}
export function learningUpdatePath(slug, patch = {}) {
    const config = loadConfig();
    const idx = lpReadIndex(slug, config);
    if (!idx) throw new Error(`Learning path not found: ${slug}`);
    const fm = { ...idx.fm, catpilot: "learning", updated: todayISO() };
    const map = { title: "title", goal: "goal", status: "status", targetDate: "target_date", target_date: "target_date", nextReview: "next_review", next_review: "next_review" };
    for (const [k, key] of Object.entries(map)) if (patch[k] !== undefined) fm[key] = patch[k];
    if (patch.tags !== undefined) fm.tags = lpNormTags(patch.tags);
    const body = patch.body !== undefined ? patch.body : idx.body;
    fs.writeFileSync(idx.path, `${toFrontmatter(fm)}\n\n# ${fm.title || slug}\n\n${(body || "").trim()}\n`, "utf8");
    return learningRead(slug);
}
export function learningAddStep(slug, params = {}) {
    if (!params.title) throw new Error("step title is required");
    const config = loadConfig();
    if (!lpReadIndex(slug, config)) throw new Error(`Learning path not found: ${slug}`);
    const dir = path.join(lpDir(slug, config), "steps"); ensureDir(dir);
    const existing = lpListSteps(slug, config);
    const order = params.order !== undefined ? parseInt(params.order, 10) : existing.length + 1;
    let id = slugify(params.title);
    if (fs.existsSync(path.join(dir, id + ".md"))) id = `${id}-${Date.now().toString(36)}`;
    const { progress, status } = resolveProgressStatus({ patchProgress: params.progress, patchStatus: params.status, zero: "Todo" });
    const fm = { catpilot: "learning-step", learning: slug, title: params.title, status, progress, due: params.due || "", order };
    const notes = (params.notes !== undefined ? params.notes : params.body) || "";
    fs.writeFileSync(path.join(dir, id + ".md"), `${toFrontmatter(fm)}\n\n# ${params.title}\n\n${String(notes).trim()}\n`, "utf8");
    return maybeCompleteLearning(slug);
}
export function learningUpdateStep(slug, stepId, patch = {}) {
    const config = loadConfig();
    const file = path.join(lpDir(slug, config), "steps", path.basename(stepId) + ".md");
    if (!fs.existsSync(file)) throw new Error(`Step not found: ${stepId}`);
    const content = fs.readFileSync(file, "utf8");
    const fm = parseFrontmatter(content);
    fm.catpilot = "learning-step"; fm.learning = slug;
    if (patch.title !== undefined) fm.title = patch.title;
    if (patch.order !== undefined) fm.order = parseInt(patch.order, 10);
    if (patch.due !== undefined) fm.due = patch.due;
    const cur = resolveProgressStatus({ curProgress: childProgress(fm), curStatus: fm.status, patchProgress: patch.progress, patchStatus: patch.status, zero: "Todo" });
    fm.progress = cur.progress; fm.status = cur.status;
    const body = (patch.notes !== undefined ? patch.notes : (patch.body !== undefined ? patch.body : noteBodyOf(content))) || "";
    fs.writeFileSync(file, `${toFrontmatter(fm)}\n\n# ${fm.title}\n\n${String(body).trim()}\n`, "utf8");
    return maybeCompleteLearning(slug);
}
function maybeCompleteLearning(slug) {
    const result = learningRead(slug);
    if (result.stepCount > 0 && result.doneCount === result.stepCount && String(result.status).toLowerCase() !== "done") return learningComplete(slug);
    return result;
}
export function learningRemoveStep(slug, stepId) {
    const config = loadConfig();
    const file = path.join(lpDir(slug, config), "steps", path.basename(stepId) + ".md");
    if (!fs.existsSync(file)) throw new Error(`Step not found: ${stepId}`);
    fs.unlinkSync(file); return learningRead(slug);
}
export function learningComplete(slug) {
    const config = loadConfig();
    const idx = lpReadIndex(slug, config);
    if (!idx) throw new Error(`Learning path not found: ${slug}`);
    learningUpdatePath(slug, { status: "Done" });
    try { achievementAdd({ title: `Completed learning path: ${idx.fm.title || slug}`, sourceType: "learning", source: slug, tags: Array.isArray(idx.fm.tags) ? idx.fm.tags : [] }); } catch { /* ignore */ }
    return learningRead(slug);
}
export function learningRemovePath(slug) {
    const config = loadConfig();
    const dir = lpDir(slug, config);
    if (!fs.existsSync(dir)) throw new Error(`Learning path not found: ${slug}`);
    fs.rmSync(dir, { recursive: true, force: true });
    return { slug, removed: true };
}


// ===========================================================================
// Projects (index + items + linked tasks + rollup) — mirrors lib/projects.js
// ===========================================================================
const PROJECT_ITEM_TYPES = ["requirement", "task", "milestone"];
function prRoot(config) { return resolveStableDir("projects", config); }
function prNormTags(t) { return achNormTags(t); }
function prDir(slug, config) {
    const dir = path.join(prRoot(config), slug);
    if (!dir.startsWith(prRoot(config))) throw new Error("Invalid project slug");
    return dir;
}
function prReadIndex(slug, config) {
    const idx = path.join(prDir(slug, config), "index.md");
    if (!fs.existsSync(idx)) return null;
    const content = fs.readFileSync(idx, "utf8");
    const fm = parseFrontmatter(content);
    const body = content.replace(/^---\n[\s\S]*?\n---\n?/, "").replace(/^\s*#\s+.*\n?/, "").trim();
    return { slug, path: idx, fm, body };
}
function prListItems(slug, config) {
    const dir = path.join(prDir(slug, config), "items");
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter((f) => f.endsWith(".md")).map((f) => {
        const content = fs.readFileSync(path.join(dir, f), "utf8");
        const fm = parseFrontmatter(content);
        const progress = childProgress(fm);
        return { id: f.replace(/\.md$/, ""), type: PROJECT_ITEM_TYPES.includes((fm.type || "").toLowerCase()) ? fm.type.toLowerCase() : "task", title: fm.title || f.replace(/\.md$/, ""), status: fm.status || statusFromPct(progress, "Open"), progress, due: fm.due || "", notes: noteBodyOf(content), order: parseInt(fm.order, 10) || 0 };
    }).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}
function prLinkedTasks(slug, config) {
    try {
        const p = resolveFilePath("tasks", config);
        const tasks = parseTasksTable(readFileOrCreate(p));
        return tasks.filter((t) => (t.project || "").toLowerCase() === slug.toLowerCase());
    } catch { return []; }
}
function prProgress(items, tasks) {
    // Requirements describe scope (not progress). Progress = avg of task/milestone
    // item progress plus linked main tasks (done=100 else 0).
    const parts = [
        ...items.filter((i) => i.type === "task" || i.type === "milestone").map((i) => childProgress(i)),
        ...tasks.map((t) => (String(t.status).toLowerCase() === "done" ? 100 : 0)),
    ];
    if (!parts.length) return 0;
    return Math.round(parts.reduce((a, p) => a + p, 0) / parts.length);
}
function prSummary(idx, items, tasks) {
    return {
        slug: idx.slug, legacy: false, title: idx.fm.title || idx.slug, status: idx.fm.status || "Active",
        start: idx.fm.start || "", due: idx.fm.due || "", owner: idx.fm.owner || "", summary: idx.fm.summary || "",
        tags: Array.isArray(idx.fm.tags) ? idx.fm.tags : (idx.fm.tags ? [idx.fm.tags] : []),
        itemCount: items.length, taskCount: tasks.length, progress: prProgress(items, tasks), path: idx.path,
    };
}
function prListLegacy(config) {
    const base = config.__baseDir || process.cwd();
    const storageRoot = path.resolve(base, config.storage.root);
    const dirName = (config.storage.files && config.storage.files.projects) || "projects";
    const dirs = walkFind(storageRoot, dirName, true, 0, []).filter((d) => path.resolve(d) !== path.resolve(prRoot(config)));
    const out = [];
    for (const dir of dirs) {
        let files = []; try { files = fs.readdirSync(dir).filter((f) => f.endsWith(".md")); } catch { continue; }
        for (const f of files) {
            try {
                const fm = parseFrontmatter(fs.readFileSync(path.join(dir, f), "utf8"));
                out.push({ slug: "legacy:" + f.replace(/\.md$/, ""), legacy: true, title: fm.title || f.replace(/\.md$/, ""), status: fm.status || "", start: fm.start || "", due: fm.due || "", owner: fm.owner || "", summary: fm.summary || "", tags: Array.isArray(fm.tags) ? fm.tags : (fm.tags ? [fm.tags] : []), itemCount: 0, taskCount: 0, progress: String(fm.status || "").toLowerCase() === "done" ? 100 : 0, path: path.join(dir, f) });
            } catch { /* ignore */ }
        }
    }
    return out;
}
export function projectList(filter = {}) {
    const config = loadConfig();
    const r = prRoot(config);
    const out = [];
    if (fs.existsSync(r)) for (const e of fs.readdirSync(r, { withFileTypes: true })) { if (!e.isDirectory()) continue; const idx = prReadIndex(e.name, config); if (idx) out.push(prSummary(idx, prListItems(e.name, config), prLinkedTasks(e.name, config))); }
    out.push(...prListLegacy(config));
    let result = out;
    if (filter.status) result = result.filter((p) => (p.status || "").toLowerCase() === String(filter.status).toLowerCase());
    result.sort((a, b) => a.title.localeCompare(b.title));
    return result;
}
export function projectRead(slug) {
    const config = loadConfig();
    const idx = prReadIndex(slug, config);
    if (!idx) throw new Error(`Project not found: ${slug}`);
    const items = prListItems(slug, config);
    const tasks = prLinkedTasks(slug, config);
    let achievements = []; try { achievements = achievementList({ sourceType: "project", source: slug }); } catch { /* ignore */ }
    let linkedMilestones = []; try { linkedMilestones = listMilestones().filter((m) => m.link === `project:${slug}`); } catch { /* ignore */ }
    return { ...prSummary(idx, items, tasks), body: idx.body, requirements: items.filter((i) => i.type === "requirement"), milestones: items.filter((i) => i.type === "milestone"), tasks: items.filter((i) => i.type === "task"), linkedTasks: tasks, linkedMilestones, achievements };
}
export function projectAdd(params = {}) {
    if (!params.title) throw new Error("title is required");
    const config = loadConfig();
    let slug = slugify(params.title);
    const r = prRoot(config); ensureDir(r);
    if (fs.existsSync(path.join(r, slug))) slug = `${slug}-${Date.now().toString(36)}`;
    const dir = path.join(r, slug); ensureDir(dir);
    const fm = { catpilot: "project", title: params.title, status: params.status || "Active", start: params.start || todayISO(), due: params.due || "", owner: params.owner || "", summary: params.summary || "", tags: prNormTags(params.tags), created: todayISO(), updated: todayISO() };
    fs.writeFileSync(path.join(dir, "index.md"), `${toFrontmatter(fm)}\n\n# ${params.title}\n\n${(params.body || params.summary || "").trim()}\n`, "utf8");
    return projectRead(slug);
}
export function projectUpdate(slug, patch = {}) {
    const config = loadConfig();
    const idx = prReadIndex(slug, config);
    if (!idx) throw new Error(`Project not found: ${slug}`);
    const fm = { ...idx.fm, catpilot: "project", updated: todayISO() };
    for (const k of ["title", "status", "start", "due", "owner", "summary"]) if (patch[k] !== undefined) fm[k] = patch[k];
    if (patch.tags !== undefined) fm.tags = prNormTags(patch.tags);
    const body = patch.body !== undefined ? patch.body : idx.body;
    fs.writeFileSync(idx.path, `${toFrontmatter(fm)}\n\n# ${fm.title || slug}\n\n${(body || "").trim()}\n`, "utf8");
    return projectRead(slug);
}
export function projectAddItem(slug, params = {}) {
    if (!params.title) throw new Error("item title is required");
    const config = loadConfig();
    if (!prReadIndex(slug, config)) throw new Error(`Project not found: ${slug}`);
    const type = PROJECT_ITEM_TYPES.includes((params.type || "").toLowerCase()) ? params.type.toLowerCase() : "task";
    const dir = path.join(prDir(slug, config), "items"); ensureDir(dir);
    const existing = prListItems(slug, config);
    const order = params.order !== undefined ? parseInt(params.order, 10) : existing.length + 1;
    let id = slugify(params.title);
    if (fs.existsSync(path.join(dir, id + ".md"))) id = `${id}-${Date.now().toString(36)}`;
    const { progress, status } = resolveProgressStatus({ patchProgress: params.progress, patchStatus: params.status, zero: "Open" });
    const fm = { catpilot: "project-item", project: slug, type, title: params.title, status, progress, due: params.due || "", order };
    const notes = (params.notes !== undefined ? params.notes : params.body) || "";
    fs.writeFileSync(path.join(dir, id + ".md"), `${toFrontmatter(fm)}\n\n# ${params.title}\n\n${String(notes).trim()}\n`, "utf8");
    return projectRead(slug);
}
export function projectUpdateItem(slug, itemId, patch = {}) {
    const config = loadConfig();
    const file = path.join(prDir(slug, config), "items", path.basename(itemId) + ".md");
    if (!fs.existsSync(file)) throw new Error(`Item not found: ${itemId}`);
    const content = fs.readFileSync(file, "utf8");
    const fm = parseFrontmatter(content);
    fm.catpilot = "project-item"; fm.project = slug;
    if (patch.type !== undefined) fm.type = patch.type;
    if (patch.title !== undefined) fm.title = patch.title;
    if (patch.due !== undefined) fm.due = patch.due;
    if (patch.order !== undefined) fm.order = parseInt(patch.order, 10);
    const cur = resolveProgressStatus({ curProgress: childProgress(fm), curStatus: fm.status, patchProgress: patch.progress, patchStatus: patch.status, zero: "Open" });
    fm.progress = cur.progress; fm.status = cur.status;
    const body = (patch.notes !== undefined ? patch.notes : (patch.body !== undefined ? patch.body : noteBodyOf(content))) || "";
    fs.writeFileSync(file, `${toFrontmatter(fm)}\n\n# ${fm.title}\n\n${String(body).trim()}\n`, "utf8");
    return projectRead(slug);
}
export function projectRemoveItem(slug, itemId) {
    const config = loadConfig();
    const file = path.join(prDir(slug, config), "items", path.basename(itemId) + ".md");
    if (!fs.existsSync(file)) throw new Error(`Item not found: ${itemId}`);
    fs.unlinkSync(file); return projectRead(slug);
}
export function projectComplete(slug) {
    const config = loadConfig();
    const idx = prReadIndex(slug, config);
    if (!idx) throw new Error(`Project not found: ${slug}`);
    projectUpdate(slug, { status: "Done" });
    try { achievementAdd({ title: `Completed project: ${idx.fm.title || slug}`, sourceType: "project", source: slug, tags: Array.isArray(idx.fm.tags) ? idx.fm.tags : [] }); } catch { /* ignore */ }
    return projectRead(slug);
}
export function projectRemove(slug) {
    const config = loadConfig();
    const dir = prDir(slug, config);
    if (!fs.existsSync(dir)) throw new Error(`Project not found: ${slug}`);
    fs.rmSync(dir, { recursive: true, force: true });
    return { slug, removed: true };
}
