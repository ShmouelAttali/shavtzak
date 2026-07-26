// Unit tests for the מבנה יומי tab's collapse state (src/components/DayStructure.tsx):
// groups start collapsed, the כווץ הכל / הרחב הכל button flips on "is anything
// open", and uids left over from a previous load (every reload re-mints them)
// must not count as open.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { anyExpanded, toggleAll } from '../src/components/DayStructure';

const groups = [{ uid: 'u1' }, { uid: 'u2' }, { uid: 'u3' }];

test('nothing expanded by default', () => {
  assert.equal(anyExpanded(groups, new Set()), false);
});

test('stale uids from a previous load do not count as expanded', () => {
  assert.equal(anyExpanded(groups, new Set(['old1', 'old2'])), false);
});

test('toggleAll opens everything when all are collapsed', () => {
  assert.deepEqual(toggleAll(groups, new Set()), new Set(['u1', 'u2', 'u3']));
});

test('toggleAll collapses everything when even one group is open', () => {
  assert.deepEqual(toggleAll(groups, new Set(['u2'])), new Set());
  assert.deepEqual(toggleAll(groups, new Set(['u1', 'u2', 'u3'])), new Set());
});

test('toggleAll with only stale uids opens everything (button reads הרחב הכל)', () => {
  assert.equal(anyExpanded(groups, new Set(['gone'])), false);
  assert.deepEqual(toggleAll(groups, new Set(['gone'])), new Set(['u1', 'u2', 'u3']));
});

test('no groups: toggleAll stays empty', () => {
  assert.deepEqual(toggleAll([], new Set()), new Set());
});
