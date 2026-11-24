import type { AiProposal, RecordInput } from '../../shared.js';

type Origin = { workspaceId: string; recordId: string; expectedRevision: string };

function stable(value: unknown): string | undefined {
  return JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]]))
    : item);
}

export function changedMetadata(before: Record<string, unknown>, after: Record<string, unknown>) {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()
    .filter(key => stable(before[key]) !== stable(after[key]))
    .map(key => ({ key, before: before[key], after: after[key] }));
}

export function proposalMatches(proposal: AiProposal, origin: Origin, saved: RecordInput): boolean {
  return !!proposal.id && proposal.workspaceId === origin.workspaceId && proposal.recordId === origin.recordId &&
    proposal.expectedRevision === origin.expectedRevision && proposal.before.domain === saved.domain &&
    proposal.before.title === saved.title && proposal.before.body === saved.body &&
    changedMetadata(proposal.before.fields, saved.fields).length === 0;
}
