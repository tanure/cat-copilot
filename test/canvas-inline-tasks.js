// Exercise the actual SPA handlers with DOM/API doubles; no browser dependency.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../.github/extensions/catpilot-canvas/ui/app.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
function functionSource(name) {
    const match = source.match(new RegExp(`    (?:async )?function ${name}\\(`));
    assert.ok(match, `${name} exists`);
    const end = source.indexOf("\n    }", match.index);
    assert.ok(end > match.index, `${name} has a closing brace`);
    return source.slice(match.index, end + 6);
}

class Node {
    constructor(tag, doc) {
        this.tagName = tag;
        this.doc = doc;
        this.nodeType = 1;
        this.children = [];
        this.dataset = {};
        this.attrs = {};
        this.style = {};
        this.listeners = {};
        this.className = "";
        this.value = "";
        this.validity = { badInput: false };
        this.scrollTop = this.scrollLeft = 0;
        this.classList = {
            contains: (name) => this.className.split(" ").includes(name),
            toggle: (name, on) => {
                const classes = new Set(this.className.split(" ").filter(Boolean));
                if (on ?? !classes.has(name)) classes.add(name); else classes.delete(name);
                this.className = [...classes].join(" ");
            },
            add: (name) => this.classList.toggle(name, true),
            remove: (name) => this.classList.toggle(name, false),
        };
    }
    get childNodes() { return this.children; }
    setAttribute(key, value) {
        this.attrs[key] = String(value);
        if (["id", "value", "type"].includes(key)) this[key] = String(value);
        if (key === "disabled") this.disabled = true;
        if (key === "checked") this.checked = true;
        if (key === "draggable") this.draggable = value === "true";
    }
    removeAttribute(key) { delete this.attrs[key]; }
    append(...nodes) {
        for (const node of nodes) { node.remove(); node.parentElement = this; this.children.push(node); }
    }
    remove() {
        if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((n) => n !== this);
        this.parentElement = null;
    }
    replaceWith(node) {
        const parent = this.parentElement;
        const index = parent.children.indexOf(this);
        this.remove();
        node.parentElement = parent;
        parent.children.splice(index, 0, node);
    }
    replaceChildren(...nodes) { this.children.slice().forEach((node) => node.remove()); this.append(...nodes); }
    matches(selector) {
        if (selector.startsWith(".")) return this.classList.contains(selector.slice(1));
        if (selector.startsWith("#")) return this.id === selector.slice(1);
        const attr = selector.match(/^\[data-([\w-]+)(?:="([^"]+)")?\]$/);
        if (attr) {
            const key = attr[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase());
            return this.dataset[key] !== undefined && (attr[2] === undefined || this.dataset[key] === attr[2]);
        }
        return this.tagName === selector;
    }
    closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) || null; }
    querySelectorAll(selector) {
        const matches = (node, part) => {
            const pieces = part.trim().split(" ");
            return pieces.length === 1 ? node.matches(part.trim())
                : node.matches(pieces[1]) && !!node.parentElement?.closest(pieces[0]);
        };
        return this.children.flatMap((node) => [
            ...(selector.split(",").some((part) => matches(node, part)) ? [node] : []),
            ...node.querySelectorAll(selector),
        ]);
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
    async fire(type, extra = {}) {
        const event = { target: this, currentTarget: this, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }, ...extra };
        for (const fn of this.listeners[type] || []) await fn(event);
        return event;
    }
    focus() { this.doc.activeElement = this; }
}

