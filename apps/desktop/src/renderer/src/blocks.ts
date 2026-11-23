import { NodeSelection, TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state';

export function moveBlockTransaction(state: EditorState, direction: -1 | 1): Transaction | null {
  const { $from, $to } = state.selection;
  if (!$from.depth || !$to.depth || $from.index(0) !== $to.index(0)) return null;
  const index = $from.index(0);
  const neighbor = index + direction;
  if (neighbor < 0 || neighbor >= state.doc.childCount) return null;
  const node = state.doc.child(index);
  const start = $from.before(1);
  const target = direction < 0 ? start - state.doc.child(neighbor).nodeSize : start + state.doc.child(neighbor).nodeSize;
  const transaction = state.tr.delete(start, start + node.nodeSize).insert(target, node);
  transaction.setSelection(state.selection instanceof NodeSelection
    ? NodeSelection.create(transaction.doc, target)
    : TextSelection.create(transaction.doc, target + state.selection.from - start, target + state.selection.to - start));
  return transaction.scrollIntoView();
}
