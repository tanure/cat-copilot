#!/usr/bin/env node

/**
 * CatPilot Pomodoro engine.
 *
 * Because every CatPilot surface (CLI, MCP, canvas) runs as a short-lived,
 * stateless process, a running Pomodoro cannot be held in memory. Instead the
 * timer is modeled as a `startedAt` timestamp + a planned duration:
 *
 *   remaining = plannedMin*60 - (now - startedAt)
 *
 * so any surface can reconstruct the live state, and a timer survives process
 * death. State is split in two:
 *
 *   - Active session   -> a single un-partitioned JSON file at
 *                         <storage.root>/pomodoro-active.json (one timer at a
 *                         time). Un-partitioned so a session that spans a month
 *                         boundary still resolves.
 *   - Completed history -> an append-only markdown table `pomodoro.md` in the
 *                         current partition, mirroring how tasks.md works.
 */

import fs from 'fs';
import path from 'path';
import * as cliUtils from './cli-utils.js';

const TYPES = ['focus', 'short-break', 'long-break'];
const DEFAULT_MINUTES = {
  focus: 25,
  'short-break': 5,
  'long-break': 15
};

function nowISO() {
  return new Date().toISOString();
}

function normalizeType(type) {
  if (!type) return 'focus';
  const t = String(type).toLowerCase().trim();
  if (t === 'break' || t === 'short' || t === 'shortbreak' || t === 'short_break') return 'short-break';
  if (t === 'long' || t === 'longbreak' || t === 'long_break') return 'long-break';
  if (TYPES.includes(t)) return t;
  return 'focus';
}

/**
 * Default planned minutes for a type, honoring an optional `pomodoro` block in
 * config (e.g. { pomodoro: { focus: 50, "short-break": 10, "long-break": 20 } }).
 */
function defaultMinutes(type, config) {
  const t = normalizeType(type);
  const override = config && config.pomodoro && config.pomodoro[t];
  const n = parseInt(override, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MINUTES[t];
}

function readActive(config, projectRoot) {
  const activePath = cliUtils.resolvePomodoroActivePath(config, projectRoot);
  if (!fs.existsSync(activePath)) return null;
  try {
    const raw = fs.readFileSync(activePath, 'utf8');
    const data = JSON.parse(raw);
    if (!data || !data.startedAt) return null;
    return data;
  } catch {
    return null;
  }
}

function writeActive(config, projectRoot, session) {
  const activePath = cliUtils.resolvePomodoroActivePath(config, projectRoot);
  cliUtils.ensureDir(path.dirname(activePath));
  fs.writeFileSync(activePath, JSON.stringify(session, null, 2), 'utf8');
  return activePath;
}

function clearActive(config, projectRoot) {
  const activePath = cliUtils.resolvePomodoroActivePath(config, projectRoot);
  if (fs.existsSync(activePath)) fs.rmSync(activePath, { force: true });
}

/** Decorate a raw active-session record with derived live timing fields. */
function decorate(session, at = Date.now()) {
  if (!session) return null;
  const started = Date.parse(session.startedAt);
  const plannedSec = Math.round((session.plannedMin || 0) * 60);
  const elapsedSec = Math.max(0, Math.round((at - started) / 1000));
  const remainingSec = Math.max(0, plannedSec - elapsedSec);
  return {
    ...session,
    elapsedSec,
    remainingSec,
    plannedSec,
    isExpired: remainingSec === 0
  };
}

const HISTORY_HEADER = '# Pomodoro Sessions\n\n';

function loadHistory(config, projectRoot) {
  const filePath = cliUtils.resolveFilePath('pomodoro', config, projectRoot);
  const content = cliUtils.readFileOrCreate(filePath, HISTORY_HEADER + cliUtils.formatPomodoroTable([]));
  return { filePath, sessions: cliUtils.parsePomodoroTable(content) };
}

function saveHistory(filePath, sessions) {
  cliUtils.ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, HISTORY_HEADER + cliUtils.formatPomodoroTable(sessions), 'utf8');
}

/**
 * Start a new Pomodoro session.
 * @param {object} params - { minutes?, type?, task?, label?, force? }
 * @param {string} projectRoot
 */
function start(params = {}, projectRoot = process.cwd()) {
  const config = cliUtils.loadConfig(projectRoot);
  const existing = readActive(config, projectRoot);
  if (existing && !params.force) {
    const err = new Error('A Pomodoro session is already running. Complete/cancel it first, or pass force to override.');
    err.code = 'ALREADY_RUNNING';
    err.active = decorate(existing);
    throw err;
  }

  const type = normalizeType(params.type);
  const minutes = params.minutes != null && Number.isFinite(parseInt(params.minutes, 10))
    ? parseInt(params.minutes, 10)
    : defaultMinutes(type, config);
  if (!(minutes > 0)) throw new Error('minutes must be a positive number');

  const session = {
    type,
    task: params.task ? String(params.task) : '',
    label: params.label ? String(params.label) : '',
    plannedMin: minutes,
    startedAt: nowISO()
  };
  const activePath = writeActive(config, projectRoot, session);
  return { active: decorate(session), path: activePath };
}