function harness() {
    const document = {};
    document.body = new Node("body", document);
    document.activeElement = document.body;
    document.createElement = (tag) => new Node(tag, document);
    document.createTextNode = (text) => Object.assign(new Node("#text", document), { textContent: text });
    document.querySelectorAll = (sel) => document.body.querySelectorAll(sel);
    document.querySelector = (sel) => document.body.querySelector(sel);
    const content = document.createElement("div"); content.id = "content";
    const actions = document.createElement("div"); actions.id = "view-actions";
    document.body.append(content, actions);
    const calls = [], notices = [];
    const context = vm.createContext({
        document, console, Set, Date,
        $: (sel) => document.querySelector(sel),
        state: { view: "tasks" }, navToken: 1,
        taskCurrentPeriod: "2026/2026-09", taskPeriod: null, taskSearch: "",
        VIEWS: { tasks: async (stage) => { stage.append(document.createElement("section")); } },
        refreshSummary: async () => {},
        api: async (url, request) => {
            calls.push({ url, request });
            return { task: { ...task(), ...request.body } };
        },
        toast: (...args) => notices.push(args),
        todayISO: () => "2026-09-07",
        pq: (t) => `?period=${encodeURIComponent(t.period)}`,
        applyDueFilter: (tasks) => tasks,
        periodLabelOf: (period) => period,
        priorityRank: () => 0, PR_COLORS: ["red"],
        priorityBadge: () => document.createElement("span"),
        quadrantBadge: () => document.createElement("span"),
        tagChips: () => document.createElement("span"),
        taskModal: () => {}, taskDetail: () => {}, removeTask: () => {},
    });
    for (const name of ["el", "statusClass", "statusBadge", "dueClass", "filterTasks", "taskRow", "boardCard"]) {
        vm.runInContext(functionSource(name), context);
    }
    const boardStart = source.indexOf("    const BOARD_COLS =");
    vm.runInContext(source.slice(boardStart, source.indexOf("\n\n", boardStart)), context);
    const start = source.indexOf("    // Inline task editing");
    const end = source.indexOf("    // Apply the active due-date filter.", start);
    assert.ok(start >= 0 && end > start, "inline handler section found");
    vm.runInContext(source.slice(start, end), context);
    return { context, document, content, calls, notices,
        pending: vm.runInContext("pendingTaskEdits", context) };
}
function task(extra = {}) {
    return { id: 7, period: "2026/2026-09", title: "Inline task", status: "Open", dueDate: "", ...extra };
}
function mount(h, t = task(), board = false) {
    const row = board ? h.context.boardCard(t) : h.context.taskRow(t);
    h.content.append(row);
    return { row, date: row.querySelector(".task-inline-date"), status: row.querySelector(".task-inline-status"),
        feedback: row.querySelector(".task-inline-date").closest(".task-inline-editor").querySelector(".task-inline-feedback") };
}
const tests = [];
const test = (label, fn) => tests.push({ label, fn });

