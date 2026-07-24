// Handler-level tests for api/hamal.ts (manual-only, per-shift חמל staffing):
// GET materializes the default shift windows + full roster; PUT persists
// manual/locked חמל rows per shift with the right tsranges + per-shift seat
// indexes; the day's shift STRUCTURE is stored as DAY-SCOPED slot_templates
// (valid_from = valid_to = the day); DELETE virgin-resets both. חמל is resolved
// via staff_all_roles (never a hardcoded id).
import './env.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshSchema, seedSoldiers, soldierId, closePool, query } from './helpers.js';
import hamalHandler from '../../api/hamal.js';
import { getPool } from '../../api/_db.js';
import type { HamalResponse, HamalWriteResponse } from '../../api/hamal.js';

const DEFAULTS = [
  { start: '14:00', end: '22:00' },
  { start: '22:00', end: '06:00' },
  { start: '06:00', end: '14:00' },
];

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

/** shift_assignments rows for חמל on a day, with period bounds + meta. */
async function shiftRows(day: string) {
  return query<{ full_name: string; seat_index: number; source: string; locked: boolean;
                 blocks_overlap: boolean; p_start: string; p_end: string }>(`
    select s.full_name, sa.seat_index, sa.source, sa.locked, sa.blocks_overlap,
           to_char(lower(sa.period),'YYYY-MM-DD HH24:MI') p_start,
           to_char(upper(sa.period),'YYYY-MM-DD HH24:MI') p_end
    from shift_assignments sa
    join positions p on p.id = sa.position_id
    join soldiers s on s.id = sa.soldier_id
    where sa.day = $1 and p.config->'staff_all_roles' ? 'חמל'
    order by lower(sa.period), sa.seat_index`, [day]);
}
/** day-scoped slot_templates (valid_from = valid_to = day) = the day's shift
 *  STRUCTURE. end_t derived from start + duration (wraps past midnight). */
async function structRows(day: string) {
  return query<{ start_t: string; end_t: string }>(`
    select to_char(st.start_time,'HH24:MI') start_t,
           to_char((st.start_time + make_interval(mins => st.duration_minutes)),'HH24:MI') end_t
    from slot_templates st
    join positions p on p.id = st.position_id
    where st.valid_from = $1 and st.valid_to = $1
      and p.config->'staff_all_roles' ? 'חמל'
    order by st.start_time`, [day]);
}
async function bucketCount(day: string): Promise<number> {
  const r = await query(`
    select 1 from day_assignments da join positions p on p.id = da.position_id
    where da.day = $1 and p.config->'staff_all_roles' ? 'חמל' and da.source='manual' and da.locked`, [day]);
  return r.length;
}

before(async () => { await freshSchema(); await seedSoldiers(); });
after(async () => { await getPool().end().catch(() => {}); await closePool(); });

test('GET materializes the 3 default shifts for a virgin day + full roster', async () => {
  const D = '2026-08-05';
  const out = await call({ method: 'GET', query: { from: D, to: D } });
  assert.equal(out.status, 200);
  const body = out.body as HamalResponse;
  assert.deepEqual(body.defaults, DEFAULTS);
  assert.equal(body.roster.length, 60);
  assert.equal(body.days.length, 1);
  const day = body.days[0];
  assert.equal(day.custom, false);
  assert.deepEqual(day.shifts.map((s) => [s.start, s.end]),
    DEFAULTS.map((d) => [d.start, d.end]));
  assert.ok(day.shifts.every((s) => s.picks.length === 0));
});

