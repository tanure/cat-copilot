/**
 * CatPilot — SMART tasks + Eisenhower Matrix core.
 *
 * Single source of truth for:
 *   - normalizing the optional `importance` / `urgency` axes,
 *   - deriving them when the user has not set them explicitly,
 *   - classifying a task into an Eisenhower quadrant (with a human rationale),
 *   - scoring how "SMART" a task is and reporting what is missing,
 *   - ranking tasks into a focus order.
 *
 * Nothing here writes to disk: it operates on the task objects produced by
 * `lib/cli-utils.js` (`{ id, status, title, dueDate, priority, tags, context,
 * project, smart }`). The canvas ships an ESM mirror of this file inside
 * `.github/extensions/catpilot-canvas/catpilot-store.mjs` — keep both in sync.
 */

// How many days ahead still counts as "urgent" when no explicit urgency is set.
export const URGENT_WINDOW_DAYS = 3;
// How many days ahead the matrix/focus views treat as the "soon" bucket.
export const SOON_WINDOW_DAYS = 7;

/** The four quadrants, in reading order (matches the canvas layout). */
export const QUADRANTS = [
  { key: 'q1', short: 'Q1', label: 'Urgent & Important', action: 'Do now', important: true, urgent: true, icon: '🔥', accent: '#ff6b7d' },
  { key: 'q2', short: 'Q2', label: 'Not Urgent & Important', action: 'Schedule', important: true, urgent: false, icon: '🗓️', accent: '#ffb020' },
  { key: 'q3', short: 'Q3', label: 'Urgent & Not Important', action: 'Delegate or batch', important: false, urgent: true, icon: '🤝', accent: '#5aa9ff' },
  { key: 'q4', short: 'Q4', label: 'Not Urgent & Not Important', action: 'Drop or do later', important: false, urgent: false, icon: '🧊', accent: '#35c88f' }
];

/** The five SMART dimensions, in order. */
export const SMART_DIMENSIONS = [
  { key: 'specific', letter: 'S', label: 'Specific', field: 'goal', question: 'What exactly does "done" look like?', example: 'Ship the v2 export endpoint behind a feature flag' },
  { key: 'measurable', letter: 'M', label: 'Measurable', field: 'measure', question: 'How will you know it worked?', example: 'p95 under 300ms and all export tests green' },
  { key: 'achievable', letter: 'A', label: 'Achievable', field: 'steps', question: 'What are the first concrete steps?', example: 'Draft schema → implement → test → roll out' },
  { key: 'relevant', letter: 'R', label: 'Relevant', field: 'why', question: 'Why does this matter right now?', example: 'Unblocks the Q3 reporting milestone' },
  { key: 'timeBound', letter: 'T', label: 'Time-bound', field: 'dueDate', question: 'When does it need to be done?', example: '2026-08-14' }
];

/** Field names stored inside the `## Task Details` section. */
export const SMART_FIELDS = ['goal', 'measure', 'why', 'steps', 'importance', 'urgency'];

export const AXIS_VALUES = ['High', 'Low'];

// -----------------------------------------------------------------------------
// Small date helpers (local time — the stored dates are plain YYYY-MM-DD)
// -----------------------------------------------------------------------------

export function pad2(n) { return String(n).padStart(2, '0'); }

/** Today as YYYY-MM-DD in local time. */
export function todayISO(now = new Date()) {
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

/** Whole days from today to `iso` (negative = in the past). null when unparseable. */
export function daysUntil(iso, now = new Date()) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(String(iso).trim())) return null;
  const [y, m, d] = String(iso).trim().slice(0, 10).split('-').map(Number);
  const target = new Date(y, m - 1, d);
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target - start) / 86400000);
}

// -----------------------------------------------------------------------------
// Normalization
// -----------------------------------------------------------------------------

/**
 * Normalize a free-form importance/urgency value to 'High' | 'Low' | ''.
 * Accepts yes/no, true/false, 1/0, high/medium/low, important/not-important…
 * Anything unrecognised becomes '' (meaning "let CatPilot derive it").
 * @param {*} value
 * @returns {string}
 */
export function normalizeAxis(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'boolean') return value ? 'High' : 'Low';
  if (typeof value === 'number') return value > 0 ? 'High' : 'Low';
  const v = String(value).trim().toLowerCase();
  if (!v || v === '-' || v === '—' || v === 'auto') return '';
  if (['high', 'h', 'yes', 'y', 'true', '1', 'urgent', 'important', 'critical', 'top', 'medium', 'med', 'm'].includes(v)) return 'High';
  if (['low', 'l', 'no', 'n', 'false', '0', 'none', 'not urgent', 'not important', 'later'].includes(v)) return 'Low';
  return '';
}

