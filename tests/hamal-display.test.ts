// Display test: per-shift חמל rows written by api/hamal.ts surface in the draft
// tab (api/draft.ts) as a multi-time card — real shift-time labels, sorted in
// schedule-day order (14:00 first, pre-14:00 windows are the day's tail and
// carry "(למחרת)").
process.env.SCHEDULER_DATABASE_URL =
  process.env.SCHEDULER_TEST_DATABASE_URL
  ?? 'postgres://postgres:test@localhost:55432/shavtzak_test';

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshSchema, seedSoldiers, soldierId, closePool } from '../scheduler/tests/helpers.js';
import { getPool } from '../api/_db.js';
import hamalHandler from '../api/hamal.js';
import draftHandler from '../api/draft.js';
import type { DraftResponse } from '../api/draft.js';

const D = '2026-09-20';

function mockRes() {
  const res: any = {
    statusCode: 0, body: undefined as unknown,
    setHeader() {}, status(c: number) { res.statusCode = c; return res; },
    json(b: unknown) { res.body = b; return res; }, end() { return res; },
  };
  return res;
}

before(async () => {
  await freshSchema();
  await seedSoldiers();
  const a = await soldierId('חייל 40'), b = await soldierId('חייל 41'), c = await soldierId('חייל 42');
  const res = mockRes();
  await hamalHandler({ method: 'PUT', query: {}, body: { day: D, shifts: [
    { start: '14:00', end: '22:00', soldierIds: [a] },
    { start: '22:00', end: '06:00', soldierIds: [b] },
    { start: '06:00', end: '14:00', soldierIds: [c] },
  ] } } as any, res as any);
  assert.equal(res.statusCode, 200);
});
after(async () => { await getPool().end().catch(() => {}); await closePool(); });

test('a day with 3 per-shift חמל rows yields 3 time labels ordered 14:00, 22:00, 06:00(למחרת)', async () => {
  const res = mockRes();
  await draftHandler({ method: 'GET', query: { from: D, to: D } } as any, res as any);
  assert.equal(res.statusCode, 200);
  const body = res.body as DraftResponse;
  const hamal = body.days[0].groups.find((g) => g.name === 'חמל');
  assert.ok(hamal, 'חמל group present');
  const labels = hamal!.subTypes[0].times.map((t) => t.time);
  assert.deepEqual(labels, ['14:00-22:00', '22:00-06:00', '06:00-14:00 (למחרת)']);
});
