import assert from 'node:assert/strict';
import test from 'node:test';
import { changedMetadata, proposalMatches } from './proposal.ts';

const before = { domain: 'tasks', title: 'Saved task', body: 'Original\n', fields: { status: 'Open', goal: '', tags: ['a'], extra: { a: 1, b: 2 } } };
const context = { workspaceId: 'workspace-a', recordId: 'task-a', expectedRevision: 'revision-a' };
const proposal = { id: 'approval-token', ...context, before, after: { ...before, title: 'Proposed task', fields: { ...before.fields, goal: 'Ship the feature' } } };

test('a proposal cannot cross workspace, record, revision or saved-content boundaries', () => {
  assert.equal(proposalMatches(proposal, context, before), true);
  for (const key of ['workspaceId', 'recordId', 'expectedRevision']) {
    assert.equal(proposalMatches({ ...proposal, [key]: 'other' }, context, before), false, key);
  }
  for (const update of [{ domain: 'journal' }, { title: 'Changed' }, { body: 'Changed' }, { fields: { ...before.fields, status: 'Done' } }]) {
    assert.equal(proposalMatches(proposal, context, { ...before, ...update }), false);
  }
  assert.equal(proposalMatches({ ...proposal, id: '' }, context, before), false);
});

test('metadata review shows changed SMART values and removed extras without object-key-order noise', () => {
  assert.deepEqual(changedMetadata(before.fields, { ...before.fields, extra: { b: 2, a: 1 }, goal: 'Ship the feature', due: '2026-12-01' }), [
    { key: 'due', before: undefined, after: '2026-12-01' },
    { key: 'goal', before: '', after: 'Ship the feature' },
  ]);
  assert.deepEqual(changedMetadata({ tags: ['a', 'b'], custom: true }, { tags: ['b', 'a'] }), [
    { key: 'custom', before: true, after: undefined },
    { key: 'tags', before: ['a', 'b'], after: ['b', 'a'] },
  ]);
});
