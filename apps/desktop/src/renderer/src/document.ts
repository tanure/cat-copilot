import type { RecordInput } from '../../shared.js';

export function defaultFields(): RecordInput['fields'] {
  return {
    status: 'Open', priority: 'P2', due: '', folder: 'General', tags: [],
    project: '', goal: '', measure: '', steps: '', why: '', importance: '',
    urgency: '', progress: 0, parent: '', period: '', minutes: 25,
    started: '', completed: '',
  };
}

export function splitFrontmatter(value: string): { prefix: string; body: string } {
  const match = /^(?:\uFEFF)?---\r?\n(?:[\s\S]*?\r?\n)?(?:---|\.\.\.)(?:\r?\n|$)/.exec(value);
  return match ? { prefix: match[0], body: value.slice(match[0].length) } : { prefix: '', body: value };
}

export function richRestriction(body: string): string {
  if (/<\/?[A-Za-z][^>]*>|<!--/.test(body)) return 'HTML or comments are present.';
  if (/!?\[\[[\s\S]*?\]\]|\{\{|\{%|^:::+|^>\s*\[!|^\s*\^[\w-]+|\$\$|(^|[^\\])\$[^$\n]+\$/m.test(body)) return 'Wiki links, directives, callouts, or plugin syntax are present.';
  if (/^ {0,3}\[[^\]]+\]:|\[\^[^\]]+\]|^ {0,3}[-*_](?:\s*[-*_]){2,}\s*$|!\[[^\]]*\]\([^)]*\)|\[[^\]]+\]\([^)]*\s+["']|~{2,}/m.test(body)) return 'Extended Markdown requiring exact source preservation is present.';
  return '';
}

export function draftKey(workspaceId: string, id: string): string {
  return `catpilot:draft:${workspaceId}:${id}`;
}

export function readPreference(key: string, fallback: string): string {
  try { return localStorage.getItem(`catpilot:${key}`) ?? fallback; } catch { return fallback; }
}

export function writePreference(key: string, value: string): void {
  try { localStorage.setItem(`catpilot:${key}`, value); } catch { /* Preferences remain usable for this window. */ }
}