/** Return the current active session (with live timing) or null. */
function status(projectRoot = process.cwd()) {
  const config = cliUtils.loadConfig(projectRoot);
  const active = decorate(readActive(config, projectRoot));
  const activePath = cliUtils.resolvePomodoroActivePath(config, projectRoot);
  return { active, path: activePath };
}

function appendCompleted(config, projectRoot, session, status_, notes) {
  const { filePath, sessions } = loadHistory(config, projectRoot);
  const started = Date.parse(session.startedAt);
  const endedAt = new Date();
  const actualMin = Math.max(0, Math.round(((endedAt.getTime() - started) / 1000) / 60));
  const record = {
    id: cliUtils.getNextPomodoroId(sessions),
    type: session.type,
    task: session.task || session.label || '',
    started: session.startedAt,
    ended: endedAt.toISOString(),
    plannedMin: session.plannedMin,
    actualMin,
    status: status_,
    notes: notes ? String(notes).replace(/\|/g, '/').replace(/\n/g, ' ') : ''
  };
  sessions.push(record);
  saveHistory(filePath, sessions);
  return { record, path: filePath };
}

/** Finalize the running session as completed and log it. */
function complete(params = {}, projectRoot = process.cwd()) {
  const config = cliUtils.loadConfig(projectRoot);
  const active = readActive(config, projectRoot);
  if (!active) {
    const err = new Error('No Pomodoro session is currently running.');
    err.code = 'NONE_RUNNING';
    throw err;
  }
  const result = appendCompleted(config, projectRoot, active, 'completed', params.notes);
  clearActive(config, projectRoot);
  return result;
}

/** Abandon the running session and log it as abandoned. */
function cancel(params = {}, projectRoot = process.cwd()) {
  const config = cliUtils.loadConfig(projectRoot);
  const active = readActive(config, projectRoot);
  if (!active) {
    const err = new Error('No Pomodoro session is currently running.');
    err.code = 'NONE_RUNNING';
    throw err;
  }
  const result = appendCompleted(config, projectRoot, active, 'abandoned', params.notes);
  clearActive(config, projectRoot);
  return result;
}

/** List history (newest first). */
function list(params = {}, projectRoot = process.cwd()) {
  const config = cliUtils.loadConfig(projectRoot);
  const { filePath, sessions } = loadHistory(config, projectRoot);
  const ordered = sessions.slice().reverse();
  const limit = parseInt(params.limit, 10);
  const data = Number.isFinite(limit) && limit > 0 ? ordered.slice(0, limit) : ordered;
  return { data, path: filePath, count: data.length };
}

function withinPeriod(isoDate, period) {
  if (!period || period === 'all') return true;
  const d = Date.parse(isoDate);
  if (!Number.isFinite(d)) return false;
  const now = new Date();
  if (period === 'today') {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    return d >= start;
  }
  if (period === 'week') {
    return d >= now.getTime() - 7 * 24 * 60 * 60 * 1000;
  }
  if (period === 'month') {
    return d >= now.getTime() - 30 * 24 * 60 * 60 * 1000;
  }
  return true;
}

/** Aggregate stats for a period ('today' | 'week' | 'month' | 'all'). */
function stats(params = {}, projectRoot = process.cwd()) {
  const config = cliUtils.loadConfig(projectRoot);
  const { sessions } = loadHistory(config, projectRoot);
  const period = params.period || 'all';
  const inPeriod = sessions.filter(s => withinPeriod(s.started, period));

  const completed = inPeriod.filter(s => s.status === 'completed');
  const focus = completed.filter(s => s.type === 'focus');
  const focusMinutes = focus.reduce((sum, s) => sum + (parseInt(s.actualMin, 10) || 0), 0);

  return {
    period,
    totalSessions: inPeriod.length,
    completedSessions: completed.length,
    abandonedSessions: inPeriod.length - completed.length,
    focusSessions: focus.length,
    focusMinutes
  };
}

/**
 * Resolve a named period to a {from,to} millisecond window (both inclusive-ish;
 * `to` is an exclusive upper bound). Returns {from:null,to:null} for 'all'.
 * Supported: today, this-week, last-week, this-month, last-month, last-7,
 * last-30, week, month, all.
 */
