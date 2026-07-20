/* CatPilot canvas SPA. Vanilla JS, no build step, no external deps. */
(() => {
    "use strict";

    // ---------------------------------------------------------------- helpers
    const $ = (sel, root = document) => root.querySelector(sel);
    const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const todayISO = () => new Date().toISOString().split("T")[0];

    function el(tag, attrs = {}, ...kids) {
        const n = document.createElement(tag);
        for (const [k, v] of Object.entries(attrs || {})) {
            if (v == null || v === false) continue;
            if (k === "class") n.className = v;
            else if (k === "html") n.innerHTML = v;
            else if (k === "text") n.textContent = v;
            else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
            else if (k === "dataset") Object.assign(n.dataset, v);
            else n.setAttribute(k, v);
        }
        for (const kid of kids.flat()) {
            if (kid == null || kid === false) continue;
            n.append(kid.nodeType ? kid : document.createTextNode(kid));
        }
        return n;
    }

    async function api(path, { method = "GET", body } = {}) {
        const res = await fetch(path, {
            method,
            headers: body ? { "Content-Type": "application/json" } : undefined,
            body: body ? JSON.stringify(body) : undefined,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            const err = new Error(data.error || `Request failed (${res.status})`);
            err.code = data.code; err.status = res.status;
            throw err;
        }
        return data;
    }

    function toast(title, sub, kind = "") {
        const icon = kind === "err" ? "!" : kind === "ok" ? "✓" : "😺";
        const t = el("div", { class: `toast ${kind}` },
            el("div", { class: "t-ic", text: icon }),
            el("div", {}, el("strong", { text: title }), sub ? el("span", { text: sub }) : null));
        $("#toasts").append(t);
        setTimeout(() => { t.style.opacity = "0"; t.style.transform = "translateX(20px)"; setTimeout(() => t.remove(), 250); }, 3200);
    }

    // ---------------------------------------------------------------- modal
    function openModal({ title, body, foot, width }) {
        closeModal();
        const backdrop = el("div", { class: "modal-backdrop", onclick: (e) => { if (e.target === backdrop) closeModal(); } });
        const modal = el("div", { class: "modal" });
        if (width) modal.style.width = `min(${width}px, 100%)`;
        modal.append(
            el("div", { class: "modal-head" },
                el("h3", { text: title }),
                el("button", { class: "icon-btn", text: "✕", onclick: closeModal })),
            el("div", { class: "modal-body" }, body),
            foot ? el("div", { class: "modal-foot" }, foot) : null,
        );
        backdrop.append(modal);
        $("#modal-root").append(backdrop);
        document.addEventListener("keydown", escClose);
        return { close: closeModal, modal };
    }
    function escClose(e) { if (e.key === "Escape") closeModal(); }
    function closeModal() {
        $("#modal-root").innerHTML = "";
        document.removeEventListener("keydown", escClose);
    }

    // ---------------------------------------------------------------- state
    const state = { summary: null, theme: localStorage.getItem("cp-theme") || "dark", view: "dashboard" };

    const NAV = [
        { id: "dashboard", icon: "◆", label: "Dashboard" },
        { id: "tasks", icon: "✓", label: "Tasks", countKey: "tasksOpen" },
        { id: "journal", icon: "✎", label: "Journal", countKey: "journal" },
        { id: "milestones", icon: "⚑", label: "Milestones", countKey: "milestones" },
        { id: "memos", icon: "▤", label: "Memos", countKey: "memos" },
        { id: "learning", icon: "🎓", label: "Learning", countKey: "learning" },
        { id: "growth", icon: "↗", label: "Growth", countKey: "growth" },
        { id: "projects", icon: "�switch", label: "Projects", countKey: "projects" },
    ];
    // fix stray icon
    NAV.find((n) => n.id === "projects").icon = "❏";

    const VIEW_SUB = {
        dashboard: "Your CatPilot at a glance",
        tasks: "Capture, organize and complete work",
        journal: "Daily notes and decisions",
        milestones: "Track goals to completion",
        memos: "Handoffs, summaries and notes",
        learning: "Certifications and study topics",
        growth: "Accomplishments and impact log",
        projects: "Lightweight project status",
    };

    // ---------------------------------------------------------------- theme
    function applyTheme() {
        document.documentElement.setAttribute("data-theme", state.theme);
        const btn = $("#theme-btn");
        if (btn) btn.textContent = state.theme === "dark" ? "☀️" : "🌙";
    }
    function toggleTheme() { state.theme = state.theme === "dark" ? "light" : "dark"; localStorage.setItem("cp-theme", state.theme); applyTheme(); }

    // ---------------------------------------------------------------- badges
    function priorityClass(p) {
        const k = (p || "").toUpperCase().replace(/\s/g, "");
        if (k === "P0" || k === "HIGH") return "p0";
        if (k === "P1") return "p1";
        if (k === "P2" || k === "MED" || k === "MEDIUM") return "p2";
        if (k === "P3" || k === "LOW") return "p3";
        return "";
    }
    function priorityBadge(p) { return p ? el("span", { class: `badge ${priorityClass(p)}`, text: p }) : el("span", { class: "muted small", text: "—" }); }
    function statusBadge(s) {
        const k = (s || "").toLowerCase().replace(/\s/g, "");
        const cls = k === "done" ? "st-done" : k === "inprogress" ? "st-inprogress" : k === "planned" ? "st-planned" : "st-open";
        return el("span", { class: `badge ${cls}`, text: s || "Open" });
    }
    function tagChips(tags) {
        const list = String(tags || "").split(",").map((t) => t.trim()).filter(Boolean);
        if (!list.length) return el("span", { class: "muted small", text: "—" });
        return el("div", { class: "tags" }, list.map((t) => el("span", { class: "tag", text: t })));
    }

    // ---------------------------------------------------------------- charts
    function donut(segments, size = 150) {
        const total = segments.reduce((a, s) => a + s.value, 0);
        const NS = "http://www.w3.org/2000/svg";
        const svg = document.createElementNS(NS, "svg");
        svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
        svg.setAttribute("width", size); svg.setAttribute("height", size);
        const cx = size / 2, cy = size / 2, r = size / 2 - 14, C = 2 * Math.PI * r;
        const track = document.createElementNS(NS, "circle");
        track.setAttribute("cx", cx); track.setAttribute("cy", cy); track.setAttribute("r", r);
        track.setAttribute("fill", "none"); track.setAttribute("stroke", "var(--panel-2)"); track.setAttribute("stroke-width", 16);
        svg.append(track);
        let offset = 0;
        if (total > 0) {
            for (const s of segments) {
                if (!s.value) continue;
                const frac = s.value / total;
                const c = document.createElementNS(NS, "circle");
                c.setAttribute("cx", cx); c.setAttribute("cy", cy); c.setAttribute("r", r);
                c.setAttribute("fill", "none"); c.setAttribute("stroke", s.color); c.setAttribute("stroke-width", 16);
                c.setAttribute("stroke-dasharray", `${C * frac} ${C}`);
                c.setAttribute("stroke-dashoffset", -C * offset);
                c.setAttribute("transform", `rotate(-90 ${cx} ${cy})`);
                c.setAttribute("stroke-linecap", "round");
                svg.append(c);
                offset += frac;
            }
        }
        const t1 = document.createElementNS(NS, "text");
        t1.setAttribute("x", cx); t1.setAttribute("y", cy - 2); t1.setAttribute("text-anchor", "middle");
        t1.setAttribute("font-size", "26"); t1.setAttribute("font-weight", "800"); t1.setAttribute("fill", "var(--text)");
        t1.textContent = total;
        const t2 = document.createElementNS(NS, "text");
        t2.setAttribute("x", cx); t2.setAttribute("y", cy + 16); t2.setAttribute("text-anchor", "middle");
        t2.setAttribute("font-size", "11"); t2.setAttribute("fill", "var(--text-faint)");
        t2.textContent = "total";
        svg.append(t1, t2);
        return svg;
    }

    function stackedBars(days) {
        const series = [
            { key: "journal", color: "#7c5cff", label: "Journal" },
            { key: "memos", color: "#ff7ac2", label: "Memos" },
            { key: "notes", color: "#5aa9ff", label: "Notes" },
        ];
        const max = Math.max(1, ...days.map((d) => series.reduce((a, s) => a + (d[s.key] || 0), 0)));
        const bars = el("div", { class: "bars" });
        for (const d of days) {
            const stack = el("div", { class: "bar-stack" });
            for (const s of series) {
                const v = d[s.key] || 0;
                if (!v) continue;
                const seg = el("div", { class: "bar-seg" });
                seg.style.height = `${(v / max) * 130}px`;
                seg.style.background = s.color;
                seg.title = `${s.label}: ${v}`;
                stack.append(seg);
            }
            const label = new Date(d.date + "T00:00:00").toLocaleDateString(undefined, { weekday: "short" });
            bars.append(el("div", { class: "bar-col" }, stack, el("div", { class: "bar-label", text: label })));
        }
        const legend = el("div", { class: "legend" }, series.map((s) =>
            el("span", {}, el("i", { style: `background:${s.color}` }), s.label)));
        return el("div", {}, bars, legend);
    }

    // ---------------------------------------------------------------- nav
    function renderNav() {
        const nav = $("#nav");
        nav.innerHTML = "";
        const counts = state.summary?.counts || {};
        for (const item of NAV) {
            const count = item.countKey ? counts[item.countKey] : null;
            const node = el("div", {
                class: `nav-item ${state.view === item.id ? "active" : ""}`,
                onclick: () => go(item.id),
            },
                el("span", { class: "nav-ic", text: item.icon }),
                el("span", { text: item.label }),
                count ? el("span", { class: "nav-badge", text: String(count) }) : null);
            nav.append(node);
        }
        const chip = $("#storage-chip");
        if (state.summary?.storageRoot) {
            chip.textContent = `📁 ${state.summary.storageRoot.split(/[\\/]/).slice(-2).join("/")}`;
            chip.title = `${state.summary.storageRoot}  ·  ${state.summary.partition}`;
        }
    }

    // ---------------------------------------------------------------- router
    async function go(view) {
        state.view = view;
        location.hash = view;
        $("#view-title").textContent = NAV.find((n) => n.id === view)?.label || "CatPilot";
        $("#view-sub").textContent = VIEW_SUB[view] || "";
        $("#view-actions").innerHTML = "";
        renderNav();
        const content = $("#content");
        content.innerHTML = "";
        content.append(el("div", { class: "spinner" }));
        try {
            await VIEWS[view](content);
        } catch (err) {
            content.innerHTML = "";
            content.append(errorBox(err));
        }
    }

    function errorBox(err) {
        return el("div", { class: "empty" },
            el("div", { class: "big", text: "😿" }),
            el("h3", { text: "Something went wrong" }),
            el("p", { class: "muted", text: err.message }));
    }

    function emptyState(icon, title, sub, action) {
        return el("div", { class: "empty" },
            el("div", { class: "big", text: icon }),
            el("h3", { text: title }),
            el("p", { class: "muted", text: sub }),
            action ? el("div", { style: "margin-top:16px" }, action) : null);
    }

    // ---------------------------------------------------------------- refresh
    async function refreshSummary() {
        try { state.summary = await api("/api/summary"); }
        catch { state.summary = null; }
        renderNav();
    }

    // =================================================================
    // VIEWS
    // =================================================================
    const VIEWS = {};

    // ---------- Dashboard ----------
    VIEWS.dashboard = async (root) => {
        const s = await api("/api/summary");
        state.summary = s;
        renderNav();
        root.innerHTML = "";

        // Hero
        root.append(el("div", { class: "hero" },
            el("img", { src: "hero.png", alt: "CatPilot" }),
            el("div", { class: "hero-txt" },
                el("h1", { text: greeting() }),
                el("p", { text: heroLine(s) })),
            el("div", { class: "hero-actions" },
                el("button", { class: "btn btn-primary", onclick: () => taskModal(), html: "＋ Task" }),
                el("button", { class: "btn", onclick: () => journalModal(), html: "✎ Journal" }),
                el("button", { class: "btn", onclick: () => milestoneModal(), html: "⚑ Milestone" }))));

        // Stat cards
        const c = s.counts;
        const cards = [
            { n: c.tasksOpen, label: "Open tasks", ic: "✓", tone: "tone-accent", sub: `${c.tasksDone} completed` },
            { n: c.tasksOverdue, label: "Overdue", ic: "⏰", tone: c.tasksOverdue ? "tone-danger" : "tone-ok", sub: `${c.tasksDueToday} due today` },
            { n: c.milestones, label: "Milestones", ic: "⚑", tone: "tone-accent", sub: `${s.milestoneStatus.Done || 0} done` },
            { n: c.memos, label: "Memos", ic: "▤", tone: "", sub: `${c.journal} journal entries` },
            { n: c.learning, label: "Learning", ic: "🎓", tone: "", sub: "topics tracked" },
            { n: c.growth, label: "Growth", ic: "↗", tone: "tone-ok", sub: "impact entries" },
        ];
        root.append(el("div", { class: "grid cards", style: "margin-top:16px" },
            cards.map((cd) => el("div", { class: `card stat hoverable ${cd.tone}` },
                el("span", { class: "stat-ic", text: cd.ic }),
                el("div", { class: "stat-num", text: String(cd.n) }),
                el("div", { class: "stat-label", text: cd.label }),
                el("div", { class: "stat-sub muted", text: cd.sub })))));

        // Charts row
        const chartRow = el("div", { class: "chart-row", style: "margin-top:22px" });
        // Priority donut
        const pb = s.priorityBuckets;
        const pSegs = [
            { label: "P0 / High", value: pb.P0, color: "#ff6b7d" },
            { label: "P1", value: pb.P1, color: "#ffb020" },
            { label: "P2 / Med", value: pb.P2, color: "#7c5cff" },
            { label: "P3 / Low", value: pb.P3, color: "#35c88f" },
            { label: "Unset", value: pb.Other, color: "#5c5c74" },
        ];
        chartRow.append(el("div", { class: "card chart-card" },
            el("h4", { text: "Open tasks by priority" }),
            el("div", { style: "display:flex;gap:20px;align-items:center;flex-wrap:wrap" },
                donut(pSegs),
                el("div", { class: "legend", style: "flex-direction:column;gap:8px" },
                    pSegs.map((seg) => el("span", {}, el("i", { style: `background:${seg.color}` }), `${seg.label} · ${seg.value}`))))));
        // Activity bars
        chartRow.append(el("div", { class: "card chart-card" },
            el("h4", { text: "Activity · last 3 days" }),
            stackedBars(s.last3)));
        root.append(chartRow);

        // Two-column: focus + timeline
        const twoCol = el("div", { class: "grid", style: "grid-template-columns:1fr 1fr;margin-top:22px;align-items:start" });

        // Focus (overdue + due today + upcoming milestones)
        const focus = el("div", { class: "card" });
        focus.append(el("h4", { text: "🎯 Focus", style: "margin:0 0 12px" }));
        const focusItems = [
            ...s.overdue.map((t) => ({ t, tag: "Overdue", cls: "p0" })),
            ...s.dueToday.map((t) => ({ t, tag: "Today", cls: "p1" })),
        ];
        if (!focusItems.length && !s.upcomingMilestones.length) {
            focus.append(el("p", { class: "muted", text: "You're all caught up. No overdue or due-today items. 🎉" }));
        } else {
            focusItems.forEach(({ t, tag, cls }) => {
                focus.append(el("div", { class: "tl-item", onclick: () => taskDetail(t) },
                    el("div", { class: "tl-dot", text: "✓" }),
                    el("div", { class: "tl-body" },
                        el("div", { class: "tl-label", text: t.title }),
                        el("div", { class: "tl-meta", text: `${tag}${t.dueDate ? " · " + t.dueDate : ""}` })),
                    el("span", { class: `badge ${cls}`, text: tag })));
            });
            s.upcomingMilestones.forEach((m) => {
                focus.append(el("div", { class: "tl-item" },
                    el("div", { class: "tl-dot", text: "⚑" }),
                    el("div", { class: "tl-body" },
                        el("div", { class: "tl-label", text: m.name }),
                        el("div", { class: "tl-meta", text: `Milestone${m.targetDate ? " · " + m.targetDate : ""}` })),
                    statusBadge(m.status)));
            });
        }
        twoCol.append(focus);

        // Timeline
        const tl = el("div", { class: "card" });
        tl.append(el("h4", { text: "🕑 Recent activity", style: "margin:0 0 12px" }));
        if (!s.recentActivity.length) {
            tl.append(el("p", { class: "muted", text: "No activity in the last 3 days. Add a journal entry or memo to get started." }));
        } else {
            const tlIcons = { journal: "✎", memo: "▤", learning: "🎓", growth: "↗", project: "❏" };
            const wrap = el("div", { class: "timeline" });
            s.recentActivity.forEach((a) => {
                wrap.append(el("div", { class: "tl-item" },
                    el("div", { class: "tl-dot", text: tlIcons[a.type] || "•" }),
                    el("div", { class: "tl-body" },
                        el("div", { class: "tl-label", text: a.label || "(untitled)" }),
                        el("div", { class: "tl-meta", text: `${a.type} · ${a.date}` }))));
            });
            tl.append(wrap);
        }
        twoCol.append(tl);
        root.append(twoCol);
    };

    function greeting() {
        const h = new Date().getHours();
        const g = h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
        return `${g}! 😺`;
    }
    function heroLine(s) {
        const c = s.counts;
        if (c.tasksOverdue) return `You have ${c.tasksOverdue} overdue task${c.tasksOverdue > 1 ? "s" : ""} and ${c.tasksOpen} open. Let's clear the deck.`;
        if (c.tasksDueToday) return `${c.tasksDueToday} task${c.tasksDueToday > 1 ? "s" : ""} due today, ${c.tasksOpen} open in total. You've got this.`;
        if (c.tasksOpen) return `${c.tasksOpen} open task${c.tasksOpen > 1 ? "s" : ""} and nothing overdue. Nice and steady.`;
        return "Everything's clear. Capture something new to get rolling.";
    }

    // ---------- Tasks ----------
    let taskViewMode = localStorage.getItem("cp-task-view") || "list";
    VIEWS.tasks = async (root) => {
        const { tasks } = await api("/api/tasks?status=all");
        root.innerHTML = "";

        // view switcher in topbar
        const seg = el("div", { class: "segmented" },
            el("button", { class: taskViewMode === "list" ? "active" : "", text: "☰ List", onclick: () => { taskViewMode = "list"; localStorage.setItem("cp-task-view", "list"); go("tasks"); } }),
            el("button", { class: taskViewMode === "board" ? "active" : "", text: "▦ Board", onclick: () => { taskViewMode = "board"; localStorage.setItem("cp-task-view", "board"); go("tasks"); } }));
        $("#view-actions").append(seg);

        const toolbar = el("div", { class: "toolbar" },
            el("button", { class: "btn btn-primary", html: "＋ Add task", onclick: () => taskModal() }),
            el("input", { class: "search", placeholder: "Search tasks…", oninput: (e) => filterTasks(e.target.value) }),
            el("span", { class: "spacer" }),
            el("span", { class: "muted small", text: `${tasks.filter((t) => t.status.toLowerCase() === "open").length} open · ${tasks.filter((t) => t.status.toLowerCase() === "done").length} done` }));
        root.append(toolbar);

        const holder = el("div", { id: "task-holder" });
        root.append(holder);
        if (!tasks.length) { holder.append(emptyState("🗒️", "No tasks yet", "Capture your first task and it will sync straight to CatPilot.", el("button", { class: "btn btn-primary", html: "＋ Add task", onclick: () => taskModal() }))); return; }
        if (taskViewMode === "list") renderTaskList(holder, tasks);
        else renderTaskBoard(holder, tasks);
        root._tasks = tasks;
    };

    function filterTasks(q) {
        q = q.toLowerCase().trim();
        document.querySelectorAll("[data-task-title]").forEach((row) => {
            const hit = !q || row.dataset.taskTitle.toLowerCase().includes(q);
            row.style.display = hit ? "" : "none";
        });
    }

    function renderTaskList(holder, tasks) {
        const open = tasks.filter((t) => t.status.toLowerCase() === "open");
        const done = tasks.filter((t) => t.status.toLowerCase() === "done");
        const ordered = [...open, ...done];
        const tbody = el("tbody");
        ordered.forEach((t) => tbody.append(taskRow(t)));
        holder.append(el("div", { class: "table-wrap" },
            el("table", { class: "tbl" },
                el("thead", {}, el("tr", {},
                    el("th", { text: "" }),
                    el("th", { text: "Task" }),
                    el("th", { text: "Due" }),
                    el("th", { text: "Priority" }),
                    el("th", { text: "Tags" }),
                    el("th", { text: "" }))),
                tbody)));
    }

    function taskRow(t) {
        const done = t.status.toLowerCase() === "done";
        const tr = el("tr", { class: done ? "done-row" : "", dataset: { taskTitle: t.title } });
        const check = el("input", { type: "checkbox", style: "width:auto", ...(done ? { checked: "checked" } : {}) });
        check.addEventListener("change", async () => {
            try {
                if (check.checked) { await api(`/api/tasks/${t.id}/complete`, { method: "POST" }); toast("Task completed", t.title, "ok"); }
                else { await api(`/api/tasks/${t.id}`, { method: "PUT", body: { status: "Open" } }); toast("Reopened", t.title); }
                await refreshSummary(); go("tasks");
            } catch (e) { toast("Error", e.message, "err"); }
        });
        tr.append(
            el("td", { style: "width:34px" }, check),
            el("td", {}, el("div", { class: "cell-title", text: t.title, onclick: () => taskDetail(t) }),
                t.context ? el("div", { class: "muted small", text: t.context }) : null),
            el("td", {}, t.dueDate ? el("span", { class: dueClass(t.dueDate, done), text: t.dueDate }) : el("span", { class: "muted small", text: "—" })),
            el("td", {}, priorityBadge(t.priority)),
            el("td", {}, tagChips(t.tags)),
            el("td", {}, el("div", { class: "row-actions" },
                el("button", { class: "btn btn-sm btn-ghost", text: "Edit", onclick: () => taskModal(t) }),
                el("button", { class: "btn btn-sm btn-ghost btn-danger", text: "Delete", onclick: () => removeTask(t) }))));
        return tr;
    }

    function dueClass(due, done) {
        if (done) return "muted small";
        if (due < todayISO()) return "badge p0";
        if (due === todayISO()) return "badge p1";
        return "small";
    }

    function renderTaskBoard(holder, tasks) {
        const cols = [
            { key: "overdue", title: "⏰ Overdue", filter: (t) => t.status.toLowerCase() === "open" && t.dueDate && t.dueDate < todayISO() },
            { key: "open", title: "◻ To do", filter: (t) => t.status.toLowerCase() === "open" && !(t.dueDate && t.dueDate < todayISO()) },
            { key: "done", title: "✓ Done", filter: (t) => t.status.toLowerCase() === "done" },
        ];
        const board = el("div", { class: "board" });
        for (const col of cols) {
            const items = tasks.filter(col.filter);
            const colEl = el("div", { class: "board-col", dataset: { col: col.key } });
            colEl.append(el("h4", {}, col.title, el("span", { class: "count", text: ` ${items.length}` })));
            items.forEach((t) => colEl.append(boardCard(t)));
            // drag & drop -> change status
            colEl.addEventListener("dragover", (e) => { e.preventDefault(); colEl.classList.add("drop"); });
            colEl.addEventListener("dragleave", () => colEl.classList.remove("drop"));
            colEl.addEventListener("drop", async (e) => {
                e.preventDefault(); colEl.classList.remove("drop");
                const id = e.dataTransfer.getData("text/plain");
                try {
                    if (col.key === "done") await api(`/api/tasks/${id}/complete`, { method: "POST" });
                    else await api(`/api/tasks/${id}`, { method: "PUT", body: { status: "Open" } });
                    await refreshSummary(); go("tasks");
                } catch (err) { toast("Error", err.message, "err"); }
            });
            board.append(colEl);
        }
        holder.append(board);
    }

    function boardCard(t) {
        const done = t.status.toLowerCase() === "done";
        const card = el("div", { class: "board-card", draggable: "true", dataset: { taskTitle: t.title } });
        card.addEventListener("dragstart", (e) => { e.dataTransfer.setData("text/plain", String(t.id)); card.classList.add("dragging"); });
        card.addEventListener("dragend", () => card.classList.remove("dragging"));
        card.append(
            el("div", { class: "bc-title", text: t.title, style: done ? "text-decoration:line-through;color:var(--text-faint)" : "", onclick: () => taskDetail(t) }),
            el("div", { class: "bc-meta" },
                priorityBadge(t.priority),
                t.dueDate ? el("span", { class: dueClass(t.dueDate, done), text: t.dueDate }) : null));
        return card;
    }

    async function removeTask(t) {
        if (!confirm(`Delete task "${t.title}"?`)) return;
        try { await api(`/api/tasks/${t.id}`, { method: "DELETE" }); toast("Deleted", t.title, "ok"); await refreshSummary(); go("tasks"); }
        catch (e) { toast("Error", e.message, "err"); }
    }

    function taskModal(t) {
        const editing = !!t;
        const f = {};
        const body = el("div", { class: "form" },
            field("Title", f, "title", { value: t?.title, placeholder: "What needs doing?", required: true }),
            el("div", { class: "form-row" },
                field("Due date", f, "due", { value: t?.dueDate, type: "date" }),
                selectField("Priority", f, "priority", ["", "P0", "P1", "P2", "P3", "High", "Med", "Low"], t?.priority)),
            field("Tags", f, "tags", { value: t?.tags, placeholder: "comma,separated" }),
            field("Context", f, "context", { value: t?.context, placeholder: "One-line context", area: true }));
        const save = el("button", { class: "btn btn-primary", text: editing ? "Save changes" : "Add task", onclick: async () => {
            const payload = { title: f.title.value.trim(), due: f.due.value, priority: f.priority.value, tags: f.tags.value.trim(), context: f.context.value.trim() };
            if (!payload.title) { toast("Title required", "", "err"); return; }
            try {
                if (editing) { await api(`/api/tasks/${t.id}`, { method: "PUT", body: { title: payload.title, dueDate: payload.due, priority: payload.priority, tags: payload.tags, context: payload.context } }); toast("Task updated", payload.title, "ok"); }
                else { await api("/api/tasks", { method: "POST", body: payload }); toast("Task added", payload.title, "ok"); }
                closeModal(); await refreshSummary(); go("tasks");
            } catch (e) { toast("Error", e.message, "err"); }
        } });
        openModal({ title: editing ? "Edit task" : "New task", body, foot: [el("button", { class: "btn", text: "Cancel", onclick: closeModal }), save] });
        setTimeout(() => f.title.focus(), 50);
    }

    function taskDetail(t) {
        const done = t.status.toLowerCase() === "done";
        const body = el("div", {},
            detailRow("Status", statusBadge(t.status)),
            detailRow("Title", el("span", { text: t.title })),
            detailRow("Due date", el("span", { text: t.dueDate || "—" })),
            detailRow("Priority", priorityBadge(t.priority)),
            detailRow("Tags", tagChips(t.tags)),
            detailRow("Context", el("span", { class: "markdown-body", text: t.context || "—" })));
        const foot = [
            el("button", { class: "btn btn-danger", text: "Delete", onclick: () => { closeModal(); removeTask(t); } }),
            el("span", { class: "spacer", style: "flex:1" }),
            el("button", { class: "btn", text: "Edit", onclick: () => taskModal(t) }),
            !done ? el("button", { class: "btn btn-primary", text: "Complete", onclick: async () => { try { await api(`/api/tasks/${t.id}/complete`, { method: "POST" }); toast("Completed", t.title, "ok"); closeModal(); await refreshSummary(); go("tasks"); } catch (e) { toast("Error", e.message, "err"); } } }) : null,
        ];
        openModal({ title: `Task #${t.id}`, body, foot });
    }

    // ---------- Journal ----------
    VIEWS.journal = async (root) => {
        const { entries } = await api("/api/journal");
        root.innerHTML = "";
        root.append(el("div", { class: "toolbar" },
            el("button", { class: "btn btn-primary", html: "＋ Add entry", onclick: () => journalModal() }),
            el("span", { class: "spacer" }),
            el("span", { class: "muted small", text: `${entries.length} entr${entries.length === 1 ? "y" : "ies"}` })));
        if (!entries.length) { root.append(emptyState("✎", "No journal entries", "Capture decisions and notes as they happen.", el("button", { class: "btn btn-primary", html: "＋ Add entry", onclick: () => journalModal() }))); return; }
        const list = el("div", { class: "journal-list" });
        entries.forEach((e) => list.append(el("div", { class: "journal-entry" },
            el("div", { class: "date" }, "📅 ", e.date),
            el("div", { class: "body", text: e.text }))));
        root.append(list);
    };

    function journalModal() {
        const f = {};
        const body = el("div", { class: "form" }, field("Entry", f, "text", { placeholder: "What happened today?", area: true, required: true }));
        const save = el("button", { class: "btn btn-primary", text: "Add entry", onclick: async () => {
            const text = f.text.value.trim();
            if (!text) { toast("Entry required", "", "err"); return; }
            try { await api("/api/journal", { method: "POST", body: { text } }); toast("Journal saved", todayISO(), "ok"); closeModal(); await refreshSummary(); if (state.view === "journal") go("journal"); }
            catch (e) { toast("Error", e.message, "err"); }
        } });
        openModal({ title: "New journal entry", body, foot: [el("button", { class: "btn", text: "Cancel", onclick: closeModal }), save] });
        setTimeout(() => f.text.focus(), 50);
    }

    // ---------- Milestones ----------
    VIEWS.milestones = async (root) => {
        const { milestones } = await api("/api/milestones");
        root.innerHTML = "";
        root.append(el("div", { class: "toolbar" },
            el("button", { class: "btn btn-primary", html: "＋ Add milestone", onclick: () => milestoneModal() }),
            el("span", { class: "spacer" }),
            el("span", { class: "muted small", text: `${milestones.length} milestone${milestones.length === 1 ? "" : "s"}` })));
        if (!milestones.length) { root.append(emptyState("⚑", "No milestones", "Set goals with target dates and track them to done.", el("button", { class: "btn btn-primary", html: "＋ Add milestone", onclick: () => milestoneModal() }))); return; }
        const tbody = el("tbody");
        milestones.forEach((m) => {
            const sel = el("select", { class: "inline-edit", style: "width:auto", onchange: async (e) => { try { await api(`/api/milestones/${m.id}`, { method: "PUT", body: { status: e.target.value } }); toast("Status updated", m.name, "ok"); await refreshSummary(); } catch (err) { toast("Error", err.message, "err"); } } });
            ["Planned", "In Progress", "Done"].forEach((o) => { const opt = el("option", { value: o, text: o }); if ((m.status || "Planned") === o) opt.selected = true; sel.append(opt); });
            tbody.append(el("tr", { dataset: { taskTitle: m.name } },
                el("td", {}, el("span", { class: "cell-title", text: m.name, onclick: () => noteLikeDetail(`Milestone #${m.id}`, [["Name", m.name], ["Target date", m.targetDate || "—"], ["Status", m.status || "Planned"], ["Notes", m.notes || "—"]]) })),
                el("td", {}, m.targetDate ? el("span", { class: dueClass(m.targetDate, (m.status || "").toLowerCase() === "done"), text: m.targetDate }) : el("span", { class: "muted small", text: "—" })),
                el("td", {}, sel),
                el("td", {}, el("span", { class: "muted small", text: m.notes || "—" }))));
        });
        root.append(el("div", { class: "table-wrap" }, el("table", { class: "tbl" },
            el("thead", {}, el("tr", {}, el("th", { text: "Milestone" }), el("th", { text: "Target" }), el("th", { text: "Status" }), el("th", { text: "Notes" }))),
            tbody)));
    };

    function milestoneModal() {
        const f = {};
        const body = el("div", { class: "form" },
            field("Name", f, "name", { placeholder: "Milestone name", required: true }),
            el("div", { class: "form-row" },
                field("Target date", f, "targetDate", { type: "date" }),
                selectField("Status", f, "status", ["Planned", "In Progress", "Done"], "Planned")),
            field("Notes", f, "notes", { placeholder: "Optional notes", area: true }));
        const save = el("button", { class: "btn btn-primary", text: "Add milestone", onclick: async () => {
            const name = f.name.value.trim();
            if (!name) { toast("Name required", "", "err"); return; }
            try { await api("/api/milestones", { method: "POST", body: { name, targetDate: f.targetDate.value, status: f.status.value, notes: f.notes.value.trim() } }); toast("Milestone added", name, "ok"); closeModal(); await refreshSummary(); if (state.view === "milestones") go("milestones"); }
            catch (e) { toast("Error", e.message, "err"); }
        } });
        openModal({ title: "New milestone", body, foot: [el("button", { class: "btn", text: "Cancel", onclick: closeModal }), save] });
        setTimeout(() => f.name.focus(), 50);
    }

    // ---------- Memos ----------
    VIEWS.memos = async (root) => {
        const { memos } = await api("/api/memos");
        root.innerHTML = "";
        root.append(el("div", { class: "toolbar" },
            el("button", { class: "btn btn-primary", html: "＋ New memo", onclick: () => memoModal() }),
            el("span", { class: "spacer" }),
            el("span", { class: "muted small", text: `${memos.length} memo${memos.length === 1 ? "" : "s"}` })));
        if (!memos.length) { root.append(emptyState("▤", "No memos", "Create handoff notes, retros and summaries as markdown.", el("button", { class: "btn btn-primary", html: "＋ New memo", onclick: () => memoModal() }))); return; }
        const grid = el("div", { class: "grid note-grid" });
        memos.forEach((m) => grid.append(el("div", { class: "card note-card hoverable", onclick: () => memoDetail(m.filename) },
            el("h4", { text: m.title }),
            el("div", { class: "note-foot" }, el("span", { class: "tag", text: m.date || "" }), el("span", { class: "muted small", text: "📄 memo" })))));
        root.append(grid);
    };

    async function memoDetail(filename) {
        try {
            const { memo } = await api(`/api/memos/${encodeURIComponent(filename)}`);
            openModal({ title: memo.title, width: 680, body: el("div", { class: "markdown-body", text: memo.content || "(empty)" }),
                foot: [el("button", { class: "btn", text: "Close", onclick: closeModal })] });
        } catch (e) { toast("Error", e.message, "err"); }
    }

    function memoModal() {
        const f = {};
        const body = el("div", { class: "form" },
            field("Title", f, "title", { placeholder: "Memo title", required: true }),
            field("Content", f, "content", { placeholder: "Markdown content…", area: true }));
        const save = el("button", { class: "btn btn-primary", text: "Create memo", onclick: async () => {
            const title = f.title.value.trim();
            if (!title) { toast("Title required", "", "err"); return; }
            try { await api("/api/memos", { method: "POST", body: { title, content: f.content.value } }); toast("Memo created", title, "ok"); closeModal(); await refreshSummary(); if (state.view === "memos") go("memos"); }
            catch (e) { toast("Error", e.message, "err"); }
        } });
        openModal({ title: "New memo", body, foot: [el("button", { class: "btn", text: "Cancel", onclick: closeModal }), save] });
        setTimeout(() => f.title.focus(), 50);
    }

    // ---------- Domain notes: learning / growth / projects ----------
    const DOMAIN_META = {
        learning: { icon: "🎓", fields: [["goal", "Goal"], ["target_date", "Target date", "date"], ["next_review", "Next review", "date"], ["status", "Status"]] },
        growth: { icon: "↗", fields: [["area", "Area"], ["impact", "Impact"]] },
        projects: { icon: "❏", fields: [["status", "Status"], ["owner", "Owner"], ["due", "Due", "date"]] },
    };
    for (const domain of ["learning", "growth", "projects"]) {
        VIEWS[domain] = async (root) => {
            const { notes } = await api(`/api/${domain}`);
            root.innerHTML = "";
            root.append(el("div", { class: "toolbar" },
                el("button", { class: "btn btn-primary", html: `＋ New ${domain === "projects" ? "project" : domain === "growth" ? "entry" : "topic"}`, onclick: () => noteModal(domain) }),
                el("span", { class: "spacer" }),
                el("span", { class: "muted small", text: `${notes.length} item${notes.length === 1 ? "" : "s"}` })));
            if (!notes.length) { root.append(emptyState(DOMAIN_META[domain].icon, `No ${domain} notes`, "Add your first note — it's saved with frontmatter for Obsidian Dataview.", el("button", { class: "btn btn-primary", html: "＋ Add", onclick: () => noteModal(domain) }))); return; }
            const grid = el("div", { class: "grid note-grid" });
            notes.forEach((n) => {
                const fm = n.frontmatter || {};
                grid.append(el("div", { class: "card note-card hoverable", onclick: () => domainNoteDetail(domain, n.filename) },
                    el("h4", { text: fm.title || n.filename }),
                    domainChips(domain, fm),
                    el("div", { class: "note-foot" }, el("span", { class: "tag", text: fm.date || "" }))));
            });
            root.append(grid);
        };
    }

    function domainChips(domain, fm) {
        const chips = el("div", { class: "tags" });
        if (fm.status) chips.append(statusBadge(fm.status));
        if (fm.area) chips.append(el("span", { class: "tag", text: fm.area }));
        if (fm.owner) chips.append(el("span", { class: "tag", text: "👤 " + fm.owner }));
        if (fm.goal) chips.append(el("span", { class: "muted small", text: fm.goal }));
        if (fm.impact) chips.append(el("span", { class: "muted small", text: fm.impact }));
        return chips;
    }

    async function domainNoteDetail(domain, filename) {
        try {
            const { note } = await api(`/api/${domain}/${encodeURIComponent(filename)}`);
            const fm = note.frontmatter || {};
            const rows = Object.entries(fm).filter(([k]) => k !== "catpilot").map(([k, v]) => [k, Array.isArray(v) ? v.join(", ") : v]);
            const body = el("div", {},
                ...rows.map(([k, v]) => detailRow(k, el("span", { text: String(v) }))),
                note.body ? el("div", { style: "margin-top:14px" }, el("div", { class: "detail-row" }, el("span", { class: "k", text: "Notes" })), el("div", { class: "markdown-body", text: note.body })) : null);
            openModal({ title: fm.title || filename, width: 640, body, foot: [el("button", { class: "btn", text: "Close", onclick: closeModal })] });
        } catch (e) { toast("Error", e.message, "err"); }
    }

    function noteModal(domain) {
        const meta = DOMAIN_META[domain];
        const f = {};
        const rows = meta.fields.map(([key, label, type]) => field(label, f, key, { type: type || "text" }));
        const body = el("div", { class: "form" },
            field("Title", f, "title", { required: true, placeholder: "Title" }),
            el("div", { class: "form-row" }, rows),
            field("Body", f, "body", { area: true, placeholder: "Markdown notes…" }));
        const save = el("button", { class: "btn btn-primary", text: "Save", onclick: async () => {
            const title = f.title.value.trim();
            if (!title) { toast("Title required", "", "err"); return; }
            const payload = { title, body: f.body.value };
            meta.fields.forEach(([key]) => { if (f[key].value.trim()) payload[key] = f[key].value.trim(); });
            try { await api(`/api/${domain}`, { method: "POST", body: payload }); toast("Saved", title, "ok"); closeModal(); await refreshSummary(); if (state.view === domain) go(domain); }
            catch (e) { toast("Error", e.message, "err"); }
        } });
        openModal({ title: `New ${domain} note`, body, foot: [el("button", { class: "btn", text: "Cancel", onclick: closeModal }), save] });
        setTimeout(() => f.title.focus(), 50);
    }

    // ---------------------------------------------------------------- fields
    function field(label, store, key, opts = {}) {
        const input = opts.area
            ? el("textarea", { placeholder: opts.placeholder || "" })
            : el("input", { type: opts.type || "text", placeholder: opts.placeholder || "" });
        if (opts.value) input.value = opts.value;
        store[key] = input;
        return el("label", {}, el("span", {}, label, opts.required ? el("em", { text: " *" }) : null), input);
    }
    function selectField(label, store, key, options, value) {
        const sel = el("select", {});
        options.forEach((o) => { const opt = el("option", { value: o, text: o || "—" }); if (o === value) opt.selected = true; sel.append(opt); });
        store[key] = sel;
        return el("label", {}, el("span", { text: label }), sel);
    }
    function detailRow(k, valueNode) {
        return el("div", { class: "detail-row" }, el("span", { class: "k", text: k }), el("div", {}, valueNode));
    }
    function noteLikeDetail(title, rows) {
        openModal({ title, body: el("div", {}, rows.map(([k, v]) => detailRow(k, el("span", { text: String(v) })))), foot: [el("button", { class: "btn", text: "Close", onclick: closeModal })] });
    }

    // ---------------------------------------------------------------- boot
    async function boot() {
        applyTheme();
        $("#theme-btn").addEventListener("click", toggleTheme);
        $("#refresh-btn").addEventListener("click", async () => { await refreshSummary(); go(state.view); toast("Refreshed", "", "ok"); });

        const status = await api("/api/status").catch(() => ({ configured: false }));
        if (!status.configured) { showOnboarding(); return; }
        startApp();
    }

    function showOnboarding() {
        $("#onboarding").classList.remove("hidden");
        $("#app").classList.add("hidden");
        $("#setup-form").addEventListener("submit", async (e) => {
            e.preventDefault();
            const fd = new FormData(e.target);
            const payload = { root: fd.get("root"), partitioning: fd.get("partitioning"), migration: fd.get("migration") };
            if (!payload.root.trim()) { toast("Path required", "", "err"); return; }
            try {
                await api("/api/setup", { method: "POST", body: payload });
                toast("Workspace ready!", "CatPilot is set up", "ok");
                $("#onboarding").classList.add("hidden");
                startApp();
            } catch (err) { toast("Setup failed", err.message, "err"); }
        }, { once: false });
    }

    async function startApp() {
        $("#app").classList.remove("hidden");
        await refreshSummary();
        const initial = (location.hash || "").replace("#", "");
        go(NAV.some((n) => n.id === initial) ? initial : "dashboard");
    }

    window.addEventListener("hashchange", () => {
        const v = (location.hash || "").replace("#", "");
        if (v && v !== state.view && NAV.some((n) => n.id === v)) go(v);
    });

    boot();
})();