test("List exposes four statuses, date and accessible clear control", () => {
    const h = harness(); const { status, date, row } = mount(h);
    assert.deepEqual(status.children.map((n) => n.value), ["Open", "In Progress", "Blocked", "Done"]);
    assert.equal(status.children[0].textContent, "To do");
    assert.equal(date.attrs["aria-label"], "Due date for Inline task");
    assert.equal(row.querySelector(".task-inline-clear").disabled, true);
});
test("Board exposes date only and keeps completed tasks editable", () => {
    const h = harness(); const { row, date, status } = mount(h, task({ status: "Done" }), true);
    assert.equal(status, null); assert.equal(date.disabled, false); assert.equal(row.draggable, true);
});
test("Editor interaction is isolated from card dragging", async () => {
    const h = harness(); const { row, date } = mount(h, task(), true);
    await row.fire("pointerdown", { target: date }); assert.equal(row.draggable, false);
    const editor = date.closest(".task-inline-editor");
    assert.equal((await editor.fire("click")).stopped, true);
    assert.equal((await editor.fire("dragstart")).prevented, true);
    await row.fire("pointerdown"); assert.equal(row.draggable, true);
    let dragged;
    await row.fire("dragstart", { dataTransfer: { setData: (_, value) => { dragged = value; } } });
    assert.equal(dragged, "7");
});
test("Only the changed field and original task period are sent", async () => {
    const h = harness(); const t = task({ period: "2026/2026-08" }); h.context.taskPeriod = t.period;
    const { date, feedback } = mount(h, t);
    h.context.api = async (url, request) => { h.calls.push({ url, request }); return { task: { ...t, ...request.body } }; };
    await h.context.saveInlineTask(t, "dueDate", "2026-08-22", date, feedback);
    assert.equal(h.calls[0].url, "/api/tasks/7?period=2026%2F2026-08");
    assert.equal(JSON.stringify(h.calls[0].request.body), '{"dueDate":"2026-08-22"}');
});
test("Status changes and clearing a date use partial patches", async () => {
    const h = harness(); const t = task({ dueDate: "2026-09-20" });
    h.context.api = async (url, request) => { h.calls.push({ url, request }); return { task: { ...t, ...request.body } }; };
    let fields = mount(h, t);
    await h.context.saveInlineTask(t, "status", "Blocked", fields.status, fields.feedback);
    assert.equal(JSON.stringify(h.calls[0].request.body), '{"status":"Blocked"}');
    fields = mount(h, t);
    await h.context.saveInlineTask(t, "dueDate", "", fields.date, fields.feedback);
    assert.equal(JSON.stringify(h.calls[1].request.body), '{"dueDate":""}');
});
test("Unchanged, cancelled and invalid values never write", async () => {
    const h = harness(); const t = task({ dueDate: "2026-09-20" }); const { date, feedback } = mount(h, t);
    assert.equal(h.context.validInlineDate("2028-02-29"), true);
    for (const value of [t.dueDate, "2026-02-30", "bad-date", "0000-01-01"]) {
        await h.context.saveInlineTask(t, "dueDate", value, date, feedback);
    }
    date.validity.badInput = true;
    await h.context.saveInlineTask(t, "dueDate", "", date, feedback);
    assert.equal(h.calls.length, 0);
    assert.equal(date.value, t.dueDate);
    assert.ok(h.notices.some((n) => n[0] === "Invalid task value"));
});
test("Pending saves lock all same-task actions but not same ID in another period", async () => {
    const h = harness(); const t = task(); const { row, date, feedback } = mount(h, t);
    const other = mount(h, task({ period: "2026/2026-08" }));
    let resolve;
    h.context.api = () => new Promise((r) => { resolve = r; });
    const saving = h.context.saveInlineTask(t, "dueDate", "2026-09-20", date, feedback);
    assert.ok(row.querySelectorAll("input, select, button").every((n) => n.disabled));
    assert.equal(other.date.disabled, false);
    assert.equal(await h.context.saveInlineTask(t, "status", "Done", date, feedback), false);
    assert.equal(h.context.taskEditBlocked(t), true);
    resolve({ task: { ...t, dueDate: "2026-09-20" } }); await saving;
    assert.equal(h.pending.size, 0);
});
test("Failed writes restore value, unlock controls and surface an error", async () => {
    const h = harness(); const t = task({ dueDate: "2026-09-20" }); const { date, feedback } = mount(h, t);
    h.context.api = async () => { throw new Error("disk full"); };
    date.value = "2026-09-25";
    assert.equal(await h.context.saveInlineTask(t, "dueDate", date.value, date, feedback), false);
    assert.equal(date.value, t.dueDate); assert.equal(date.disabled, false);
    assert.match(feedback.textContent, /disk full/);
    assert.ok(h.notices.some((n) => n[0] === "Could not save task"));
});
test("Refresh failures do not roll back saved values or stale moved IDs", async () => {
    const h = harness(); const t = task(); const { date, feedback } = mount(h, t);
    h.context.api = async () => ({ task: { ...t, id: 19, period: "2026/2026-10", dueDate: "2026-10-20", movedFrom: t.period } });
    h.context.VIEWS.tasks = async () => { throw new Error("read unavailable"); };
    assert.equal(await h.context.saveInlineTask(t, "dueDate", "2026-10-20", date, feedback), true);
    assert.equal(t.id, 19); assert.equal(t.period, "2026/2026-10");
    assert.equal(h.document.querySelectorAll("[data-task-key]").length, 0);
    assert.ok(h.notices.some((n) => n[0] === "Rescheduled"));
    assert.ok(h.notices.some((n) => n[0] === "Task saved; refresh failed"));
});
test("Late saves never navigate away from the user's new page", async () => {
    const h = harness(); const t = task(); const { date, feedback } = mount(h, t);
    let resolve, renders = 0;
    h.context.api = () => new Promise((r) => { resolve = r; });
    h.context.VIEWS.tasks = async () => { renders++; };
    const saving = h.context.saveInlineTask(t, "dueDate", "2026-09-20", date, feedback);
    h.context.navToken++; h.context.state.view = "projects";
    resolve({ task: { ...t, dueDate: "2026-09-20" } }); await saving;
    assert.equal(renders, 0); assert.equal(h.context.state.view, "projects");
});
test("Refresh retains search, scroll and focus on the updated field", async () => {
    const h = harness(); const t = task();
    h.context.taskSearch = "inline";
    const { date } = mount(h, t); date.focus(); h.content.scrollTop = 120;
    h.context.VIEWS.tasks = async (stage) => { stage.append(h.context.taskRow(t), h.context.taskRow(task({ id: 8, title: "Other" }))); };
    await h.context.refreshInlineTasks(1);
    assert.equal(h.content.scrollTop, 120);
    assert.equal(h.document.activeElement.dataset.inlineField, "dueDate");
    assert.equal(h.document.querySelectorAll("[data-task-key]")[1].style.display, "none");
    assert.equal(h.context.taskSearch, "inline");
});
test("An older refresh cannot overwrite a newer task view", async () => {
    const h = harness(); let finish;
    h.context.VIEWS.tasks = async (stage) => { await new Promise((r) => { finish = r; }); stage.append(h.context.taskRow(task())); };
    const refresh = h.context.refreshInlineTasks(1);
    h.context.navToken++; h.content.replaceChildren(h.document.createElement("aside"));
    finish(); await refresh;
    assert.equal(h.content.children[0].tagName, "aside");
});
test("A newer inline refresh wins even when an older read finishes last", async () => {
    const h = harness(); let finishOld;
    h.context.VIEWS.tasks = async (stage) => { await new Promise((r) => { finishOld = r; }); stage.append(h.context.taskRow(task({ title: "Stale" }))); };
    const older = h.context.refreshInlineTasks(1);
    h.context.VIEWS.tasks = async (stage) => { stage.append(h.context.taskRow(task({ title: "Fresh" }))); };
    await h.context.refreshInlineTasks(1);
    finishOld(); await older;
    assert.equal(h.document.querySelector("[data-task-key]").dataset.taskTitle, "Fresh");
});
test("Search typed during refresh is retained along with focus", async () => {
    const h = harness();
    const toolbar = h.document.createElement("div"); toolbar.className = "toolbar";
    toolbar.append(h.context.taskSearchInput()); h.content.append(toolbar);
    toolbar.querySelector(".search").focus();
    let finish;
    h.context.VIEWS.tasks = async (stage) => {
        const newToolbar = h.document.createElement("div"); newToolbar.className = "toolbar";
        newToolbar.append(h.context.taskSearchInput()); stage.append(newToolbar);
        await new Promise((r) => { finish = r; });
    };
    const refresh = h.context.refreshInlineTasks(1);
    h.context.taskSearch = "typed while saving";
    finish(); await refresh;
    assert.equal(h.document.activeElement.className, "search");
    assert.equal(h.document.activeElement.value, "typed while saving");
});
test("A due-filter disappearance is explained after saving", async () => {
    const h = harness(); const t = task(); const { date, feedback } = mount(h, t);
    h.context.applyDueFilter = () => [];
    await h.context.saveInlineTask(t, "dueDate", "2026-09-20", date, feedback);
    assert.ok(h.notices.some((n) => n[1].includes("outside the current due-date filter")));
});

for (const { label, fn } of tests) {
    await fn();
    console.log(`PASS ${label}`);
}
console.log(`${tests.length} inline task tests passed`);
