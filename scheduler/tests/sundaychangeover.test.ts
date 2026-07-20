// Sunday exchange handling (owner 2026-07-20):
//  #2a — a partial-day soldier (leaver/arriver) left in מנוחה is EXPECTED
//        rest, not an everyone-works violation (rest_bucket skips him).
//  #2b — a chain window straddling the 08:00 bus is completed by the
//        descending crew (first half) + an arriver newcomer (second half);
//        the arriver half carries `handover_in` and is exempt from the chain
//        "didn't descend" check (validator carve-out).
import './env.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshSchema, seedSoldiers, soldierId, closePool, query } from './helpers.js';
import { generate, persist } from '../src/generate.js';
import { validateDay } from '../src/validate.js';

const SAT = '2026-08-08';   // Saturday → Sunday 08/09 bus at 08:00
const busH = 18;            // 14:00 + 18h = next-day 08:00

async function unavail(name: string, day: string, fromH: number, toH: number) {
  const sid = await soldierId(name);
  await query(`insert into unavailability (soldier_id, period, kind)
               values ($1, tsrange(day_start($2)+make_interval(hours=>$3), day_start($2)+make_interval(hours=>$4)), 'חופש')`,
    [sid, day, fromH, toH]);
  return sid;
}

before(async () => {
  await freshSchema();
  await seedSoldiers();
});
after(closePool);

test('#2a: a partial-day (arriver) soldier resting is NOT an everyone-works violation', async () => {
  await query(`insert into schedule_days (day) values ($1) on conflict do nothing`, [SAT]);
  // one full-day soldier + one arriver, both parked in מנוחה by hand; one
  // other soldier assigned so the everyone-works check runs
  const full = await soldierId('חייל 40');
  const arriver = await unavail('חייל 41', SAT, 0, busH);   // absent 14:00→08:00 = arriver
  const worker = await soldierId('חייל 42');
  await query(`insert into day_assignments (day, soldier_id, position_id, source) values
    ($1,$2,(select id from positions where name='מנוחה'),'auto'),
    ($1,$3,(select id from positions where name='מנוחה'),'auto'),
    ($1,$4,(select id from positions where name='מגן'),'auto')`, [SAT, full, arriver, worker]);

  const f = await validateDay(SAT);
  const bucket = f.filter((x) => x.rule === 'rest_bucket').map((x) => Number(x.soldierId));
  assert.ok(bucket.includes(Number(full)), 'full-day rester must be flagged');
  assert.ok(!bucket.includes(Number(arriver)), 'partial-day (arriver) rester must NOT be flagged');
  await query(`delete from day_assignments where day=$1`, [SAT]);
  await query(`delete from unavailability where soldier_id=$1`, [arriver]);
});

test('#2b: chain bus-split — descending crew first half + arriver second half, no chain error', async () => {
  // כרמל 06:00–10:00 sources from עמדות הגנה 02:00–06:00. Build that window by
  // hand: 3 descending-crew soldiers (present until the 08:00 bus) man
  // 02:00–06:00 עמדות, then hold כרמל 06:00–08:00; 3 arrivers (back at 08:00)
  // take כרמל 08:00–10:00 with handover_in.
  await query(`insert into schedule_days (day) values ($1) on conflict do nothing`, [SAT]);
  const carmel = (await query<{ id: number }>(`select id from positions where name='כרמל חטיבה'`))[0].id;
  const defense = (await query<{ id: number }>(`select id from positions where name='עמדות הגנה'`))[0].id;
  const crew = ['חייל 46', 'חייל 47', 'חייל 48'];
  const newcomers = ['חייל 51', 'חייל 52', 'חייל 53'];
  for (const n of crew) await unavail(n, SAT, busH, 24);        // leaver: gone at 08:00
  for (const n of newcomers) await unavail(n, SAT, 0, busH);    // arriver: back at 08:00

  const ins = async (name: string, pos: number, fromH: number, toH: number, rat: object[]) => {
    const sid = await soldierId(name);
    await query(`insert into shift_assignments (day, position_id, soldier_id, period, source, blocks_overlap, seat_index, rationale)
      select $1,$2,$3, tsrange(day_start($1)+make_interval(hours=>$4), day_start($1)+make_interval(hours=>$5)),
             'chain', false,
             coalesce((select max(seat_index)+1 from shift_assignments sa where sa.day=$1 and sa.position_id=$2
               and sa.period=tsrange(day_start($1)+make_interval(hours=>$4), day_start($1)+make_interval(hours=>$5))),1),
             $6::jsonb`,
      [SAT, pos, sid, fromH, toH, JSON.stringify(rat)]);
  };
  // descending crew: עמדות 02:00–06:00 (source) + כרמל 06:00–08:00 (first half)
  for (const n of crew) {
    await ins(n, defense, 12, 16, [{ code: 'sub_spread' }]);              // 02:00–06:00
    await ins(n, carmel, 16, busH, [{ code: 'chain' }, { code: 'handover_out' }]);  // 06:00–08:00
  }
  // arrivers: כרמל 08:00–10:00 (second half) with handover_in
  for (const n of newcomers) {
    await ins(n, carmel, busH, 20, [{ code: 'chain' }, { code: 'chain_completion' }, { code: 'handover_in' }]);
  }

  const allChain = (await validateDay(SAT)).filter((x) => x.rule === 'chain' && x.severity === 'error')
    .map((x) => Number(x.soldierId));
  const newcomerIds = (await Promise.all(newcomers.map(soldierId))).map(Number);
  assert.ok(!newcomerIds.some((id) => allChain.includes(id)),
    `arriver half wrongly flagged as not-descended: ${JSON.stringify(allChain)}`);
  await query(`delete from shift_assignments where day=$1`, [SAT]);
});
