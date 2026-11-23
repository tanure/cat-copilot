import type { RecordEntry, RecordInput } from '../../shared.js';

export function afterSave(submitted: RecordInput, current: RecordInput, saved: RecordEntry) {
  const persisted: RecordInput = {
    domain: saved.domain, title: saved.title, body: saved.body, fields: structuredClone(saved.fields),
  };
  return { base: JSON.stringify(persisted), draft: JSON.stringify(current) === JSON.stringify(submitted) ? persisted : current };
}

export function canAutosave(state: {
  dirty: boolean; valid: boolean; workspace: boolean; loading: boolean; saving: boolean; changing: boolean;
  conflict: boolean; modal: boolean; aiBusy: boolean; failed: boolean;
}): boolean {
  return state.dirty && state.valid && state.workspace && !state.loading && !state.saving && !state.changing &&
    !state.conflict && !state.modal && !state.aiBusy && !state.failed;
}
