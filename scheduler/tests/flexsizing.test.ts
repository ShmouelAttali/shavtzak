// Flex seat sizing on soldier shortage (סיור shrinks 4→3, מגן pinned to its
// flex min with a shortage issue) and the H6d driver-outage issues.
import './env.js';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshSchema, seedSoldiers, closePool, query } from './helpers.js';
import { generate, persist } from '../src/generate.js';

const D = '2026-08-01';

after(closePool);

test('flex shortage: pool of 40 shrinks סיור to 3 seats/shift and pins מגן at its min', async () => {
  await freshSchema();
  await seedSoldiers();
  // 20 fighters out for the whole schedule day → pool 40. Non-מגן demand at
  // סיור@4 is 35 (free 5 < מגן min 10) → shrink to 3 (demand 32, free 8) —
  // still short of 10, no more flex room, so the sizing pass flags מגן.
  await query(`insert into unavailability (soldier_id, period, kind)
    select id, tsrange(day_start($1), day_start($1) + interval '1 day'), 'חופש'
    from soldiers where full_name >= 'חייל 41'`, [D]);
  const res = await generate(D);
  await persist(res);

  assert.ok(res.issues.some((i) => i.includes('מגן: חסרים 2')), JSON.stringify(res.issues));

  const patrol = await query<{ lo: string; n: string }>(`
    select lower(sa.period)::text lo, count(*) n
    from shift_assignments sa join positions p on p.id = sa.position_id
    where sa.day = $1 and p.name = 'סיור' group by 1 order by 1`, [D]);
  assert.equal(patrol.length, 3, 'three patrol shifts exist');
  for (const r of patrol) {
    assert.ok(Number(r.n) <= 3, `patrol ${r.lo}: seats must shrink to 3, got ${r.n}`);
  }
  assert.ok(patrol.some((r) => Number(r.n) === 3), 'shrunk shifts still staff 3');

  // מגן takes its flex-min headcount ahead of lower-priority positions
  const magen = await query<{ n: string }>(`
    select count(*) n from day_assignments da
    join positions p on p.id = da.position_id
    where da.day = $1 and p.name = 'מגן'`, [D]);
  assert.equal(Number(magen[0].n), 10);
});

test('flex bonus seat: an unfilled מגן seat above the min (10) is NOT reported', async () => {
  await freshSchema();
  await seedSoldiers();
  // enlarge מגן to 12 seats but starve the pool so it cannot fill past its
  // flex minimum: seats 11–12 are a bonus above the min of 10 — an empty one
  // must NOT be reported (owner 2026-07-20).
  await query(`insert into seat_overrides (position_id, valid_from, seats, note)
               values ((select id from positions where name = 'מגן'), $1, 12, 'test')`, [D]);
  await query(`insert into unavailability (soldier_id, period, kind)
    select id, tsrange(day_start($1), day_start($1) + interval '1 day'), 'חופש'
    from soldiers where full_name >= 'חייל 30'`, [D]);   // leave a thin pool
  const res = await generate(D);
  const overMin = res.issues.filter((i) => i.includes('מגן') && i.includes('לא אויש'))
    .filter((i) => { const m = i.match(/מושב (\d+)/); return m && Number(m[1]) > 10; });
  assert.deepEqual(overMin, [], JSON.stringify(res.issues.filter((i) => i.includes('מגן'))));
  await query(`delete from seat_overrides where note = 'test'`);
});

test('H6d shortage: all נהג דוד out → generator reports missing drivers and empty driver seats', async () => {
  await freshSchema();
  await seedSoldiers();
  await query(`insert into unavailability (soldier_id, period, kind)
    select id, tsrange(day_start($1), day_start($1) + interval '1 day'), 'חופש'
    from soldiers where full_name in ('חייל 11', 'חייל 12', 'חייל 15', 'חייל 16')`, [D]);
  const res = await generate(D);
  assert.ok(res.issues.some((i) => i.includes('סיור') && i.includes('נהגים') && i.includes('נהג דוד')),
    JSON.stringify(res.issues));
  assert.ok(res.issues.some((i) => i.includes('לא אויש') && i.includes('(נהג)')),
    JSON.stringify(res.issues));
});
