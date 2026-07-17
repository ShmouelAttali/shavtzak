import './env.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshSchema, seedSoldiers, closePool, query } from './helpers.js';
import { generate, persist } from '../src/generate.js';
import { validateDay } from '../src/validate.js';
import { RationaleEntry } from '../src/rationale.js';

const D1 = '2026-08-10', D2 = '2026-08-11';

// H6b pair handover — the 25/07 real-world case: a seat's dedicated pair
// consists of one candidate leaving on the 10:00 bus and one returning on it.
// No candidate covers the whole 14:00→14:00 window, but together they do —
// and both come from the seat's own list, so "no substitutes" holds.
before(async () => {
  await freshSchema();
  await seedSoldiers();
  await query(`update positions set is_scheduled = false
               where name not in ('חפק', 'מנוחה', 'בבית')`);
  await query(`update soldiers set role = 'מ"פ' where full_name = 'חייל 55'`);
  await query(`update positions set config = config || $1::jsonb
               where name = 'חפק'`, [JSON.stringify({
    seat_rules: [
      { sub: 'מפקד', roles: ['מ"פ'], commander: true },
      { sub: 'קשר', soldiers: ['חייל 20'], ordered: true },
      { sub: 'חובש', soldiers: ['חייל 23', 'חייל 24'] },
      { sub: 'נהג', soldiers: ['חייל 25'] },
    ],
  })]);
  // חייל 23 departs on D1's mid-window bus; חייל 24 returns on it
  await query(`insert into unavailability (soldier_id, period, kind)
               select id, tsrange('2026-08-11 10:00', '2026-08-14 10:00'), 'חופש'
               from soldiers where full_name = 'חייל 23'`);
  await query(`insert into unavailability (soldier_id, period, kind)
               select id, tsrange('2026-08-08 10:00', '2026-08-11 10:00'), 'חופש'
               from soldiers where full_name = 'חייל 24'`);
  for (const d of [D1, D2]) await persist(await generate(d));
});
after(closePool);

const seatRows = (day: string, sub: string) => query<{
  name: string; period: string; rationale: RationaleEntry[];
}>(`
  select s.full_name name, sa.period::text period, sa.rationale
  from shift_assignments sa
  join soldiers s on s.id = sa.soldier_id
  join positions p on p.id = sa.position_id
  join sub_positions sp on sp.id = sa.sub_position_id
  where sa.day = $1 and p.name = 'חפק' and sp.name = $2
  order by lower(sa.period)`, [day, sub]);

test('H6b pair: dedicated candidates split the seat at the 10:00 handover', async () => {
  const rows = await seatRows(D1, 'חובש');
  assert.equal(rows.length, 2, JSON.stringify(rows));
  const [dep, arr] = rows;
  assert.equal(dep.name, 'חייל 23');
  assert.ok(dep.period.includes('2026-08-10 14:00') && dep.period.includes('2026-08-11 10:00'), dep.period);
  assert.equal(arr.name, 'חייל 24');
  assert.ok(arr.period.includes('2026-08-11 10:00') && arr.period.includes('2026-08-11 14:00'), arr.period);
  assert.ok(dep.rationale.some((e) => e.code === 'handover_out' && e.params?.handover === '10:00'),
    JSON.stringify(dep.rationale));
  assert.ok(arr.rationale.some((e) => e.code === 'handover_in' && e.params?.handover === '10:00'),
    JSON.stringify(arr.rationale));
  // both members carry the seat_rule rationale (picked from the dedicated list)
  for (const r of rows) assert.ok(r.rationale.some((e) => e.code === 'seat_rule'), JSON.stringify(r.rationale));
});

test('H6b pair: both members hold the position at Level 1', async () => {
  const rows = await query<{ name: string }>(`
    select s.full_name name from day_assignments d
    join soldiers s on s.id = d.soldier_id
    join positions p on p.id = d.position_id
    where d.day = $1 and p.name = 'חפק' and s.full_name in ('חייל 23', 'חייל 24')`, [D1]);
  assert.equal(rows.length, 2, JSON.stringify(rows));
});

test('H6b pair: split seat passes validation (coverage, availability, seat rules)', async () => {
  const f = await validateDay(D1);
  assert.deepEqual(f.filter((x) => ['coverage', 'availability', 'seat_rules'].includes(x.rule)), [],
    JSON.stringify(f));
});

test('H6b pair: a single fully-available candidate is still preferred', async () => {
  // on D2 חייל 23 is fully home and חייל 24 fully available → one full-window row
  const rows = await seatRows(D2, 'חובש');
  assert.equal(rows.length, 1, JSON.stringify(rows));
  assert.equal(rows[0].name, 'חייל 24');
  assert.ok(rows[0].period.includes('2026-08-11 14:00') && rows[0].period.includes('2026-08-12 14:00'), rows[0].period);
  assert.ok(!rows[0].rationale.some((e) => e.code === 'handover_in'), JSON.stringify(rows[0].rationale));
});

test('no same-position-as-yesterday caveat for structurally fixed crews (חפק)', async () => {
  // חייל 24 held the חובש seat on D1 (pair half) and again on D2 — the crew is
  // locked by seat rules, so repeating is not a rotation fact
  const rows = await seatRows(D2, 'חובש');
  assert.ok(!rows[0].rationale.some((e) => e.code === 'caveat_same_position'),
    JSON.stringify(rows[0].rationale));
});
