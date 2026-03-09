---
name: report-generator
description: "Generates professional executive reports from tasks and milestones for a selected period, exported as Markdown or self-contained HTML."
license: MIT
---

# Skill: report-generator

## When to use
Use this skill when the user says things like:
- "Generate a report for this week"
- "Create an executive report for March"
- "Export report in markdown"
- "Build an HTML report with charts"
- "Give me insights from tasks and milestones"

## Inputs to capture (ask only if missing)
**Required**
- Period selection:
  - Preset (`today`, `this-week`, `last-week`, `this-month`, `last-month`, `custom`), or
  - Explicit date range (`from`, `to` in `YYYY-MM-DD`)
- Output format: `markdown` or `html`

**Optional**
- Report title
- Audience style (`operational`, `executive`) - default: `executive`
- Include save/export to file (default: yes)

## Data scope (for now)
- Tasks
- Milestones

Do not include journal/memos unless user explicitly asks (out of current default scope).

## Output format (configuration-aware)
Resolve targets from `data/config.json` before any read/write.

Resolved source paths:
- Tasks: `<storage.root>/<partition>/tasks.md`
- Milestones: `<storage.root>/<partition>/milestones.md`

Resolved report output folder:
- `<storage.root>/<partition>/reports/`

If `data/config.json` is missing or invalid, run `interactive-setup` first.

## Report requirements
Every report must include:
1. **Executive Summary** (short and professional)
2. **Period Covered**
3. **Key Metrics** (numbers):
   - Total tasks
   - Open tasks
   - Done tasks
   - Task completion rate (%)
   - Overdue tasks count (if due dates exist)
   - Total milestones
   - Milestones by status (`Planned`, `In Progress`, `Done`)
4. **Trend/Chart section**
5. **Insights & Risk Signals**
6. **Recommendations / Next Actions**

Analysis must be professional, concise, and useful for executive communication.

## Markdown export rules
- File extension: `.md`
- Include emojis for readability and emphasis.
- Use rich markdown formatting:
  - Headings
  - Summary bullets
  - KPI table
  - Risk/insight callouts
  - Action checklist
- Suggested sections:
  - `# 📊 CatPilot Report - <Period>`
  - `## 🧭 Executive Summary`
  - `## 🔢 KPI Snapshot`
  - `## ✅ Tasks Analysis`
  - `## 🎯 Milestones Analysis`
  - `## 📈 Trends`
  - `## ⚠️ Risks`
  - `## 🚀 Recommendations`

## HTML export rules (self-contained)
- File extension: `.html`
- Must be a single self-contained HTML file.
- Use vanilla JavaScript for interactivity/chart rendering.
- Use TailwindCSS via inline CDN script (no local download):
  - `<script src="https://cdn.tailwindcss.com"></script>`
- Do not depend on external chart libraries.
- Build charts with vanilla JS (for example SVG or `<canvas>`), such as:
  - Task completion bar
  - Milestone status distribution
- Layout must be executive-friendly:
  - Header + period
  - KPI cards
  - Chart area
  - Insights and recommendations panel

## Procedure
1. Resolve config and source paths.
2. Parse tasks and milestones data.
3. Filter records by selected period.
4. Compute KPI metrics and percentages.
5. Generate narrative insights from KPI changes, completion profile, and risk indicators.
6. Build report in requested format (`markdown` or `html`).
7. Save to resolved reports folder with timestamped name:
   - Markdown: `report-YYYYMMDD-HHmm.md`
   - HTML: `report-YYYYMMDD-HHmm.html`
8. Confirm output path and summarize top 3 insights in chat.

## Response style
- Use `📊` to announce report generation.
- Use `✅` for successful export and include file path.
- Use `ℹ️` when period has limited/no data.
- Use `⚠️` for weak data quality (missing dates/status).
- Use `❌` for parse/export failures.

## Files
- `data/config.json` (required to resolve targets)
- Resolved tasks and milestones files (required sources)
- Resolved reports folder (target)