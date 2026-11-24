import { z } from 'zod';
import type { RecordEntry } from './types.js';

const identity = { id: z.uuid(), expectedRevision: z.string().min(1) };
export const managementRequestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('comment'), ...identity, text: z.string().trim().min(1).max(100_000) }),
  z.object({ action: z.literal('log'), ...identity, text: z.string().trim().min(1).max(100_000) }),
  z.object({ action: z.literal('editComment'), ...identity, collection: z.enum(['comments', 'logs', 'log']).optional(), index: z.number().int().min(0), text: z.string().trim().min(1).max(100_000), date: z.string().max(80).optional() }),
  z.object({ action: z.literal('removeComment'), ...identity, collection: z.enum(['comments', 'logs', 'log']).optional(), index: z.number().int().min(0) }),
  z.object({ action: z.literal('complete'), ...identity }),
  z.object({ action: z.literal('carryForward'), ...identity, period: z.string().min(1), dryRun: z.boolean().optional() }),
  z.object({ action: z.literal('timerStart'), title: z.string().trim().min(1).max(500).optional(), purpose: z.string().trim().max(500).optional(), minutes: z.number().int().min(1).max(1440).optional(), type: z.enum(['focus', 'short-break', 'long-break']).optional(), task: z.uuid().optional(), tasks: z.array(z.uuid()).max(50).optional() }),
  z.object({ action: z.literal('timerStatus') }),
  z.object({ action: z.literal('timerComplete'), ...identity, notes: z.string().max(100_000).optional() }),
  z.object({ action: z.literal('timerCancel'), ...identity, notes: z.string().max(100_000).optional() }),
  z.object({ action: z.literal('timerStats'), from: z.iso.date().optional(), to: z.iso.date().optional() }),
  z.object({ action: z.literal('prioritize'), asOf: z.iso.date() }),
  z.object({ action: z.literal('rollup'), id: z.uuid() }),
  z.object({ action: z.literal('report'), from: z.iso.date(), to: z.iso.date() }),
]);
export type ManagementRequest = z.infer<typeof managementRequestSchema>;
export interface ManagementRollup {
  id: string;
  total: number;
  completed: number;
  progress: number;
  children: RecordEntry[];
  canComplete: boolean;
}
export interface ManagementPriority {
  record: RecordEntry;
  quadrant: 'q1' | 'q2' | 'q3' | 'q4';
  smart: ReturnType<typeof import('../../lib/eisenhower.js').smartScore>;
  score: number;
}
export interface ManagementReport {
  from: string;
  to: string;
  records: RecordEntry[];
  counts: Record<string, number>;
  achievements: { id: string; sourceId: string; title: string; completed: string }[];
  markdown: string;
}
export interface ManagementCarryPreview {
  dryRun: true;
  id: string;
  expectedRevision: string;
  from: string;
  to: string;
}
export interface ManagementTimerStatus {
  active: RecordEntry | null;
  elapsedSec: number;
  remainingSec: number;
  isExpired: boolean;
}
export interface ManagementTimerStats {
  sessions: RecordEntry[];
  completed: number;
  cancelled: number;
  focusMinutes: number;
  plannedMinutes: number;
}
export type ManagementResult = RecordEntry | ManagementRollup | ManagementPriority[] | ManagementReport | ManagementCarryPreview | ManagementTimerStatus | ManagementTimerStats;
