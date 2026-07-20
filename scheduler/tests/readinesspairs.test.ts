import './env.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshSchema, closePool, query } from './helpers.js';
import { generate, persist } from '../src/generate.js';
import { validateDay } from '../src/validate.js';

const D = '2026-08-10';

// H1 pairs on daily READINESS rows + required-driver seats (the 25/07/2026
// mass-exchange case): a 24h readiness duty whose seats can only be covered by
// a departing soldier (on base until the 08:00 bus) handing over to an
// arriving one (lands at 08:00). Scenario: only תורנים is generated, flipped
// to mission_class='readiness' with driver_qual, 2 seats. Roster: one
// fully-available NON-driver, plus a departing+arriving driver pair — seat 1
// is the H6d driver seat and only the pair can cover it (both halves
// qualified); the full non-driver takes seat 2.
before(async () => {
  await freshSchema();
  await query(`update positions set is_scheduled = false
               where name not in ('תורנים', 'מנוחה', 'בבית')`);
  await query(`update positions set mission_class = 'readiness',
               config = config || '{"driver_qual": "נהג דוד"}'::jsonb
               where name = 'תורנים'`);
  await query(`insert into soldiers (personal_number, full_name, platoon, role, rifle_level) values
    ('P001', 'מלא רגיל', '1', 'לוחם', 3),
    ('P002', 'נהג יוצא', '1', 'לוחם', 3),
    ('P003', 'נהג חוזר', '1', 'לוחם', 3)`);
  await query(`insert into soldier_qualifications (soldier_id, qualification)
               select id, 'נהג דוד' from soldiers
               where full_name in ('נהג יוצא', 'נהג חוזר')`);
  await query(`insert into unavailability (soldier_id, period, kind)
               select id, tsrange('2026-08-11 08:00', '2026-08-13 08:00'), 'חופש'
               from soldiers where full_name = 'נהג יוצא'`);
  await query(`insert into unavailability (soldier_id, period, kind)
               select id, tsrange('2026-08-09 08:00', '2026-08-11 08:00'), 'חופש'
               from soldiers where full_name = 'נהג חוזר'`);
  await persist(await generate(D));
});
after(closePool);

test('readiness pair: departing+arriving split the 24h readiness row at 08:00', async () => {
  const rows = await query<{ name: string; period: string; blocks_overlap: boolean }>(`
    select s.full_name name, sa.period::text period, sa.blocks_overlap
    from shift_assignments sa
    join soldiers s on s.id = sa.soldier_id
    join positions p on p.id = sa.position_id
    where sa.day = $1 and p.name = 'תורנים'
    order by lower(sa.period), s.full_name`, [D]);
  assert.equal(rows.length, 3, JSON.stringify(rows));
  const full = rows.find((r) => r.name === 'מלא רגיל');
  assert.ok(full && full.period.includes('2026-08-10 14:00') && full.period.includes('2026-08-11 14:00'), JSON.stringify(full));
  const dep = rows.find((r) => r.name === 'נהג יוצא');
  const arr = rows.find((r) => r.name === 'נהג חוזר');
  assert.ok(dep && dep.period.includes('2026-08-10 14:00') && dep.period.includes('2026-08-11 08:00'), JSON.stringify(dep));
  assert.ok(arr && arr.period.includes('2026-08-11 08:00') && arr.period.includes('2026-08-11 14:00'), JSON.stringify(arr));
  // readiness rows never block overlap
  for (const r of rows) assert.equal(r.blocks_overlap, false, JSON.stringify(r));
});

test('readiness pair: split seat passes validation (coverage + driver)', async () => {
  const f = await validateDay(D);
  assert.deepEqual(f.filter((x) => x.rule === 'coverage'), [], JSON.stringify(f));
  assert.deepEqual(f.filter((x) => x.rule === 'availability'), [], JSON.stringify(f));
  assert.deepEqual(f.filter((x) => x.severity === 'error'), [], JSON.stringify(f));
});
