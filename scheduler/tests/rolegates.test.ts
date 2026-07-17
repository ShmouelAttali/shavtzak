// H6 role gates (validator `role_gate`), H6b seat qualification guard
// (`seat_qualification`), and the H6b commander-seat marking check.
import './env.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshSchema, seedSoldiers, soldierId, closePool, query } from './helpers.js';
import { generate, persist } from '../src/generate.js';
import { validateDay } from '../src/validate.js';

const D = '2026-09-01';
const G = '2026-08-01';   // generated day (clean baseline)

before(async () => {
  await freshSchema();
  await seedSoldiers();
  await query(`insert into schedule_days (day) values ($1)`, [D]);
  // synthetic חפק seat rules: single-candidate seats, חובש carries a qual guard
  await query(`update soldiers set role = 'מ"פ' where full_name = 'חייל 55'`);
  await query(`update positions set config = config || $1::jsonb where name = 'חפק'`, [JSON.stringify({
    seat_rules: [
      { sub: 'מפקד', roles: ['מ"פ'], commander: true },
      { sub: 'קשר', soldiers: ['חייל 20'], ordered: true, release_unpicked: true },
      { sub: 'חובש', soldiers: ['חייל 23'], qual: 'חובש' },
      { sub: 'נהג', soldiers: ['חייל 25'], qual: 'נהג דוד' },
    ],
  })]);
});
after(closePool);

async function manualRow(name: string, position: string, start: string, end: string,
                         opts: { commanderSeat?: boolean } = {}) {
  const sid = await soldierId(name);
  await query(`
    insert into shift_assignments (day, position_id, soldier_id, period, source, blocks_overlap, is_commander_seat)
    select $1, p.id, $3, tsrange($4::timestamp, $5::timestamp), 'manual',
           p.mission_class <> 'readiness', $6
    from positions p where p.name = $2`,
    [D, position, sid, start, end, opts.commanderSeat ?? false]);
  return sid;
}

test('role_gate: non-senior on קצין מוצב → error', async () => {
  const sid = await manualRow('חייל 30', 'קצין מוצב', '2026-09-01 14:00', '2026-09-02 14:00');
  const f = await validateDay(D);
  assert.ok(f.some((x) => x.rule === 'role_gate' && x.severity === 'error' && x.soldierId === sid
    && x.message.includes('קצין מוצב')), JSON.stringify(f.filter((x) => x.rule === 'role_gate')));
  await query(`delete from shift_assignments where soldier_id = $1`, [sid]);
});

test('role_gate negative: senior commander on קצין מוצב is clean', async () => {
  const sid = await manualRow('חייל 07', 'קצין מוצב', '2026-09-01 14:00', '2026-09-02 14:00'); // סמל
  const f = await validateDay(D);
  assert.ok(!f.some((x) => x.rule === 'role_gate' && x.soldierId === sid), JSON.stringify(f));
  await query(`delete from shift_assignments where soldier_id = $1`, [sid]);
});

test('role_gate: senior commander on עמדות הגנה → error', async () => {
  const sid = await manualRow('חייל 09', 'עמדות הגנה', '2026-09-01 14:00', '2026-09-01 18:00'); // מ"מ
  const f = await validateDay(D);
  assert.ok(f.some((x) => x.rule === 'role_gate' && x.severity === 'error' && x.soldierId === sid
    && x.message.includes('עמדות הגנה')), JSON.stringify(f.filter((x) => x.rule === 'role_gate')));
  await query(`delete from shift_assignments where soldier_id = $1`, [sid]);
});

test('role_gate: commander-first-seat patrol — commander seat held by non-commander → error', async () => {
  const sid = await manualRow('חייל 30', 'סיור', '2026-09-01 14:00', '2026-09-01 22:00',
    { commanderSeat: true });
  const f = await validateDay(D);
  assert.ok(f.some((x) => x.rule === 'role_gate' && x.severity === 'error' && x.soldierId === sid
    && x.message.includes('מושב מפקד')), JSON.stringify(f.filter((x) => x.rule === 'role_gate')));
  await query(`delete from shift_assignments where soldier_id = $1`, [sid]);
});

test('role_gate: staffed commander-first-seat slot without any commander row → error', async () => {
  const sid = await manualRow('חייל 31', 'סיור', '2026-09-01 14:00', '2026-09-01 22:00');
  const f = await validateDay(D);
  assert.ok(f.some((x) => x.rule === 'role_gate' && x.severity === 'error'
    && x.message.includes('אין מפקד')), JSON.stringify(f.filter((x) => x.rule === 'role_gate')));
  await query(`delete from shift_assignments where soldier_id = $1`, [sid]);
});

test('seat_qualification: mismatched qual → generation issue + validator warning; match is silent', async () => {
  // no qual rows yet: חייל 23 (חובש seat) and חייל 25 (נהג seat) both lack them
  const res = await generate(G);
  await persist(res);
  assert.ok(res.issues.some((i) => i.includes('ללא הסמכת חובש')), JSON.stringify(res.issues));
  let f = await validateDay(G);
  const warn = f.filter((x) => x.rule === 'seat_qualification');
  assert.ok(warn.some((x) => x.severity === 'warning' && x.message.includes('חובש')), JSON.stringify(f));
  assert.ok(warn.some((x) => x.severity === 'warning' && x.message.includes('נהג דוד')), JSON.stringify(f));

  // grant the qualifications → silent
  await query(`insert into soldier_qualifications (soldier_id, qualification)
               select id, 'חובש' from soldiers where full_name = 'חייל 23'`);
  await query(`insert into soldier_qualifications (soldier_id, qualification)
               select id, 'נהג דוד' from soldiers where full_name = 'חייל 25'`);
  const res2 = await generate(G);
  await persist(res2);
  assert.ok(!res2.issues.some((i) => i.includes('ללא הסמכת')), JSON.stringify(res2.issues));
  f = await validateDay(G);
  assert.deepEqual(f.filter((x) => x.rule === 'seat_qualification'), []);
});

test('H6b commander seat: manual מפקד-seat row without is_commander_seat → seat_rules error', async () => {
  // replace the generated מפקד row with an unmarked manual one
  const mp = await soldierId('חייל 55');
  await query(`delete from shift_assignments where day = $1 and soldier_id = $2`, [G, mp]);
  await query(`
    insert into shift_assignments (day, position_id, sub_position_id, soldier_id, period, source, is_commander_seat)
    select $1, p.id, sp.id, $2, tsrange(day_start($1), day_start($1) + interval '1 day'), 'manual', false
    from positions p join sub_positions sp on sp.position_id = p.id and sp.name = 'מפקד'
    where p.name = 'חפק'`, [G, mp]);
  const f = await validateDay(G);
  assert.ok(f.some((x) => x.rule === 'seat_rules' && x.severity === 'error'
    && x.message.includes('מושב מפקד')), JSON.stringify(f.filter((x) => x.rule === 'seat_rules')));
});