function resolvePeriodRange(period = 'all', now = new Date()) {
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const DAY = 24 * 60 * 60 * 1000;
  // ISO week starts Monday; JS getDay() has Sunday=0.
  const mondayOf = (d) => {
    const s = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const dow = (s.getDay() + 6) % 7; // 0 = Monday
    s.setDate(s.getDate() - dow);
    return s.getTime();
  };
  switch (period) {
    case 'today':
      return { from: startOfDay(now), to: startOfDay(now) + DAY };
    case 'this-week':
    case 'week': {
      const from = mondayOf(now);
      return { from, to: from + 7 * DAY };
    }
    case 'last-week': {
      const thisMon = mondayOf(now);
      return { from: thisMon - 7 * DAY, to: thisMon };
    }
    case 'this-month':
    case 'month': {
      const from = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
      const to = new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime();
      return { from, to };
    }
    case 'last-month': {
      const from = new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime();
      const to = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
      return { from, to };
    }
    case 'last-7':
      return { from: startOfDay(now) - 6 * DAY, to: startOfDay(now) + DAY };
    case 'last-30':
      return { from: startOfDay(now) - 29 * DAY, to: startOfDay(now) + DAY };
    case 'all':
    default:
      return { from: null, to: null };
  }
}

/** ISO-8601 week key (YYYY-Www) for a date. */
function isoWeekKey(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = (date.getUTCDay() + 6) % 7; // Mon=0
  date.setUTCDate(date.getUTCDate() - dayNum + 3); // nearest Thursday
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  const week = 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * 24 * 60 * 60 * 1000));
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function pad2(n) { return String(n).padStart(2, '0'); }
function localDayKey(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }

function rate(numerator, denominator) {
  return denominator > 0 ? Math.round((numerator / denominator) * 1000) / 1000 : 0;
}

function summarize(rows) {
  const completed = rows.filter(s => s.status === 'completed');
  const abandoned = rows.filter(s => s.status !== 'completed');
  const focus = rows.filter(s => s.type === 'focus');
  const completedFocus = focus.filter(s => s.status === 'completed');
  const focusMinutes = completedFocus.reduce((sum, s) => sum + (parseInt(s.actualMin, 10) || 0), 0);
  const breakMinutes = completed.filter(s => s.type !== 'focus')
    .reduce((sum, s) => sum + (parseInt(s.actualMin, 10) || 0), 0);
  return {
    totalSessions: rows.length,
    completedSessions: completed.length,
    abandonedSessions: abandoned.length,
    focusSessions: focus.length,
    completedFocusSessions: completedFocus.length,
    focusMinutes,
    breakMinutes,
    completionRate: rate(completed.length, rows.length),
    focusCompletionRate: rate(completedFocus.length, focus.length)
  };
}

/**
 * Productivity report for a period, grouped by day | week | task | session.
 * @param {object} params - { period?, groupBy? }
 */
function report(params = {}, projectRoot = process.cwd()) {
  const config = cliUtils.loadConfig(projectRoot);
  const { sessions } = loadHistory(config, projectRoot);
  const period = params.period || 'all';
  const groupBy = ['day', 'week', 'task', 'session'].includes(params.groupBy) ? params.groupBy : 'day';
  const { from, to } = resolvePeriodRange(period);

  const inPeriod = sessions.filter(s => {
    const d = Date.parse(s.started);
    if (!Number.isFinite(d)) return false;
    if (from !== null && d < from) return false;
    if (to !== null && d >= to) return false;
    return true;
  });

  const summary = { period, from: from ? new Date(from).toISOString() : null,
    to: to ? new Date(to).toISOString() : null, ...summarize(inPeriod) };

  let groups;
  if (groupBy === 'session') {
    groups = inPeriod
      .slice()
      .sort((a, b) => Date.parse(b.started) - Date.parse(a.started))
      .map(s => ({
        key: String(s.id),
        label: s.task || s.type,
        type: s.type,
        task: s.task || '',
        started: s.started,
        plannedMin: parseInt(s.plannedMin, 10) || 0,
        actualMin: parseInt(s.actualMin, 10) || 0,
        status: s.status
      }));
  } else {
    const buckets = new Map();
    for (const s of inPeriod) {
      const d = new Date(Date.parse(s.started));
      let key;
      if (groupBy === 'day') key = localDayKey(d);
      else if (groupBy === 'week') key = isoWeekKey(d);
      else key = (s.task && String(s.task).trim()) || '(no task)';
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(s);
    }
    groups = Array.from(buckets.entries()).map(([key, rows]) => ({
      key, label: key, ...summarize(rows)
    }));
    if (groupBy === 'task') groups.sort((a, b) => b.focusMinutes - a.focusMinutes || b.completedFocusSessions - a.completedFocusSessions);
    else groups.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  }

  return { period, groupBy, summary, groups };
}

export {
  TYPES,
  DEFAULT_MINUTES,
  normalizeType,
  defaultMinutes,
  decorate,
  resolvePeriodRange,
  start,
  status,
  complete,
  cancel,
  list,
  stats,
  report
};
