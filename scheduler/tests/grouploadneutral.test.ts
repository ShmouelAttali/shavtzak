// Task 3 / Task 4a: the Level-1 GROUP cascade (rank.ts groupKey / rankGroup)
// must NEVER use weekly load (P3) to decide WHICH position a soldier joins —
// positions are not lighter/heavier than each other, and within a group
// everyone serves identical hours so load splits evenly by construction.
// Load (P3) is a Level-2 SLOT key only. These are pure-function unit tests on
// the exported group cascade.
import './env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupKey, rankGroup } from '../src/rank.js';
import { Gen, SoldierState, EMPTY_FAIRNESS } from '../src/state.js';

const POS = 2;
const mkGen = (): Gen => ({
  day: '2026-08-03',                 // a Monday — no Sunday continuity reset path
  dRange: [0, 1440],
  assignments: [],
  ctx: {
    tunables: { restIdealH: 8, dailyCapH: 8 },
    positions: new Map([[POS,
      { id: POS, name: 'עמדות הגנה', missionClass: 'static', config: {} }]]),
    yesterdayPosition: new Map(),
    staticStreak: new Map(),
    onCallStreak: new Map(),
  },
} as unknown as Gen);

const mkState = (id: number, weeklyLoad: number): SoldierState => ({
  soldier: {
    id, name: `חייל ${String(id).padStart(2, '0')}`, platoon: '1', role: 'לוחם',
    rifle: 3, quals: [], isCommander: false, isSeniorCommander: false,
    isDudDriver: false, isTigerDriver: false, allowedPositions: null,
  },
  fairness: { ...EMPTY_FAIRNESS, weightedHours7d: weeklyLoad, positionCounts: {} },
  intervals: [], readiness: [], missionHoursToday: 0, nightsToday: 0,
  trackerMinutes: 0, gashashNightEnds: [], level1: null, level1Rationale: [],
} as unknown as SoldierState);

test('groupKey is identical for two soldiers differing ONLY in weekly load', () => {
  const g = mkGen();
  const light = mkState(1, 4);      // very low weekly load
  const heavy = mkState(2, 200);    // very high weekly load
  assert.deepEqual(groupKey(g, light, POS), groupKey(g, heavy, POS),
    'weekly load leaked into the Level-1 group key');
});

test('rankGroup order does NOT change when the two candidates swap loads', () => {
  const g = mkGen();
  // same two soldier ids, only the load assignment differs between runs
  const a1 = mkState(1, 4), b1 = mkState(2, 200);
  const a2 = mkState(1, 200), b2 = mkState(2, 4);
  const order1 = rankGroup(g, [a1, b1], POS).map((s) => s.soldier.id);
  const order2 = rankGroup(g, [a2, b2], POS).map((s) => s.soldier.id);
  assert.deepEqual(order1, order2,
    'group ordering flipped with load — load must not influence composition');
});
