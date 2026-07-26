// Task 4b: cross-day sub-post spread (P4c) — the LAST Level-2 slot key before
// the seeded random tie. Among candidates equal on everything above, prefer
// whoever held THIS sub-position least over the recent days. Purely additive:
// it must NOT override any higher key (e.g. P3 load). Pure-function unit tests
// on the exported slot rank().
import './env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rank } from '../src/rank.js';
import { Gen, SoldierState, EMPTY_FAIRNESS } from '../src/state.js';

const POS = 2;      // עמדות הגנה (static, no role fit)
const SUB = 3;      // some sub-position id
const mkGen = (recent: Map<number, Map<number, number>>): Gen => ({
  day: '2026-08-03',
  dRange: [0, 1440],
  night: [600, 960],
  assignments: [],
  ctx: {
    tunables: { restIdealH: 8, dailyCapH: 8, restMinH: 4, longTaskH: 4, gashashEffectiveHours: 1.5 },
    positions: new Map([[POS,
      { id: POS, name: 'עמדות הגנה', missionClass: 'static', config: {} }]]),
    existing: new Map(),
    staticStreak: new Map(),
    onCallStreak: new Map(),
    yesterdayPosition: new Map(),
    recentSubCount: recent,
  },
} as unknown as Gen);

const mkState = (id: number, load: number): SoldierState => ({
  soldier: {
    id, name: `חייל ${String(id).padStart(2, '0')}`, platoon: '1', role: 'לוחם',
    rifle: 3, quals: [], isCommander: false, isSeniorCommander: false,
    isDudDriver: false, isTigerDriver: false, allowedPositions: null,
  },
  fairness: { ...EMPTY_FAIRNESS, weightedHours7d: load, positionCounts: {} },
  intervals: [], readiness: [], missionHoursToday: 0, nightsToday: 0,
  trackerMinutes: 0, gashashNightEnds: [], level1: null, level1Rationale: [],
} as unknown as SoldierState);

test('P4c breaks a full tie: the soldier who held this post recently sorts LAST', () => {
  // A held SUB twice over the recent days; B never did. Otherwise identical.
  const recent = new Map([[1, new Map([[SUB, 2]])]]);
  const g = mkGen(recent);
  const A = mkState(1, 0), B = mkState(2, 0);
  const ordered = rank(g, [A, B], POS, /*forNight*/ false, 0, SUB);
  assert.equal(ordered[0].soldier.id, 2, 'fresh-on-this-post soldier must win the tie (P4c)');
});

test('P4c is the LAST key: a lower weekly load (P3) still wins over post freshness', () => {
  // A held SUB recently AND has lower load; load (P3) outranks P4c, so A wins.
  const recent = new Map([[1, new Map([[SUB, 2]])]]);
  const g = mkGen(recent);
  const A = mkState(1, 0);    // recently held SUB, but lightest load
  const B = mkState(2, 16);   // never held SUB, but two duty-days heavier
  const ordered = rank(g, [A, B], POS, false, 0, SUB);
  assert.equal(ordered[0].soldier.id, 1, 'P3 load must outrank the P4c cross-day spread');
});

test('P4c has no effect when forSub is null (post-blind ranking)', () => {
  const recent = new Map([[1, new Map([[SUB, 5]])]]);
  const g = mkGen(recent);
  // with forSub=null the key is 0 for everyone → pure tie → deterministic
  // seeded order; the same two soldiers with/without recent history must sort
  // identically.
  const orderA = rank(g, [mkState(1, 0), mkState(2, 0)], POS, false, 0, null).map((s) => s.soldier.id);
  const g2 = mkGen(new Map());
  const orderB = rank(g2, [mkState(1, 0), mkState(2, 0)], POS, false, 0, null).map((s) => s.soldier.id);
  assert.deepEqual(orderA, orderB, 'recent history must not matter when no concrete post is on the table');
});