test('PUT with picks in two default shifts: right periods, per-shift seats, buckets, day-scoped templates', async () => {
  const D = '2026-08-06';
  const a = await soldierId('חייל 40'), b = await soldierId('חייל 41'), c = await soldierId('חייל 42');
  const out = await call({ method: 'PUT', query: {}, body: { day: D, shifts: [
    { start: '14:00', end: '22:00', soldierIds: [a, b] },
    { start: '22:00', end: '06:00', soldierIds: [c] },
    { start: '06:00', end: '14:00', soldierIds: [] },
  ] } });
  assert.equal(out.status, 200);
  const echo = out.body as HamalWriteResponse;
  assert.equal(echo.custom, false, 'default windows => not custom (even with picks)');
  assert.deepEqual(echo.shifts.map((s) => s.picks.length), [2, 1, 0]);

  const rows = await shiftRows(D);
  assert.equal(rows.length, 3);
  assert.ok(rows.every((r) => r.source === 'manual' && r.locked && !r.blocks_overlap));
  // 14:00-22:00 same day; 22:00-06:00 crosses midnight
  const s1 = rows.filter((r) => r.p_start === `${D} 14:00`);
  assert.deepEqual(s1.map((r) => r.p_end), [`${D} 22:00`, `${D} 22:00`]);
  assert.deepEqual(s1.map((r) => r.seat_index).sort(), [1, 2]); // per-shift seats
  const s2 = rows.find((r) => r.p_start === `${D} 22:00`)!;
  assert.equal(s2.p_end, '2026-08-07 06:00');
  assert.equal(s2.seat_index, 1); // restarts per shift

  assert.equal(await bucketCount(D), 3);          // one locked bucket per soldier
  // a day with picks stores day-scoped slot_templates for every shown window
  // (so the picks have their slots), even when the windows equal the defaults
  assert.deepEqual((await structRows(D)).map((r) => [r.start_t, r.end_t]),
    [['06:00', '14:00'], ['14:00', '22:00'], ['22:00', '06:00']]);
});

test('a virgin default day (no picks) writes NO slot_templates', async () => {
  const D = '2026-08-07';
  const out = await call({ method: 'PUT', query: {}, body: { day: D,
    shifts: DEFAULTS.map((w) => ({ ...w, soldierIds: [] as number[] })) } });
  assert.equal(out.status, 200);
  assert.equal((out.body as HamalWriteResponse).custom, false);
  assert.deepEqual(await structRows(D), []);      // defaults + no picks => nothing stored
  assert.deepEqual(await shiftRows(D), []);
});

test('period computation: 22-06 crosses midnight, 06-14 and 09-14 land on D+1', async () => {
  const D = '2026-08-08', next = '2026-08-09';
  const a = await soldierId('חייל 40'), b = await soldierId('חייל 41'),
        c = await soldierId('חייל 42'), d = await soldierId('חייל 43');
  await call({ method: 'PUT', query: {}, body: { day: D, shifts: [
    { start: '14:00', end: '22:00', soldierIds: [a] },
    { start: '22:00', end: '06:00', soldierIds: [b] },
    { start: '06:00', end: '14:00', soldierIds: [c] },
    { start: '09:00', end: '14:00', soldierIds: [d] },
  ] } });
  const rows = await shiftRows(D);
  const byStart = new Map(rows.map((r) => [r.p_start, r.p_end]));
  assert.equal(byStart.get(`${D} 14:00`), `${D} 22:00`);
  assert.equal(byStart.get(`${D} 22:00`), `${next} 06:00`);
  assert.equal(byStart.get(`${next} 06:00`), `${next} 14:00`);
  assert.equal(byStart.get(`${next} 09:00`), `${next} 14:00`);
  // this day IS custom (4 windows != 3 defaults)
  assert.equal((await structRows(D)).length, 4);
});

test('adding an empty 09:00-14:00 persists override rows and GET returns the empty shift', async () => {
  const D = '2026-08-10';
  const a = await soldierId('חייל 40');
  await call({ method: 'PUT', query: {}, body: { day: D, shifts: [
    ...DEFAULTS.map((w) => ({ ...w, soldierIds: [] as number[] })),
    { start: '09:00', end: '14:00', soldierIds: [a] as number[] },
    { start: '10:00', end: '12:00', soldierIds: [] as number[] },   // empty custom window
  ] } });
  assert.deepEqual((await structRows(D)).map((r) => r.start_t).sort(),
    ['06:00', '09:00', '10:00', '14:00', '22:00']);
  const day = ((await call({ method: 'GET', query: { from: D, to: D } })).body as HamalResponse).days[0];
  assert.equal(day.custom, true);
  const empty = day.shifts.find((s) => s.start === '10:00');
  assert.ok(empty && empty.picks.length === 0, 'empty custom shift survives reload');
});