/** Normalize a priority string to a rank: 0 = P0/High … 3 = P3/Low, 99 = unset. */
export function priorityRank(priority) {
  const p = String(priority || '').trim().toLowerCase();
  if (!p) return 99;
  if (p === 'p0' || p === 'urgent' || p === 'critical') return 0;
  if (p === 'p1' || p === 'high') return 1;
  if (p === 'p2' || p === 'med' || p === 'medium') return 2;
  if (p === 'p3' || p === 'low') return 3;
  return 99;
}

/**
 * Coerce any partial SMART payload into the canonical stored shape.
 * @param {object} [smart]
 * @returns {{goal:string,measure:string,why:string,steps:string,importance:string,urgency:string}}
 */
export function normalizeSmart(smart = {}) {
  const s = smart || {};
  return {
    goal: String(s.goal || '').trim(),
    measure: String(s.measure || '').trim(),
    why: String(s.why || '').trim(),
    steps: String(s.steps || '').trim(),
    importance: normalizeAxis(s.importance),
    urgency: normalizeAxis(s.urgency)
  };
}

/** True when a SMART object carries no information at all. */
export function isSmartEmpty(smart) {
  const s = normalizeSmart(smart);
  return SMART_FIELDS.every((k) => !s[k]);
}

// -----------------------------------------------------------------------------
// Derivation + classification
// -----------------------------------------------------------------------------

/**
 * Decide whether a task is urgent.
 * Explicit `smart.urgency` always wins; otherwise urgency comes from how close
 * the deadline is and how high the priority is.
 * @param {object} task
 * @param {Date} [now]
 * @returns {{urgent:boolean, source:'explicit'|'derived', reason:string}}
 */
export function deriveUrgency(task, now = new Date()) {
  const explicit = normalizeAxis(task && task.smart && task.smart.urgency);
  if (explicit) {
    return { urgent: explicit === 'High', source: 'explicit', reason: `urgency set to ${explicit}` };
  }
  const days = daysUntil(task && task.dueDate, now);
  const rank = priorityRank(task && task.priority);
  if (days !== null && days < 0) return { urgent: true, source: 'derived', reason: `overdue by ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'}` };
  if (days === 0) return { urgent: true, source: 'derived', reason: 'due today' };
  if (days !== null && days <= URGENT_WINDOW_DAYS) return { urgent: true, source: 'derived', reason: `due in ${days} day${days === 1 ? '' : 's'}` };
  if (rank === 0) return { urgent: true, source: 'derived', reason: 'top priority (P0)' };
  if (days === null) return { urgent: false, source: 'derived', reason: 'no deadline set' };
  return { urgent: false, source: 'derived', reason: `due in ${days} days` };
}

/**
 * Decide whether a task is important.
 * Explicit `smart.importance` always wins; otherwise importance is inferred from
 * priority, project/milestone linkage and the presence of SMART intent fields.
 * @param {object} task
 * @returns {{important:boolean, source:'explicit'|'derived', reason:string}}
 */
export function deriveImportance(task) {
  const smart = normalizeSmart(task && task.smart);
  if (smart.importance) {
    return { important: smart.importance === 'High', source: 'explicit', reason: `importance set to ${smart.importance}` };
  }
  const rank = priorityRank(task && task.priority);
  const signals = [];
  if (rank <= 1) signals.push(`priority ${String(task.priority).trim()}`);
  if (String((task && task.project) || '').trim()) signals.push('linked to a project');
  if (smart.why) signals.push('has a stated why');
  if (smart.measure) signals.push('has success criteria');
  if (signals.length) return { important: true, source: 'derived', reason: signals.join(', ') };
  if (rank === 3) return { important: false, source: 'derived', reason: 'low priority' };
  return { important: false, source: 'derived', reason: 'no importance signals yet' };
}

/** Look up quadrant metadata from the two axes. */
export function quadrantFor(important, urgent) {
  return QUADRANTS.find((q) => q.important === !!important && q.urgent === !!urgent);
}

/** Look up quadrant metadata by key (q1..q4, case-insensitive). */
export function quadrantByKey(key) {
  const k = String(key || '').trim().toLowerCase();
  return QUADRANTS.find((q) => q.key === k) || null;
}

