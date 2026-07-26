// Task 5: the two P5 role-fit keys rank ABOVE the P3 bucketed-load key in the
// Level-2 slot cascade (owner 2026-07-24 — rule 6, the patrol-night נהג דוד, is
// "more of a hard rule"). Pure-function unit test on the exported slot rank().
import './env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rank } from '../src/rank.js';
import { Gen, SoldierState, EMPTY_FAIRNESS } from '../src/state.js';

const SIUR = 1;
const mkGen = (): Gen => ({
  day: '2026-08-03',
  dRange: [0, 1440],
  night: [600, 960],
  assignments: [],
  ctx: {
    tunables: { restIdealH: 8, dailyCapH: 8, restMinH: 4, longTaskH: 4, gashashEffectiveHours: 1.5 },
    positions: new Map([[SIUR,
      { id: SIUR, name: 'סיור', missionClass: 'dynamic', config: {} }]]),
    existing: new Map(),
    staticStreak: new Map(),
    onCallStreak: new Map(),
    yesterdayPosition: new Map(),
    recentSubCount: new Map(),
  },
} as unknown as Gen);

const mkState = (id: number, isDud: boolean, load: number): SoldierState => ({
  soldier: {
    id, name: `חייל ${String(id).padStart(2, '0')}`, platoon: '1', role: 'לוחם',
    rifle: 3, quals: [], isCommander: false, isSeniorCommander: false,
    isDudDriver: isDud, isTigerDriver: false, allowedPositions: null,
  },
  fairness: { ...EMPTY_FAIRNESS, weightedHours7d: load, positionCounts: {} },
  intervals: [], readiness: [], missionHoursToday: 0, nightsToday: 0,
  trackerMinutes: 0, gashashNightEnds: [], level1: null, level1Rationale: [],
} as unknown as SoldierState);

test('P5 rule 6 outranks P3: נהג דוד wins a night patrol seat despite a HIGHER load bucket', () => {
  const g = mkGen();
  // driver carries a full extra duty-day of load (a whole 8h bucket more) —
  // under the old order (P3 above role fit) the light non-driver would win.
  const driverHeavy = mkState(1, true, 16);
  const nonDriverLight = mkState(2, false, 0);
  const ordered = rank(g, [nonDriverLight, driverHeavy], SIUR, /*forNight*/ true, 0, null);
  assert.equal(ordered[0].soldier.id, 1,
    'the נהג דוד must sort first for a night patrol slot even with more load');
});

test('P5 role fit only breaks ties — equal drivers still fall to load (P3)', () => {
  const g = mkGen();
  const driverHeavy = mkState(1, true, 16);
  const driverLight = mkState(2, true, 0);
  const ordered = rank(g, [driverHeavy, driverLight], SIUR, true, 0, null);
  assert.equal(ordered[0].soldier.id, 2,
    'two drivers tie on P5 role fit, so the lighter weekly load (P3) decides');
});
