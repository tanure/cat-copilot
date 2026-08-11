#!/usr/bin/env node
// Serve the CatPilot canvas UI against an arbitrary vault, outside the Copilot
// runtime. Used to capture documentation screenshots from invented data, and
// handy for poking at the UI without reloading the extension.
//
//   node tools/seed-demo-vault.mjs                 # prints a config path
//   CATPILOT_CONFIG=<that path> node tools/demo-canvas.mjs
//
// This deliberately mirrors — rather than imports — the extension's HTTP layer:
// extension.mjs top-level-awaits joinSession() from the Copilot SDK, which only
// resolves inside the runtime. The routes below are the read paths the UI needs
// to render, plus canned agent replies so the Copilot popups can be captured.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const UI_DIR = path.join(HERE, "..", ".github", "extensions", "catpilot-canvas", "ui");
const store = await import(pathToFileURL(path.join(HERE, "..", ".github", "extensions", "catpilot-canvas", "catpilot-store.mjs")).href);

const STATIC = {
    "/": { file: "index.html", type: "text/html; charset=utf-8" },
    "/index.html": { file: "index.html", type: "text/html; charset=utf-8" },
    "/app.js": { file: "app.js", type: "text/javascript; charset=utf-8" },
    "/styles.css": { file: "styles.css", type: "text/css; charset=utf-8" },
    "/hero.png": { file: "hero.png", type: "image/png" },
    "/hero.svg": { file: "hero.svg", type: "image/svg+xml" },
};

// A fixed, invented SMART draft so the "Build with Copilot" popup can be shown
// without an attached session.
const DEMO_DRAFT = {
    title: "Publish a one-page Q3 platform roadmap",
    goal: "A single page naming three themes, each with an owner and a measurable outcome",
    measure: "Reviewed in the planning sync and merged into the team wiki",
    steps: "Collect team input → cluster into themes → size the work → review → publish",
    why: "Q3 planning locks at the end of the month and the roadmap drives the headcount ask",
    due: new Date(Date.now() + 18 * 864e5).toISOString().slice(0, 10),
    priority: "P1",
    tags: "planning,roadmap",
    context: "Drafted from a rough note in the planning channel",
    importance: "High",
    urgency: "Low",
};

async function readBody(req) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    if (!chunks.length) return {};
    try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return {}; }
}

async function handleApi(req, url) {
    const p = url.pathname, m = req.method, q = url.searchParams;

    if (p === "/api/status" && m === "GET") return { ...store.configStatus() };
    if (p === "/api/summary" && m === "GET") return store.summary();
    if (p === "/api/config" && m === "GET") return store.getConfig();

    if (p === "/api/tasks" && m === "GET") return { tasks: store.listTasks(q.get("status") || "all") };
    if (p === "/api/tasks" && m === "POST") return { task: store.addTask(await readBody(req)) };
    if (p === "/api/tasks/matrix" && m === "GET") {
        return store.taskMatrix({ quadrant: q.get("quadrant") || undefined, includeDone: q.get("status") !== "open" });
    }
    if (p === "/api/tasks/focus" && m === "GET") return store.taskFocus({ limit: q.get("limit") || 5 });
    if (p === "/api/tasks/stranded" && m === "GET") return store.strandedTasks();
    if (p === "/api/tasks/smart-meta" && m === "GET") {
        return { quadrants: store.eisen.QUADRANTS, dimensions: store.eisen.SMART_DIMENSIONS, timeGroups: store.eisen.TIME_GROUPS };
    }
    let mm = p.match(/^\/api\/tasks\/(\d+)$/);
    if (mm && m === "PUT") return { task: store.updateTask(mm[1], await readBody(req)) };
    mm = p.match(/^\/api\/tasks\/(\d+)\/smart$/);
    if (mm && m === "PUT") return { task: store.updateTaskSmart(mm[1], await readBody(req)) };
    mm = p.match(/^\/api\/tasks\/(\d+)\/comments$/);
    if (mm && m === "GET") return { comments: store.taskCommentList(mm[1]) };

    if (p === "/api/journal" && m === "GET") return { entries: store.listJournal(Number(q.get("days")) || 3650) };
    if (p === "/api/milestones" && m === "GET") return { milestones: store.listMilestones() };
    if (p === "/api/memos" && m === "GET") return { memos: store.listMemos() };
    if (p === "/api/growth" && m === "GET") return { notes: store.listNotes("growth") };
    if (p === "/api/knowledge" && m === "GET") {
        return { docs: store.kbList({ folder: q.get("folder") || undefined, tag: q.get("tag") || undefined, q: q.get("q") || undefined }) };
    }
    if (p === "/api/knowledge" && m === "POST") return { doc: store.kbAdd(await readBody(req)) };
    if (p === "/api/knowledge/folders" && m === "GET") return store.kbFolders();
    if (p === "/api/knowledge/doc" && m === "GET") return { doc: store.kbRead(q.get("id")) };
    if (p === "/api/knowledge/doc" && m === "PUT") return { doc: store.kbUpdate(q.get("id"), await readBody(req)) };
    if (p === "/api/knowledge/doc" && m === "DELETE") return { removed: store.kbRemove(q.get("id")) };
    if (p === "/api/learning-paths" && m === "GET") return { paths: store.learningList({}) };
    if (p === "/api/projects" && m === "GET") return { projects: store.projectList({}) };
    if (p === "/api/achievements" && m === "GET") return { achievements: store.achievementList({}) };
    if (p === "/api/reports" && m === "GET") return { reports: store.listReports() };
    if (p === "/api/timeline" && m === "GET") return store.activity({ days: Number(q.get("days")) || 14 });
    if (p === "/api/pomodoro/status" && m === "GET") return store.pomodoroStatus();
    if (p === "/api/pomodoro/stats" && m === "GET") return store.pomodoroStats({ period: q.get("period") || "all" });
    if (p === "/api/pomodoro" && m === "GET") return store.pomodoroList({});

    // Canned agent replies so the Copilot-powered popups render a real preview.
    if (p === "/api/agent/generate" && m === "POST") {
        await new Promise((r) => setTimeout(r, 400));
        return { ok: true, content: JSON.stringify(DEMO_DRAFT) };
    }
    if (p === "/api/agent" && m === "POST") return { ok: true, id: "demo" };

    return null;
}

const server = createServer((req, res) => {
    (async () => {
        const url = new URL(req.url, "http://127.0.0.1");
        if (url.pathname.startsWith("/api/")) {
            try {
                const data = await handleApi(req, url);
                const code = data === null ? 404 : 200;
                res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
                return res.end(JSON.stringify(data ?? { error: "Not found" }));
            } catch (err) {
                res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
                return res.end(JSON.stringify({ error: err.message, code: err.code || null }));
            }
        }
        const asset = STATIC[url.pathname];
        if (!asset) { res.writeHead(404); return res.end("Not found"); }
        const buf = await readFile(path.join(UI_DIR, asset.file));
        res.writeHead(200, { "Content-Type": asset.type, "Cache-Control": "no-store" });
        res.end(buf);
    })().catch(() => { try { res.writeHead(500); res.end(); } catch { /* */ } });
});

const port = Number(process.env.PORT) || 4173;
server.listen(port, "127.0.0.1", () => console.log(`demo canvas: http://127.0.0.1:${port}/`));
