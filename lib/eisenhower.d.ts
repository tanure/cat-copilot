interface Task {
  id: number;
  status?: string;
  dueDate?: string;
  priority?: string;
  project?: string;
  context?: string;
  smart?: Record<string, unknown>;
}
export function classifyTask(task: Task, now?: Date): { quadrant: 'q1' | 'q2' | 'q3' | 'q4'; rationale: string };
export function compareForFocus(a: Task, b: Task, now?: Date): number;
export function smartScore(task: Task): {
  score: number;
  max: number;
  percent: number;
  met: string[];
  missing: { key: string; letter: string; label: string; question: string }[];
  label: string;
};
