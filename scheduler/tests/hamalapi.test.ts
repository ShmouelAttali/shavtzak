// Handler-level tests for api/hamal.ts (the חמל tab API): GET returns picks +
// the full DB roster; PUT persists manual/locked חמל rows immediately; an
// empty list clears the day.
import './env.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshSchema, seedSoldiers, soldierId, closePool, query } from './helpers.js';
import hamalHandler from '../../api/hamal.js';
import { getPool } from '../../api/_db.js';
import type { HamalResponse, HamalWriteResponse } from '../../api/hamal.js';

const D = '2026-08-05';

// Minimal VercelRequest/VercelResponse mock (same shape as scripts/dev-api.ts).
function mockRes() {
  const out: { status: number; body: any } = { status: 0, body: null };
  const res: any = {
    setHeader() { return res; },
    status(code: number) { out.status = code; return res; },
    json(body: any) { out.body = body; return res; },
    end() { return res; },
  };
  return { res, out };
}
async function call(req: any): Promise<{ status: number; body: any }> {
  const { res, out } = mockRes();
  await hamalHandler(req as any, res as any);
  return out;
}

before(async () => {
  await freshSchema();
  await seedSoldiers();
});
after(async () => {
  await getPool().end().catch(() => {});
  await closePool();
});

test('GET returns the full roster and (initially) no picks', async () => {
  const out = await call({ method: 'GET', query: { from: D, to: D } });
  assert.equal(out.status, 200);
  const body = out.body as HamalResponse;
  assert.equal(body.roster.length, 60, 'whole roster');
  assert.ok(body.roster.every((r) => typeof r.id === 'number' && r.name));
  assert.deepEqual(body.days, []);
});

test('PUT persists manual/locked חמל rows and echoes the picks', async () => {
  const a = Number(await soldierId('חייל 40'));
  const b = Number(await soldierId('חייל 41'));
  const out = await call({ method: 'PUT', query: {}, body: { day: D, soldierIds: [a, b] } });
  assert.equal(out.status, 200);
  const body = out.body as HamalWriteResponse;
  assert.deepEqual(body.picks.map((p) => p.soldierId).sort(), [a, b].sort());

  // DB: two manual+locked readiness rows on the חמל daily slot
  const rows = await query<{ source: string; locked: boolean; blocks_overlap: boolean; dur_h: string }>(`
    select sa.source, sa.locked, sa.blocks_overlap,
           extract(epoch from (upper(sa.period) - lower(sa.period))) / 3600 dur_h
    from shift_assignments sa join positions p on p.id = sa.position_id
    where sa.day = $1 and p.name = 'חמל'`, [D]);
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.source === 'manual' && r.locked && !r.blocks_overlap && Number(r.dur_h) === 24));

  // and matching locked Level-1 buckets so the generator pins them to חמל
  const buckets = await query(`
    select 1 from day_assignments da join positions p on p.id = da.position_id
    where da.day = $1 and p.name = 'חמל' and da.source = 'manual' and da.locked`, [D]);
  assert.equal(buckets.length, 2);

  // GET reflects it
  const got = (await call({ method: 'GET', query: { from: D, to: D } })).body as HamalResponse;
  assert.equal(got.days.length, 1);
  assert.deepEqual(got.days[0].picks.map((p) => p.soldierId).sort(), [a, b].sort());
});

test('PUT replaces the day atomically (new list wins)', async () => {
  const c = await soldierId('חייל 42');
  await call({ method: 'PUT', query: {}, body: { day: D, soldierIds: [c] } });
  const rows = await query<{ full_name: string }>(`
    select s.full_name from shift_assignments sa
    join positions p on p.id = sa.position_id join soldiers s on s.id = sa.soldier_id
    where sa.day = $1 and p.name = 'חמל'`, [D]);
  assert.deepEqual(rows.map((r) => r.full_name), ['חייל 42']);
});

test('empty soldierIds clears the day', async () => {
  const out = await call({ method: 'PUT', query: {}, body: { day: D, soldierIds: [] } });
  assert.equal(out.status, 200);
  assert.deepEqual((out.body as HamalWriteResponse).picks, []);
  const rows = await query(`
    select 1 from shift_assignments sa join positions p on p.id = sa.position_id
    where sa.day = $1 and p.name = 'חמל'`, [D]);
  assert.deepEqual(rows, []);
  const buckets = await query(`
    select 1 from day_assignments da join positions p on p.id = da.position_id
    where da.day = $1 and p.name = 'חמל'`, [D]);
  assert.deepEqual(buckets, []);
});

test('bad input is rejected', async () => {
  assert.equal((await call({ method: 'GET', query: { from: 'nope' } })).status, 400);
  assert.equal((await call({ method: 'PUT', query: {}, body: { day: D } })).status, 400);
  assert.equal((await call({ method: 'PUT', query: {}, body: { soldierIds: [] } })).status, 400);
  assert.equal((await call({ method: 'PATCH', query: {} })).status, 405);
});