/**
 * Classify a task into an Eisenhower quadrant.
 * @param {object} task
 * @param {Date} [now]
 * @returns {{quadrant:string, short:string, label:string, action:string, icon:string, accent:string,
 *            important:boolean, urgent:boolean, source:'explicit'|'derived'|'mixed', rationale:string}}
 */
export function classifyTask(task, now = new Date()) {
  const imp = deriveImportance(task);
  const urg = deriveUrgency(task, now);
  const q = quadrantFor(imp.important, urg.urgent);
  const source = imp.source === urg.source ? imp.source : 'mixed';
  return {
    quadrant: q.key,
    short: q.short,
    label: q.label,
    action: q.action,
    icon: q.icon,
    accent: q.accent,
    important: imp.important,
    urgent: urg.urgent,
    source,
    importanceSource: imp.source,
    urgencySource: urg.source,
    rationale: `${imp.important ? 'Important' : 'Not important'} (${imp.reason}); ${urg.urgent ? 'urgent' : 'not urgent'} (${urg.reason}).`
  };
}

/** Attach `task.eisenhower` (non-destructively) and return the task. */
export function withClassification(task, now = new Date()) {
  return Object.assign({}, task, { eisenhower: classifyTask(task, now) });
}

// -----------------------------------------------------------------------------
// SMART scoring
// -----------------------------------------------------------------------------

/**
 * Score how SMART a task is (0–5) and report which dimensions are still missing.
 * A title alone never counts as "Specific" — a stated goal (or a meaty context
 * line) is what makes the outcome unambiguous.
 * @param {object} task
 * @returns {{score:number, max:number, percent:number, met:string[], missing:Array<object>, label:string}}
 */
export function smartScore(task) {
  const smart = normalizeSmart(task && task.smart);
  const has = {
    specific: !!(smart.goal || String((task && task.context) || '').trim().length >= 12),
    measurable: !!smart.measure,
    achievable: !!(smart.steps || String((task && task.project) || '').trim()),
    relevant: !!smart.why,
    timeBound: !!String((task && task.dueDate) || '').trim()
  };
  const met = SMART_DIMENSIONS.filter((d) => has[d.key]).map((d) => d.key);
  const missing = SMART_DIMENSIONS.filter((d) => !has[d.key]);
  const score = met.length;
  const label = score >= 5 ? 'Sharp' : score >= 4 ? 'Strong' : score >= 3 ? 'Decent' : score >= 1 ? 'Rough' : 'Just a title';
  return { score, max: SMART_DIMENSIONS.length, percent: Math.round((score / SMART_DIMENSIONS.length) * 100), met, missing, label };
}

/**
 * A short, friendly nudge about the most valuable missing SMART dimension.
 * @param {object} task
 * @returns {string} '' when the task is already sharp
 */
export function smartNudge(task) {
  const { missing } = smartScore(task);
  if (!missing.length) return '';
  const next = missing[0];
  return `${next.letter} · ${next.label}: ${next.question}`;
}

// -----------------------------------------------------------------------------
// Grouping + focus ranking
// -----------------------------------------------------------------------------

export const TIME_GROUPS = [
  { key: 'overdue', label: 'Overdue', icon: '⏰' },
  { key: 'today', label: 'Today', icon: '📌' },
  { key: 'next7', label: 'Next 7 days', icon: '🗓️' },
  { key: 'later', label: 'Later', icon: '🌥️' },
  { key: 'someday', label: 'No date', icon: '💭' },
  { key: 'completed', label: 'Completed', icon: '✅' }
];

/** Which time bucket a task belongs to inside a quadrant panel. */
export function timeGroup(task, now = new Date()) {
  if (String((task && task.status) || '').trim().toLowerCase() === 'done') return 'completed';
  const days = daysUntil(task && task.dueDate, now);
  if (days === null) return 'someday';
  if (days < 0) return 'overdue';
  if (days === 0) return 'today';
  if (days <= SOON_WINDOW_DAYS) return 'next7';
  return 'later';
}

/**
 * Build the full Eisenhower matrix.
 * @param {array} tasks
 * @param {{now?:Date, includeDone?:boolean}} [options]
 * @returns {{generatedAt:string, total:number, quadrants:Array<object>}}
 */
