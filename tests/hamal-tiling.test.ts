// Pure unit tests for the חמל tiling helper (no DB). Asserts the contiguity
// invariant (segments sorted, no gap/overlap, cover exactly the 10:00→10:00 day)
// plus edit propagation and assignment preservation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clockToMinutes, minutesToClock, normalizeTiling,
  moveBoundary, addShift, removeShift,
  type HamalTileShift,
} from '../src/lib/hamalTiling.js';

const DEFAULTS: HamalTileShift[] = [
  { start: '10:00', end: '18:00', soldierId: 1 },
  { start: '18:00', end: '02:00', soldierId: 2 },
  { start: '02:00', end: '10:00', soldierId: 3 },
];

/** Assert a tiling is a valid contiguous partition of the 10:00→10:00 day. */
function assertContiguous(shifts: HamalTileShift[]) {
  assert.ok(shifts.length >= 1, 'at least one shift');
  const offs = shifts.map((s) => ({ a: clockToMinutes(s.start), b: s.end === '10:00' ? 1440 : clockToMinutes(s.end) }));
  assert.equal(offs[0].a, 0, 'first shift starts at 10:00');
  assert.equal(offs[offs.length - 1].b, 1440, 'last shift ends at next-day 10:00');
  for (let i = 0; i < offs.length; i++) {
    assert.ok(offs[i].a < offs[i].b, `shift ${i} is non-empty and non-inverted`);
    if (i > 0) assert.equal(offs[i].a, offs[i - 1].b, `shift ${i} starts exactly where ${i - 1} ends`);
  }
}

const idsOf = (s: HamalTileShift[]) => s.map((x) => x.soldierId);

test('clock <-> minutes-from-10:00 round-trips at the anchors', () => {
  assert.equal(clockToMinutes('10:00'), 0);
  assert.equal(clockToMinutes('18:00'), 480);
  assert.equal(clockToMinutes('02:00'), 960);
  assert.equal(minutesToClock(0), '10:00');
  assert.equal(minutesToClock(1440), '10:00');
  assert.equal(minutesToClock(480), '18:00');
  assert.equal(minutesToClock(960), '02:00');
});

test('defaults normalize to themselves and are contiguous', () => {
  const n = normalizeTiling(DEFAULTS);
  assertContiguous(n);
  assert.deepEqual(n.map((s) => [s.start, s.end]), [['10:00', '18:00'], ['18:00', '02:00'], ['02:00', '10:00']]);
  assert.deepEqual(idsOf(n), [1, 2, 3]);
});

test('normalize fills gaps and clips overlaps deterministically', () => {
  // gap 12:00-14:00 and an overlap; only start offsets carry info, ends derived.
  const messy: HamalTileShift[] = [
    { start: '10:00', end: '12:00', soldierId: 1 },
    { start: '14:00', end: '20:00', soldierId: 2 },
    { start: '18:00', end: '10:00', soldierId: 3 }, // starts before 2's end (overlap)
  ];
  const n = normalizeTiling(messy);
  assertContiguous(n);
  // boundaries become the sorted start offsets: 10:00, 14:00, 18:00
  assert.deepEqual(n.map((s) => [s.start, s.end]), [['10:00', '14:00'], ['14:00', '18:00'], ['18:00', '10:00']]);
  assert.deepEqual(idsOf(n), [1, 2, 3]);
});

test('normalize sorts into חמל-day order (>=10:00 first, then after-midnight)', () => {
  const scrambled: HamalTileShift[] = [
    { start: '02:00', end: '10:00', soldierId: 3 },
    { start: '10:00', end: '18:00', soldierId: 1 },
    { start: '18:00', end: '02:00', soldierId: 2 },
  ];
  assert.deepEqual(idsOf(normalizeTiling(scrambled)), [1, 2, 3]);
});

test('moveBoundary: shrinking a shift grows its neighbor, soldiers kept', () => {
  const out = moveBoundary(DEFAULTS, 0, '16:00'); // 10-18 -> 10-16, neighbor 16-02
  assertContiguous(out);
  assert.deepEqual(out.map((s) => [s.start, s.end]), [['10:00', '16:00'], ['16:00', '02:00'], ['02:00', '10:00']]);
  assert.deepEqual(idsOf(out), [1, 2, 3]);
});

