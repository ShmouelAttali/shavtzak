// demand() (Level-1 crew sizing): max(concurrent seats, ceil(hours / cap)),
// with the readiness short-circuit. Pure unit tests over a stub Gen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demand } from '../src/level1.js';
import { Slot } from '../src/model.js';
import { toMin } from '../src/time.js';

const base = toMin('2026-08-01', '14:00');   // schedule-day start
const slot = (offsetH: number, durH: number, seats: number): Slot => ({
  positionId: 1, subPositionId: null, subName: null,
  period: [base + offsetH * 60, base + (offsetH + durH) * 60],
  seats, commanderFirstSeat: false,
});

const stubGen = (missionClass: string) => ({
  ctx: {
    positions: new Map([[1, { id: 1, name: 'עמדה', missionClass, isScheduled: true, config: {} }]]),
    tunables: { restMinH: 4, restIdealH: 8, longTaskH: 4, dailyCapH: 8, readinessHourWeight: 0.25, gashashEffectiveHours: 1.5 },
  },
}) as any;

test('demand: concurrent seats dominate (two overlapping 4h slots × 4 seats)', () => {
  const slots = [slot(0, 4, 4), slot(0, 4, 4)];
  // hours: 2 × 4h × 4 seats = 32h → ceil(32/8) = 4; concurrent = 8 → wins
  assert.equal(demand(stubGen('static'), 1, slots), 8);
});

test('demand: counted hours dominate (six sequential 4h slots × 1 seat)', () => {
  const slots = [0, 4, 8, 12, 16, 20].map((o) => slot(o, 4, 1));
  // concurrent = 1; hours = 24h → ceil(24/8) = 3 → wins
  assert.equal(demand(stubGen('static'), 1, slots), 3);
});

test('demand: readiness crews size by the slot seats themselves', () => {
  const slots = [slot(0, 24, 8)];
  // a 24h readiness slot is NOT ceil(24×8/8)=24 — it is the 8 concurrent seats
  assert.equal(demand(stubGen('readiness'), 1, slots), 8);
});
