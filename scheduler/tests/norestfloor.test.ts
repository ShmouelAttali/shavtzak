// Per-position no_rest_floor (owner decision 2026-07-19): מגן / חפק / קצין
// מוצב are scheduled internally by their officer, so a soldier may be
// assigned to the daily row with NO rest before it — neither fits() nor the
// validator blocks the entry gap. תורנים (also daily) keeps the 4h floor.
import './env.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshSchema, closePool, query } from './helpers.js';
import { generate, persist } from '../src/generate.js';
import { validateDay } from '../src/validate.js';

const Y = '2026-08-10', D = '2026-08-11';   // consecutive weekdays (Mon/Tue)

before(async () => {
  await freshSchema();
  // מגן-only world; a single available fighter, forced to man מגן both days
  await query(`update positions set is_scheduled = false
               where name not in ('מגן', 'מנוחה', 'בבית')`);
  // shrink מגן to 1 seat so the fixture is deterministic
  await query(`update slot_templates set seats = 1
               where position_id = (select id from positions where name = 'מגן')`);
  await query(`update positions
               set config = jsonb_set(config, '{flex_seats}', '{"min":1,"max":1}')
               where name = 'מגן'`);
  await query(`insert into soldiers (personal_number, full_name, platoon, role, rifle_level)
               values ('N01', 'ללא מנוחה', '1', 'לוחם', 3)`);
});
after(closePool);

test('no_rest_floor: מגן accepts a soldier back-to-back with zero rest', async () => {
  // day Y: the soldier mans מגן 14:00→14:00; day D: he mans it again, the
  // previous row ending exactly at D's 14:00 start ⇒ zero rest gap
  await persist(await generate(Y));
  const res = await generate(D);
  await persist(res);
  const rows = await query<{ full_name: string }>(`
    select s.full_name from shift_assignments sa
    join positions p on p.id = sa.position_id
    join soldiers s on s.id = sa.soldier_id
    where sa.day = $1 and p.name = 'מגן'`, [D]);
  assert.equal(rows.length, 1, 'מגן seat filled on day D');
  assert.equal(rows[0].full_name, 'ללא מנוחה', 'the only fighter mans it');
  // no leftover-in-מנוחה issue and no rest error/finding
  assert.ok(!res.issues.some((i) => i.includes('נותר במנוחה')), JSON.stringify(res.issues));
  const findings = await validateDay(D);
  assert.deepEqual(findings.filter((f) => f.rule === 'rest'), [],
    `no rest finding expected: ${JSON.stringify(findings)}`);
});

test('config flag is per-position: תורנים keeps the 4h rest floor', async () => {
  // sanity: the flag is read from config, not hardcoded — תורנים has no flag
  const [t] = await query<{ has: boolean }>(`
    select coalesce((config->>'no_rest_floor')::boolean, false) has
    from positions where name = 'תורנים'`);
  assert.equal(t.has, false, 'תורנים must NOT carry no_rest_floor');
  const [m] = await query<{ has: boolean }>(`
    select coalesce((config->>'no_rest_floor')::boolean, false) has
    from positions where name = 'מגן'`);
  assert.equal(m.has, true, 'מגן must carry no_rest_floor');
});