test('moveBoundary: extending a shift shrinks its neighbor', () => {
  const out = moveBoundary(DEFAULTS, 0, '22:00'); // 10-18 -> 10-22, neighbor 22-02
  assertContiguous(out);
  assert.deepEqual(out.map((s) => [s.start, s.end]), [['10:00', '22:00'], ['22:00', '02:00'], ['02:00', '10:00']]);
});

test('moveBoundary clamps so a shift cannot swallow or invert its neighbor', () => {
  // try to push shift 0's end to 02:00 (== shift 1's end): clamped to just before.
  const out = moveBoundary(DEFAULTS, 0, '02:00');
  assertContiguous(out);
  assert.equal(clockToMinutes(out[1].start) < clockToMinutes(out[1].end === '10:00' ? '10:00' : out[1].end), true);
  assert.equal(out[1].start, '01:59'); // 960 - 1
});

test('moveBoundary is a no-op on the last shift (its 10:00 end is fixed)', () => {
  const out = moveBoundary(DEFAULTS, 2, '06:00');
  assert.deepEqual(out.map((s) => [s.start, s.end]), DEFAULTS.map((s) => [s.start, s.end]));
});

test('addShift inserts at the right place, truncates a neighbor (keeps soldier), empties the new span', () => {
  // add 12:00-14:00 inside the first default shift
  const out = addShift(DEFAULTS, '12:00', '14:00');
  assertContiguous(out);
  assert.deepEqual(out.map((s) => [s.start, s.end]),
    [['10:00', '12:00'], ['12:00', '14:00'], ['14:00', '18:00'], ['18:00', '02:00'], ['02:00', '10:00']]);
  // 10-12 and 14-18 are the truncated halves of the original shift 1 -> keep soldier 1;
  // 12-14 is the new empty shift; 2 and 3 untouched.
  assert.deepEqual(idsOf(out), [1, null, 1, 2, 3]);
});

test('addShift drops internal boundaries strictly inside [X,Y]; absorbed shift loses its soldier', () => {
  // add 16:00-04:00: swallows the 18:00 and 02:00 boundaries; shift 2 (18-02) is
  // fully absorbed and loses soldier 2; shift 1 truncated to 10-16 (keeps 1);
  // shift 3 truncated to 04-10 (keeps 3).
  const out = addShift(DEFAULTS, '16:00', '04:00');
  assertContiguous(out);
  assert.deepEqual(out.map((s) => [s.start, s.end]),
    [['10:00', '16:00'], ['16:00', '04:00'], ['04:00', '10:00']]);
  assert.deepEqual(idsOf(out), [1, null, 3]);
});

test('addShift handles a next-day "to" (to <= from clock) via the 10:00 cycle', () => {
  // 18:00-02:00 crosses real midnight but sits inside the חמל day (480..960).
  const out = addShift([{ start: '10:00', end: '10:00', soldierId: 9 }], '18:00', '02:00');
  assertContiguous(out);
  assert.deepEqual(out.map((s) => [s.start, s.end]),
    [['10:00', '18:00'], ['18:00', '02:00'], ['02:00', '10:00']]);
  assert.deepEqual(idsOf(out), [9, null, 9]);
});

test('removeShift merges a middle shift into the previous one (previous keeps soldier)', () => {
  const out = removeShift(DEFAULTS, 1); // remove 18-02; shift 0 extends to cover it
  assertContiguous(out);
  assert.deepEqual(out.map((s) => [s.start, s.end]), [['10:00', '02:00'], ['02:00', '10:00']]);
  assert.deepEqual(idsOf(out), [1, 3]);
});

test('removeShift on the first shift extends the next shift back to 10:00', () => {
  const out = removeShift(DEFAULTS, 0); // remove 10-18; shift 1 starts back at 10:00
  assertContiguous(out);
  assert.deepEqual(out.map((s) => [s.start, s.end]), [['10:00', '02:00'], ['02:00', '10:00']]);
  assert.deepEqual(idsOf(out), [2, 3]);
});

test('removeShift is a no-op when only one shift remains', () => {
  const one: HamalTileShift[] = [{ start: '10:00', end: '10:00', soldierId: 5 }];
  assert.deepEqual(removeShift(one, 0), one);
});
