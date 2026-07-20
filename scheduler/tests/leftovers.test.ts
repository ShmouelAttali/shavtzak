// Unit tests for the 2026-07-19 leftover/shortage fixes:
//  - fullyBlocked judges the MERGED unavailability cover (multi-row home
//    leave => בבית, not a bogus נותר-במנוחה rester)
//  - retractCoveredShortages drops a Level-1 bucket shortage once every seat
//    of the position ended covered (e.g. תורנים repaired by replacement
//    pairs), but never touches quota (מפקדים/נהגים) warnings
import test from 'node:test';
import assert from 'node:assert/strict';
import { fullyBlocked, Gen } from '../src/state.js';
import { retractCoveredShortages } from '../src/generate.js';

const genWith = (blocks: [number, number][]): Gen => ({
  ctx: { blocked: new Map([[1, blocks]]) },
  dRange: [1000, 2440],
} as unknown as Gen);

test('fullyBlocked: single covering row', () => {
  assert.equal(fullyBlocked(genWith([[900, 2500]]), 1), true);
});

test('fullyBlocked: two adjacent rows covering the day (the אליהו-אדרי case)', () => {
  // home leave imported as two rows meeting mid-day — merged cover spans the
  // whole schedule day, so the soldier is בבית (was: rester + bogus warning)
  assert.equal(fullyBlocked(genWith([[1000, 1960], [1960, 3400]]), 1), true);
});

test('fullyBlocked: overlapping unsorted rows covering the day', () => {
  assert.equal(fullyBlocked(genWith([[1800, 2500], [900, 1900]]), 1), true);
});

test('fullyBlocked: gap between rows leaves the soldier available', () => {
  // available 1400-1500 — an arrival/partial day, NOT fully blocked
  assert.equal(fullyBlocked(genWith([[900, 1400], [1500, 2500]]), 1), false);
});

test('fullyBlocked: cover stops short of the day end', () => {
  assert.equal(fullyBlocked(genWith([[900, 2400]]), 1), false);
});

test('fullyBlocked: no blocks', () => {
  assert.equal(fullyBlocked(genWith([]), 1), false);
});

test('retract: bucket shortage dropped when no seat of the position is empty', () => {
  const issues = [
    'תורנים: חסרים 2 חיילים',
    'מגן: חסרים 11 חיילים',
    'מגן 14:00-14:00 מושב 12: לא אויש',
  ];
  const out = retractCoveredShortages(issues);
  // תורנים ended fully covered (pairs) — its bucket warning is noise
  assert.ok(!out.includes('תורנים: חסרים 2 חיילים'), 'covered תורנים shortage kept');
  // מגן still has an empty seat — its shortage stays
  assert.ok(out.includes('מגן: חסרים 11 חיילים'), 'real מגן shortage retracted');
  assert.ok(out.includes('מגן 14:00-14:00 מושב 12: לא אויש'), 'seat issue lost');
});

test('retract: quota warnings (מפקדים/נהגים) are never retracted', () => {
  const issues = [
    'התקפי: חסרים 1 מפקדים בשיבוץ היומי',
    'סיור: חסרים 1 נהגים (נהג דוד)',
  ];
  assert.deepEqual(retractCoveredShortages(issues), issues);
});

test('retract: a blocked seat also counts as uncovered', () => {
  const issues = ['סיור: חסרים 1 חיילים', 'סיור 22:00-06:00 מושב 2: חסום'];
  assert.deepEqual(retractCoveredShortages(issues), issues);
});
