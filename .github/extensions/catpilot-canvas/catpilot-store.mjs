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
    learning: "learning",
    growth: "growth",
    projects: "projects",
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

// Write a global config during onboarding.
export function writeConfig({ root, partitioning = "month", migration = "adopt" } = {}) {
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
        migration: { mode: migration },
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

function ensureDir(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
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
            const cells = line.split("|").map((c) => c.trim());
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
                });
            }
        }
    }
    return tasks;
}

function formatTasksTable(tasks) {
    const open = tasks.filter((t) => t.status === "Open" || t.status === "open");
    const done = tasks.filter((t) => t.status === "Done" || t.status === "done");
    const header = "| ID | Status | Title | Due Date | Priority | Tags | Context |\n| --- | --- | --- | --- | --- | --- | --- |\n";
    let out = "";
    if (open.length) {
        out += "## Open Tasks\n\n" + header;
        open.forEach((t) => { out += `| ${t.id} | ${t.status} | ${t.title} | ${t.dueDate} | ${t.priority} | ${t.tags} | ${t.context} |\n`; });
        out += "\n";
    }
    if (done.length) {
        out += "## Completed Tasks\n\n" + header;
        done.forEach((t) => { out += `| ${t.id} | ${t.status} | ${t.title} | ${t.dueDate} | ${t.priority} | ${t.tags} | ${t.context} |\n`; });
    }
    return out.trimEnd();
}

function nextId(rows) {
    if (!rows.length) return 1;
    return Math.max(...rows.map((r) => r.id || 0)) + 1;
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
        status: "Open",
        title: params.title,
        dueDate: params.due || "",
        priority: params.priority || "",
        tags: params.tags || "",
        context: params.context || "",
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
    for (const k of ["status", "title", "dueDate", "priority", "tags", "context"]) {
        if (patch[k] !== undefined) t[k] = patch[k];
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
        const cells = line.split("|").map((c) => c.trim());
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
        });
    }
    return rows;
}

function formatMilestones(rows) {
    let out = "# Milestones\n\n| ID | Name | Target Date | Status | Notes |\n| --- | --- | --- | --- | --- |\n";
    rows.forEach((m) => { out += `| ${m.id} | ${m.name} | ${m.targetDate} | ${m.status} | ${m.notes} |\n`; });
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
    for (const k of ["name", "targetDate", "status", "notes"]) if (patch[k] !== undefined) m[k] = patch[k];
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
    const p = path.join(dir, filename);
    if (!path.resolve(p).startsWith(path.resolve(dir))) throw new Error("Invalid memo path");
    if (!fs.existsSync(p)) throw new Error(`Memo not found: ${filename}`);
    const content = fs.readFileSync(p, "utf8");
    const lines = content.split("\n");
    const title = (lines[0] || "").replace(/^#\s+/, "").trim();
    const body = lines.slice(2).join("\n").trim();
    return { filename, title, content: body };
}

export function createMemo(params = {}) {
    if (!params.title) throw new Error("title is required");
    const config = loadConfig();
    const dir = resolveFilePath("memos", config);
    ensureDir(dir);
    const filename = `${todayISO()}_${slugify(params.title)}.md`;
    const p = path.join(dir, filename);
    fs.writeFileSync(p, `# ${params.title}\n\n${params.content || "Add your memo content here."}`, "utf8");
    return { filename, title: params.title };
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
    const p = path.join(dir, filename);
    if (!path.resolve(p).startsWith(path.resolve(dir))) throw new Error("Invalid note path");
    if (!fs.existsSync(p)) throw new Error(`Note not found: ${filename}`);
    const content = fs.readFileSync(p, "utf8");
    return { filename, frontmatter: parseFrontmatter(content), body: content.replace(/^---\n[\s\S]*?\n---\n?/, "").trim() };
}

export function addNote(domain, params = {}) {
    assertDomain(domain);
    if (!params.title) throw new Error("title is required");
    const config = loadConfig();
    const dir = resolveFilePath(domain, config);
    ensureDir(dir);
    const filename = `${todayISO()}_${slugify(params.title)}.md`;
    const p = path.join(dir, filename);
    if (!path.resolve(p).startsWith(path.resolve(dir))) throw new Error("Invalid note path");
    const frontmatter = { catpilot: DOMAIN_TAG[domain], title: params.title, date: todayISO(), ...(params.frontmatter || {}) };
    const body = params.body ? `\n${params.body}\n` : "\n";
    fs.writeFileSync(p, `${toFrontmatter(frontmatter)}\n\n# ${params.title}\n${body}`, "utf8");
    return { filename, frontmatter };
}

// ---------------------------------------------------------------------------
// Dashboard summary aggregation
// ---------------------------------------------------------------------------
function daysAgoISO(n) {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d.toISOString().split("T")[0];
}

export function summary() {
    const config = loadConfig();
    const tasks = parseTasksTable(readFileOrCreate(resolveFilePath("tasks", config)));
    const milestones = parseMilestones(readFileOrCreate(resolveFilePath("milestones", config)));
    const journal = parseJournalEntries(readFileOrCreate(resolveFilePath("journal", config)));
    const memos = listMemos();
    const learning = safeList("learning");
    const growth = safeList("growth");
    const projects = safeList("projects");

    const today = todayISO();
    const open = tasks.filter((t) => t.status.toLowerCase() === "open");
    const done = tasks.filter((t) => t.status.toLowerCase() === "done");
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

    // Activity for last 3 days: journal entries + memos created + notes created
    const since = daysAgoISO(2); // today, -1, -2 => 3 days inclusive
    const last3 = [];
    for (let i = 0; i < 3; i++) {
        const day = daysAgoISO(i);
        const j = journal.find((e) => e.date === day);
        const memoCount = memos.filter((m) => m.date === day).length;
        const noteCount = [...learning, ...growth, ...projects].filter((n) => n.frontmatter?.date === day).length;
        const doneCount = done.length; // done tasks are not dated; approximate 0 per-day
        last3.push({ date: day, journal: j ? 1 : 0, memos: memoCount, notes: noteCount, doneTasks: 0 });
    }

    const recentActivity = buildTimeline({ journal, memos, learning, growth, projects, since });

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
            tasksOverdue: overdue.length,
            tasksDueToday: dueToday.length,
            milestones: milestones.length,
            memos: memos.length,
            journal: journal.length,
            learning: learning.length,
            growth: growth.length,
            projects: projects.length,
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
