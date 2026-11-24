import assert from 'node:assert/strict';
import test from 'node:test';
import { Schema } from '@tiptap/pm/model';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { moveBlockTransaction } from './blocks.ts';

const schema = new Schema({ nodes: {
  doc: { content: 'block+' }, paragraph: { content: 'text*', group: 'block' },
  heading: { content: 'text*', group: 'block', attrs: { level: { default: 2 } } }, text: { group: 'inline' },
} });
const paragraph = text => schema.node('paragraph', null, schema.text(text));
const document = () => schema.node('doc', null, [paragraph('First'), schema.node('heading', { level: 2 }, schema.text('Middle')), paragraph('Last')]);

test('moving the current block preserves its type, attributes, text and cursor offset', () => {
  const doc = document(), state = EditorState.create({ doc, selection: TextSelection.create(doc, 10) });
  const transaction = moveBlockTransaction(state, -1);
  assert.ok(transaction);
  assert.equal(transaction.doc.child(0).type.name, 'heading');
  assert.equal(transaction.doc.child(0).attrs.level, 2);
  assert.equal(transaction.doc.textContent, 'MiddleFirstLast');
  assert.equal(transaction.selection.from, 3);
  const down = moveBlockTransaction(state.apply(transaction), 1);
  assert.equal(down.doc.textContent, 'FirstMiddleLast');
  assert.equal(down.selection.from, 10);
});

test('boundary moves and selections spanning blocks cannot delete or reorder unrelated content', () => {
  const doc = document();
  assert.equal(moveBlockTransaction(EditorState.create({ doc, selection: TextSelection.create(doc, 1) }), -1), null);
  assert.equal(moveBlockTransaction(EditorState.create({ doc, selection: TextSelection.create(doc, doc.content.size - 1) }), 1), null);
  assert.equal(moveBlockTransaction(EditorState.create({ doc, selection: TextSelection.create(doc, 2, 10) }), 1), null);
});
