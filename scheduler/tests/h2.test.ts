// H2 excluded pools: is_schedulable=false soldiers are outside the system.
import './env.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshSchema, seedSoldiers, soldierId, closePool, query } from './helpers.js';
import { generate, persist } from '../src/generate.js';
import { validateDay } from '../src/validate.js';

const D = '2026-08-01';
let sid: number;

before(async () => {
  await freshSchema();
  await seedSoldiers();
  sid = await soldierId('חייל 45');
  await query(`update soldiers set is_schedulable = false where id = $1`, [sid]);
  await persist(await generate(D));
});
after(closePool);

test('H2: is_schedulable=false soldier gets no assignments at all', async () => {
  const shifts = await query(`select 1 from shift_assignments where day = $1 and soldier_id = $2`, [D, sid]);
  assert.deepEqual(shifts, []);
  const buckets = await query(`select 1 from day_assignments where day = $1 and soldier_id = $2`, [D, sid]);
  assert.deepEqual(buckets, []);
});

test('H2: no "present but unassigned" warning for an excluded soldier', async () => {
  const f = await validateDay(D);
  assert.ok(!f.some((x) => x.rule === 'unassigned' && x.soldierId === sid),
    JSON.stringify(f.filter((x) => x.rule === 'unassigned')));
});

test('H2: manually-inserted row for an excluded soldier → validator warning', async () => {
  await query(`insert into shift_assignments (day, position_id, soldier_id, period, source)
               values ($1, 1, $2, tsrange(day_start($1), day_start($1) + interval '8 hours'), 'manual')`,
    [D, sid]);
  const f = await validateDay(D);
  assert.ok(f.some((x) => x.rule === 'unknown_soldier' && x.severity === 'warning'
    && x.soldierId === sid && x.message.includes('לא-לשיבוץ')), JSON.stringify(f));
  await query(`delete from shift_assignments where soldier_id = $1 and source = 'manual'`, [sid]);
});
