import { z } from 'zod';
import { fieldsSchema, type RecordInput } from './types.js';

export const aiChangeSchema = z.object({
  title: z.string().trim().min(1).max(500),
  body: z.string().max(200_000),
  fields: z.object({
    status: fieldsSchema.shape.status.removeDefault(),
    priority: fieldsSchema.shape.priority.removeDefault(),
    due: fieldsSchema.shape.due.removeDefault(),
    tags: fieldsSchema.shape.tags.removeDefault(),
    goal: fieldsSchema.shape.goal.removeDefault(),
    measure: fieldsSchema.shape.measure.removeDefault(),
    steps: fieldsSchema.shape.steps.removeDefault(),
    why: fieldsSchema.shape.why.removeDefault(),
    importance: fieldsSchema.shape.importance.removeDefault(),
    urgency: fieldsSchema.shape.urgency.removeDefault(),
  }).partial().strict(),
}).strict();
export type AiChange = z.infer<typeof aiChangeSchema>;
export interface AiProposal {
  id: string;
  workspaceId: string;
  recordId: string;
  expectedRevision: string;
  before: RecordInput;
  after: RecordInput;
}