test('editing a shift time and removing a shift rewrite the override structure', async () => {
  const D = '2026-08-11';
  const a = await soldierId('חייל 40');
  // start custom: 3 defaults + an extra
  await call({ method: 'PUT', query: {}, body: { day: D, shifts: [
    ...DEFAULTS.map((w) => ({ ...w, soldierIds: [] as number[] })),
    { start: '08:00', end: '12:00', soldierIds: [a] as number[] },
  ] } });
  // edit: change 08:00-12:00 to 09:00-11:00
  await call({ method: 'PUT', query: {}, body: { day: D, shifts: [
    ...DEFAULTS.map((w) => ({ ...w, soldierIds: [] as number[] })),
    { start: '09:00', end: '11:00', soldierIds: [a] as number[] },
  ] } });
  assert.ok((await structRows(D)).some((r) => r.start_t === '09:00'));
  assert.ok(!(await structRows(D)).some((r) => r.start_t === '08:00'));
  // remove: back to the 3 defaults only
  await call({ method: 'PUT', query: {}, body: { day: D,
    shifts: DEFAULTS.map((w) => ({ ...w, soldierIds: [] as number[] })) } });
  assert.deepEqual(await structRows(D), [], 'reverting to defaults drops override rows');
});

test('a legacy full-day 14:00-14:00 row surfaces as a derived "14:00-14:00" window', async () => {
  const D = '2026-08-12';
  const a = await soldierId('חייל 44');
  const pid = (await query<{ id: number }>(
    `select id from positions where config->'staff_all_roles' ? 'חמל'`))[0].id;
  await query(`insert into schedule_days (day) values ($1) on conflict do nothing`, [D]);
  await query(`insert into shift_assignments
                 (day, position_id, soldier_id, period, seat_index, is_commander_seat,
                  source, blocks_overlap, locked)
               values ($1, $2, $3, day_range($1), 1, false, 'manual', false, true)`, [D, pid, a]);
  const day = ((await call({ method: 'GET', query: { from: D, to: D } })).body as HamalResponse).days[0];
  const derived = day.shifts.find((s) => s.start === '14:00' && s.end === '14:00');
  assert.ok(derived, 'derived full-day window present');
  assert.equal(derived!.picks[0].name, 'חייל 44');
  assert.equal(day.custom, false); // no override rows written for a legacy row
});

test('overlapping shift windows save without a double-booking error', async () => {
  const D = '2026-08-13';
  const a = await soldierId('חייל 40');
  const out = await call({ method: 'PUT', query: {}, body: { day: D, shifts: [
    { start: '20:00', end: '23:00', soldierIds: [a] },
    { start: '22:00', end: '06:00', soldierIds: [a] },  // overlaps 22-23, same soldier
  ] } });
  assert.equal(out.status, 200);
  assert.equal((await shiftRows(D)).length, 2);
});

test('DELETE clears picks AND the structure override (virgin reset)', async () => {
  const D = '2026-08-14';
  const a = await soldierId('חייל 40');
  await call({ method: 'PUT', query: {}, body: { day: D, shifts: [
    ...DEFAULTS.map((w) => ({ ...w, soldierIds: [] as number[] })),
    { start: '08:00', end: '12:00', soldierIds: [a] as number[] },
  ] } });
  assert.ok((await structRows(D)).length > 0);
  const out = await call({ method: 'DELETE', query: { day: D } });
  assert.equal(out.status, 200);
  assert.deepEqual(await shiftRows(D), []);
  assert.deepEqual(await structRows(D), []);
  assert.equal(await bucketCount(D), 0);
});

test('bad input is rejected', async () => {
  const D = '2026-08-15';
  assert.equal((await call({ method: 'GET', query: { from: 'nope' } })).status, 400);
  assert.equal((await call({ method: 'PUT', query: {}, body: { day: D } })).status, 400);
  assert.equal((await call({ method: 'PUT', query: {}, body: { day: D, shifts: [] } })).status, 400);
  assert.equal((await call({ method: 'PUT', query: {}, body: {
    day: D, shifts: [{ start: '25:00', end: '22:00', soldierIds: [] }] } })).status, 400);
  assert.equal((await call({ method: 'PUT', query: {}, body: {
    day: D, shifts: [{ start: '14:00', end: '22:00', soldierIds: [] },
                     { start: '14:00', end: '22:00', soldierIds: [] }] } })).status, 400);
  assert.equal((await call({ method: 'PATCH', query: {} })).status, 405);
});
