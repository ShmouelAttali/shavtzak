// H1 pair rejection: a would-be pair half that fails the rest floor (בדוחק)
// must NOT form a pair — no בדוחק halves (SPEC H1).
import './env.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshSchema, closePool, query } from './helpers.js';
import { generate, persist } from '../src/generate.js';

const D = '2026-08-10';

// Same controlled world as pairs.test.ts (only תורנים generated; seat 2 could
// only be covered by the departing+arriving pair) — but here the DEPARTING
// candidate finished a shift 3h before the slot start (rest < 4h → his half
// would be בדוחק), so the pair must not form and the seat stays empty.
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
  // the departing candidate's previous shift ends 11:00 — only 3h before the
  // 14:00 slot start (under the 4h floor)
  await query(`insert into schedule_days (day) values ('2026-08-09') on conflict do nothing`);
  await query(`insert into shift_assignments (day, position_id, soldier_id, period, source)
               select '2026-08-09', (select id from positions where name = 'סיור'), id,
                      tsrange('2026-08-10 08:00', '2026-08-10 11:00'), 'manual'
               from soldiers where full_name = 'יוצא צהריים'`);
  await persist(await generate(D));
});
after(closePool);

test('H1 pair NOT formed when the departing half fails the rest floor', async () => {
  const rows = await query<{ name: string }>(`
    select s.full_name name from shift_assignments sa
    join soldiers s on s.id = sa.soldier_id
    join positions p on p.id = sa.position_id
    where sa.day = $1 and p.name = 'תורנים'`, [D]);
  const names = rows.map((r) => r.name);
  assert.ok(!names.includes('יוצא צהריים'), `בדוחק half must not be paired: ${JSON.stringify(names)}`);
  assert.ok(!names.includes('חוזר בוקר'), `no partner — arriving half alone covers nothing: ${JSON.stringify(names)}`);
});

test('the uncovered seat is reported (issue at generation)', async () => {
  const res = await generate(D);
  assert.ok(res.issues.some((i) => i.includes('תורנים') && i.includes('לא אויש')),
    JSON.stringify(res.issues));
});
