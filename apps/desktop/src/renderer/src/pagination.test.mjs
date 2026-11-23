import assert from 'node:assert/strict';
import test from 'node:test';
import { pageWindow } from './pagination.ts';

test('a large list mounts at most one bounded page without dropping its total', () => {
  assert.deepEqual(pageWindow(10_000, 0), { page: 0, pages: 200, start: 0, end: 50, total: 10_000 });
  assert.deepEqual(pageWindow(10_001, 200), { page: 200, pages: 201, start: 10_000, end: 10_001, total: 10_001 });
});

test('filtering or deleting the last page clamps the range to remaining matches', () => {
  assert.deepEqual(pageWindow(51, 199), { page: 1, pages: 2, start: 50, end: 51, total: 51 });
  assert.deepEqual(pageWindow(0, 199), { page: 0, pages: 1, start: 0, end: 0, total: 0 });
});

test('invalid page input cannot create negative, fractional, or unbounded slices', () => {
  for (const page of [-1, Number.NaN, Number.POSITIVE_INFINITY]) assert.equal(pageWindow(100, page).start, 0);
  assert.equal(pageWindow(100, 1.8).start, 50);
  assert.equal(pageWindow(100, 500).end, 100);
});

test('a board column can page independently without losing its remainder', () => {
  assert.deepEqual(pageWindow(25, 2, 12), { page: 2, pages: 3, start: 24, end: 25, total: 25 });
  assert.deepEqual(pageWindow(24, 2, 12), { page: 1, pages: 2, start: 12, end: 24, total: 24 });
});
