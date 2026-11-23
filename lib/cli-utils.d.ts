export function parseTasksTable(content: string): Array<{
  id: number; status: string; title: string; dueDate: string; priority: string; tags: string; context: string; project: string;
  smart: { goal: string; measure: string; why: string; steps: string; importance: string; urgency: string };
  log: Array<{ date: string; text: string }>;
}>;
export function parseJournalEntries(content: string): Array<{ date: string; text: string }>;
export function parsePomodoroTable(content: string): Array<{
  id: number; type: string; task: string; started: string; ended: string; plannedMin: string; actualMin: string; status: string; notes: string;
}>;
