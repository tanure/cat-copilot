import assert from 'node:assert/strict';
import test from 'node:test';
import { afterSave, canAutosave } from './autosave.ts';
import { defaultFields } from './document.ts';

const submitted = { domain: 'tasks', title: 'Submitted', body: 'First body', fields: defaultFields() };
const saved = { ...submitted, id: 'record', revision: 'new-revision' };

test('an in-flight save advances the base without stomping newer title, body or metadata edits', () => {
  const current = structuredClone(submitted);
  current.title = 'New typing'; current.body = 'New body'; current.fields.goal = 'New goal';
  const result = afterSave(submitted, current, saved);
  assert.deepEqual(result.draft, current);
  assert.equal(JSON.parse(result.base).body, 'First body');
  assert.notEqual(JSON.stringify(result.draft), result.base);
});

test('a completed unchanged save accepts normalization without sharing editable metadata with snapshot records', () => {
  const result = afterSave(submitted, structuredClone(submitted), { ...saved, title: 'Normalized' });
  assert.equal(result.draft.title, 'Normalized');
  result.draft.fields.tags.push('local edit');
  assert.deepEqual(saved.fields.tags, []);
});

test('invalid, conflicted, loading, saving, modal, failed or AI-busy drafts cannot trigger autosave', () => {
  const ready = { dirty: true, valid: true, workspace: true, loading: false, saving: false, changing: false, conflict: false, modal: false, aiBusy: false, failed: false };
  assert.equal(canAutosave(ready), true);
  for (const key of ['loading', 'saving', 'changing', 'conflict', 'modal', 'aiBusy', 'failed']) assert.equal(canAutosave({ ...ready, [key]: true }), false, key);
  for (const key of ['dirty', 'valid', 'workspace']) assert.equal(canAutosave({ ...ready, [key]: false }), false, key);
});
