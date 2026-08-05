#!/usr/bin/env node
// Seed a throwaway CatPilot vault with entirely invented data.
//
// Used to produce the documentation screenshots without ever pointing a camera
// at a real vault. Everything below is fiction: no real person, customer or
// project appears here.
//
//   node tools/seed-demo-vault.mjs [targetDir]
//
// Writes <targetDir>/data/config.json, fills the vault, and prints the config
// path so `tools/demo-canvas.mjs` can be launched against it.

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, "..");
const CLI = path.join(REPO, "bin", "cat-cli.js");

const root = path.resolve(process.argv[2] || path.join(os.tmpdir(), "catpilot-demo-vault"));
rmSync(root, { recursive: true, force: true });
mkdirSync(path.join(root, "data"), { recursive: true });

const configPath = path.join(root, "data", "config.json");
writeFileSync(configPath, JSON.stringify({
    version: 1,
    storage: {
        root,
        partitioning: "month",
        allowExternalPaths: true,
        files: {
            tasks: "tasks.md", journal: "journal.md", milestones: "milestones.md",
            memos: "memos", learning: "learning", growth: "growth", projects: "projects",
        },
    },
    migration: { mode: "adopt" },
    pomodoro: { focus: 25, "short-break": 5, "long-break": 15 },
}, null, 2) + "\n");

const env = { ...process.env, CATPILOT_CONFIG: configPath };
const run = (args) => execFileSync(process.execPath, [CLI, ...args], { env, encoding: "utf8", cwd: REPO });

const day = (offset) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return d.toISOString().slice(0, 10);
};

// --- Tasks: every quadrant represented, with a mix of SMART completeness ----
const tasks = [
    {
        title: "Ship the incident postmortem for the checkout outage",
        due: day(1), priority: "P0", tags: "reliability,writing", importance: "high", urgency: "high",
        goal: "A published postmortem with timeline, root cause and three owned follow-up actions",
        measure: "Doc reviewed by the on-call lead and linked from the incident ticket",
        steps: "Pull the timeline from alerts → draft root cause → agree actions with the team → publish",
        why: "The follow-ups cannot be scheduled until the postmortem names owners",
        context: "48h SLA on postmortems for Sev-1 incidents",
    },
    {
        title: "Answer the security questionnaire from the partner team",
        due: day(0), priority: "P0", tags: "security", importance: "high", urgency: "high",
        goal: "Every question answered or explicitly marked not-applicable with a reason",
        measure: "Questionnaire returned and acknowledged by the partner team",
        steps: "Split questions by area → fill in what we know → chase the gaps → send",
        why: "The integration cannot start until this clears",
    },
    {
        title: "Draft the Q3 platform roadmap",
        due: day(18), priority: "P1", tags: "planning,roadmap", importance: "high", urgency: "low",
        goal: "A one-page roadmap with three themes, each with a measurable outcome",
        measure: "Reviewed in the planning sync and merged into the team wiki",
        steps: "Collect team input → cluster into themes → size the work → review → publish",
        why: "Q3 planning locks at the end of the month and drives headcount asks",
    },
    {
        title: "Prepare the demo for the platform showcase",
        due: day(6), priority: "P1", tags: "demo,presenting", importance: "high", urgency: "low",
        goal: "A ten-minute live demo that runs end to end without a fallback recording",
        measure: "Two clean dry-runs on the showcase laptop",
        steps: "Pick the story → script the flow → build the sample data → dry-run twice",
        why: "The showcase is how the wider org learns what the platform can do",
    },
    {
        title: "Write up the caching experiment results",
        due: day(11), priority: "P2", tags: "writing,performance", importance: "high", urgency: "low",
        goal: "A short note with the numbers and a clear recommendation",
        measure: "Note shared and a go/no-go decision recorded",
        steps: "Export the metrics → chart before/after → write the recommendation",
    },
    {
        title: "Renew the team's monitoring certificates",
        due: day(2), priority: "P2", tags: "ops,chore", importance: "low", urgency: "high",
        goal: "All four dashboards serving on a certificate valid for another year",
        measure: "No expiry warnings in the monitoring health check",
        steps: "Request new certs → stage → roll out → verify",
        context: "Renewal is scripted; mostly waiting on approval",
    },
    { title: "Book the team offsite room", due: day(3), priority: "P3", tags: "admin", importance: "low", urgency: "high" },
    {
        title: "Reorganise the old screenshots folder",
        due: day(40), priority: "P3", tags: "cleanup", importance: "low", urgency: "low",
        context: "Nice to have, no deadline attached",
    },
    { title: "Skim the conference talk backlog", priority: "P3", tags: "reading", importance: "low", urgency: "low" },
];

for (const t of tasks) {
    const args = ["task", "add", t.title];
    for (const k of ["due", "priority", "tags", "context", "goal", "measure", "steps", "why", "importance", "urgency"]) {
        if (t[k]) args.push(`--${k}`, t[k]);
    }
    run(args);
}

// A couple of finished items so the board's Done column and the charts fill in.
run(["task", "add", "Rotate the staging database credentials", "--priority", "P2", "--tags", "ops"]);
run(["task", "complete", String(tasks.length + 1)]);
run(["task", "add", "Review the onboarding guide rewrite", "--priority", "P2", "--tags", "writing"]);
run(["task", "complete", String(tasks.length + 2)]);

// --- Journal ---------------------------------------------------------------
for (const line of [
    "Paired on the checkout outage timeline. Root cause is narrowing to the retry storm.",
    "Roadmap themes are starting to cluster: reliability, developer speed, cost.",
    "Ran the caching experiment overnight — p95 down noticeably, writing it up next.",
]) run(["journal", "add", line]);

// --- Memos -----------------------------------------------------------------
run(["memo", "create", "Showcase demo script",
    "--content", "Open with the problem, show the before/after numbers, end on the roadmap slide. Keep it under ten minutes."]);

// --- Milestones (no CLI verb yet, so go through the shared store) -----------
process.env.CATPILOT_CONFIG = configPath;
const store = await import(pathToFileURL(path.join(REPO, ".github", "extensions", "catpilot-canvas", "catpilot-store.mjs")).href);
store.addMilestone({ name: "Postmortem process adopted by the whole team", targetDate: day(21), status: "In Progress" });
store.addMilestone({ name: "Q3 roadmap published", targetDate: day(25), status: "Planned" });

console.log(configPath);
