import './env.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshSchema, closePool, query } from './helpers.js';
import { generate, persist } from '../src/generate.js';
import { validateDay } from '../src/validate.js';
import { RationaleEntry } from '../src/rationale.js';

const D = '2026-08-10';

// H1 replacement pairs — controlled scenario: only תורנים (2 seats,
// 14:00→14:00) is generated. Roster: one fully-available soldier, one
// departing at 10:00 (bus-at-10 semantics: home block starts 2026-08-11
// 10:00), one returning at 10:00 (home block ends 2026-08-11 10:00).
// Seat 1 must go to the fully-available soldier (single soldier preferred);
// seat 2 can only be covered by the departing+arriving pair.
before(async () => {
  await freshSchema();
  await query(`update positions set is_scheduled = false
               where name not in ('תורנים', 'מנוחה', 'בבית')`);
  await query(`insert into soldiers (personal_number, full_name, platoon, role, rifle_level) values
    ('P001', 'מלא אחד', '1', 'לוחם', 3),
    ('P002', 'יוצא צהריים', '1', 'לוחם', 3),
    ('P003', 'חוזר בוקר', '1', 'לוחם', 3)`);
  await query(`insert into unavailability (soldier_id, period, kind)
               select id, tsrange('2026-08-11 10:00', '2026-08-13 10:00'), 'חופש'
               from soldiers where full_name = 'יוצא צהריים'`);
  await query(`insert into unavailability (soldier_id, period, kind)
               select id, tsrange('2026-08-09 10:00', '2026-08-11 10:00'), 'חופש'
               from soldiers where full_name = 'חוזר בוקר'`);
  await persist(await generate(D));
});
after(closePool);

test('H1 pair: departing+arriving split the seat at the 10:00 handover', async () => {
  const rows = await query<{ name: string; period: string }>(`
    select s.full_name name, sa.period::text period
    from shift_assignments sa
    join soldiers s on s.id = sa.soldier_id
    join positions p on p.id = sa.position_id
    where sa.day = $1 and p.name = 'תורנים'
    order by lower(sa.period), s.full_name`, [D]);
  assert.equal(rows.length, 3, JSON.stringify(rows));
  // a single fully-available soldier is preferred for seat 1 (full 24h row)
  const full = rows.find((r) => r.name === 'מלא אחד');
  assert.ok(full && full.period.includes('2026-08-10 14:00') && full.period.includes('2026-08-11 14:00'), JSON.stringify(full));
  // the pair splits seat 2 at the handover
  const dep = rows.find((r) => r.name === 'יוצא צהריים');
  const arr = rows.find((r) => r.name === 'חוזר בוקר');
  assert.ok(dep && dep.period.includes('2026-08-10 14:00') && dep.period.includes('2026-08-11 10:00'), JSON.stringify(dep));
  assert.ok(arr && arr.period.includes('2026-08-11 10:00') && arr.period.includes('2026-08-11 14:00'), JSON.stringify(arr));
});

test('H1 pair: both halves carry handover rationale + replacement note', async () => {
  const rows = await query<{ name: string; violations: string[]; rationale: RationaleEntry[] }>(`
    select s.full_name name, sa.violations, sa.rationale
    from shift_assignments sa
    join soldiers s on s.id = sa.soldier_id
    join positions p on p.id = sa.position_id
    where sa.day = $1 and p.name = 'תורנים'
      and s.full_name in ('יוצא צהריים', 'חוזר בוקר')`, [D]);
  assert.equal(rows.length, 2);
  for (const r of rows) {
    const expected = r.name === 'יוצא צהריים' ? 'handover_out' : 'handover_in';
    assert.ok(r.rationale.some((e) => e.code === expected && e.params?.handover === '10:00'),
      `${r.name}: ${JSON.stringify(r.rationale)}`);
    assert.ok(r.violations.some((v) => v.includes('זוג מתחלף')), JSON.stringify(r.violations));
  }
});

test('H1 pair: validation passes — split seat counts as fully staffed', async () => {
  const f = await validateDay(D);
  assert.deepEqual(f.filter((x) => x.rule === 'coverage'), [], JSON.stringify(f));
  assert.deepEqual(f.filter((x) => x.rule === 'availability'), [], JSON.stringify(f));
  assert.deepEqual(f.filter((x) => x.severity === 'error'), [], JSON.stringify(f));
});

test('partial coverage is still flagged once the arriving half is gone', async () => {
  await query(`delete from shift_assignments sa using soldiers s
               where sa.soldier_id = s.id and sa.day = $1 and s.full_name = 'חוזר בוקר'`, [D]);
  const f = await validateDay(D);
  assert.ok(f.some((x) => x.rule === 'coverage' && x.severity === 'error'
    && x.message.includes('תורנים') && x.message.includes('1/2')), JSON.stringify(f));
});