export function buildMatrix(tasks, options = {}) {
  const now = options.now || new Date();
  const includeDone = options.includeDone !== false;
  const list = (tasks || [])
    .filter((t) => includeDone || String(t.status || '').toLowerCase() !== 'done')
    .map((t) => withClassification(t, now));

  const quadrants = QUADRANTS.map((q) => {
    const items = list.filter((t) => t.eisenhower.quadrant === q.key);
    const groups = TIME_GROUPS
      .map((g) => ({ ...g, tasks: items.filter((t) => timeGroup(t, now) === g.key).sort((a, b) => compareForFocus(a, b, now)) }))
      .filter((g) => g.tasks.length);
    const openCount = items.filter((t) => String(t.status || '').toLowerCase() !== 'done').length;
    return { ...q, count: items.length, openCount, doneCount: items.length - openCount, groups, tasks: items };
  });

  return { generatedAt: todayISO(now), total: list.length, quadrants };
}

/** Sort comparator: most deserving of attention first. */
export function compareForFocus(a, b, now = new Date()) {
  const aDone = String(a.status || '').toLowerCase() === 'done';
  const bDone = String(b.status || '').toLowerCase() === 'done';
  if (aDone !== bDone) return aDone ? 1 : -1;
  const ca = a.eisenhower || classifyTask(a, now);
  const cb = b.eisenhower || classifyTask(b, now);
  const qa = QUADRANTS.findIndex((q) => q.key === ca.quadrant);
  const qb = QUADRANTS.findIndex((q) => q.key === cb.quadrant);
  if (qa !== qb) return qa - qb;
  const da = daysUntil(a.dueDate, now);
  const db = daysUntil(b.dueDate, now);
  if (da !== db) {
    if (da === null) return 1;
    if (db === null) return -1;
    return da - db;
  }
  const pa = priorityRank(a.priority);
  const pb = priorityRank(b.priority);
  if (pa !== pb) return pa - pb;
  return (a.id || 0) - (b.id || 0);
}

/** One-line explanation of why a task made the focus list. */
export function focusReason(task, now = new Date()) {
  const c = task.eisenhower || classifyTask(task, now);
  const days = daysUntil(task.dueDate, now);
  const when = days === null ? 'no deadline'
    : days < 0 ? `overdue by ${Math.abs(days)}d`
      : days === 0 ? 'due today'
        : `due in ${days}d`;
  return `${c.short} · ${c.action} — ${when}`;
}

/**
 * Rank open tasks into a "what to work on next" order.
 * @param {array} tasks
 * @param {{limit?:number, now?:Date}} [options]
 * @returns {array} tasks with `eisenhower` + `focusReason`
 */
export function focusOrder(tasks, options = {}) {
  const now = options.now || new Date();
  const open = (tasks || [])
    .filter((t) => String(t.status || '').toLowerCase() !== 'done')
    .map((t) => withClassification(t, now))
    .sort((a, b) => compareForFocus(a, b, now))
    .map((t) => Object.assign(t, { focusReason: focusReason(t, now) }));
  return options.limit ? open.slice(0, Number(options.limit)) : open;
}

/**
 * Balance stats + coaching hints for the current matrix (used by the CLI, the
 * canvas and the prioritization-coach skill).
 * @param {array} tasks
 * @param {{now?:Date}} [options]
 * @returns {{counts:object, hints:string[]}}
 */
export function matrixInsights(tasks, options = {}) {
  const now = options.now || new Date();
  const open = (tasks || []).filter((t) => String(t.status || '').toLowerCase() !== 'done');
  const counts = { q1: 0, q2: 0, q3: 0, q4: 0, total: open.length, unscored: 0, undated: 0 };
  open.forEach((t) => {
    counts[classifyTask(t, now).quadrant] += 1;
    if (smartScore(t).score <= 1) counts.unscored += 1;
    if (!String(t.dueDate || '').trim()) counts.undated += 1;
  });
  const hints = [];
  if (!counts.total) hints.push('No open tasks — a good moment to plan the week.');
  if (counts.q1 >= 5) hints.push(`${counts.q1} tasks are urgent AND important. That is firefighting territory — move what you can into Q2 by giving it a later, realistic deadline.`);
  if (counts.total && counts.q2 === 0) hints.push('Nothing sits in Q2 (Schedule). Long-term work is not getting planned — add a due date and a why to your most valuable task.');
  if (counts.q3 >= 3) hints.push(`${counts.q3} urgent-but-not-important tasks — batch, automate or delegate them.`);
  if (counts.q4 >= 5) hints.push(`${counts.q4} tasks are neither urgent nor important. Consider dropping some to protect your focus.`);
  if (counts.undated) hints.push(`${counts.undated} open task${counts.undated === 1 ? ' has' : 's have'} no due date, so urgency can only be guessed.`);
  if (counts.unscored) hints.push(`${counts.unscored} task${counts.unscored === 1 ? '' : 's'} could be sharper — add a goal, a measure or a why.`);
  return { counts, hints };
}

