// Hand-built validator coverage for the rules overhaul: T6 on-call streak,
// R3 tracker night-only fairness load (SQL function), the hard rest floor,
// the H6d driver rule, the H6-pool gate, and the מפלג role restriction.
import './env.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshSchema, seedSoldiers, soldierId, closePool, query } from './helpers.js';
import { validateDay } from '../src/validate.js';

// on-call streak days (3 consecutive)
const E1 = '2026-09-18', E2 = '2026-09-19', E3 = '2026-09-20';
// isolated hand-built days
const F1 = '2026-10-02', F2 = '2026-10-03', G = '2026-10-06', H = '2026-10-09';

async function manualRow(name: string, position: string, day: string, start: string, end: string) {
  const sid = await soldierId(name);
  await query(`insert into schedule_days (day) values ($1) on conflict do nothing`, [day]);
  // seat_index auto-increments per (day, position, period) — the seat
  // uniqueness index rejects two rows on the same seat
  await query(`
    insert into shift_assignments (day, position_id, soldier_id, period, source, blocks_overlap, seat_index)
    select $1, p.id, $3, tsrange($4::timestamp, $5::timestamp), 'manual',
           p.mission_class <> 'readiness',
           coalesce((select max(sa.seat_index) + 1 from shift_assignments sa
                     where sa.day = $1 and sa.position_id = p.id
                       and sa.period = tsrange($4::timestamp, $5::timestamp)), 1)
    from positions p where p.name = $2`, [day, position, sid, start, end]);
  return sid;
}

before(async () => {
  await freshSchema();
  await seedSoldiers();
});
after(closePool);

test('T6: three consecutive days of static-only work → oncall_streak warning', async () => {
  for (const d of [E1, E2, E3]) {
    await manualRow('חייל 45', 'עמדות הגנה', d, `${d} 14:00`, `${d} 18:00`);
  }
  const f = await validateDay(E3);
  const hits = f.filter((x) => x.rule === 'oncall_streak' && x.message.includes('חייל 45'));
  assert.equal(hits.length, 1, JSON.stringify(f.filter((x) => x.rule === 'oncall_streak')));
  assert.equal(hits[0].severity, 'warning');
  assert.ok(hits[0].message.includes('3'), hits[0].message);
});

test('T6 negative: a dynamic (סיור) day in the middle breaks the on-call streak', async () => {
  await manualRow('חייל 46', 'עמדות הגנה', E1, `${E1} 14:00`, `${E1} 18:00`);
  await manualRow('חייל 46', 'סיור', E2, `${E2} 14:00`, `${E2} 22:00`);
  await manualRow('חייל 46', 'עמדות הגנה', E3, `${E3} 14:00`, `${E3} 18:00`);
  const f = await validateDay(E3);
  assert.deepEqual(f.filter((x) => x.rule === 'oncall_streak' && x.message.includes('חייל 46')), []);
});

test('R3: only the גשש night window counts toward tracker_hours_total', async () => {
  // day window 14:00–22:00 → no tracker load
  const dayGuy = await manualRow('חייל 47', 'כונן גשש', E1, `${E1} 14:00`, `${E1} 22:00`);
  // night window 22:00–07:00 (overlaps the schedule day's night) → full 9h
  const nightGuy = await manualRow('חייל 48', 'כונן גשש', E1, `${E1} 22:00`, `${E2} 07:00`);
  const rows = await query<{ soldier_id: number; tracker_hours_total: string }>(`
    select soldier_id, tracker_hours_total from soldier_fairness($1)
    where soldier_id in ($2, $3)`, [E2, dayGuy, nightGuy]);
  const byId = new Map(rows.map((r) => [Number(r.soldier_id), Number(r.tracker_hours_total)]));
  assert.equal(byId.get(Number(dayGuy)), 0, 'day window is free of tracker load');
  assert.equal(byId.get(Number(nightGuy)), 9, 'night window counts in full');
});

test('hard rest floor: a 2h gap between missions is a rest error', async () => {
  await manualRow('חייל 49', 'עמדות הגנה', H, `${H} 14:00`, `${H} 18:00`);
  await manualRow('חייל 49', 'עמדות הגנה', H, `${H} 20:00`, `2026-10-10 00:00`);
  const f = await validateDay(H);
  assert.ok(f.some((x) => x.rule === 'rest' && x.severity === 'error'
    && x.message.includes('חייל 49')), JSON.stringify(f.filter((x) => x.rule === 'rest')));
});

test('H6d validator: a full סיור crew without a נהג דוד → driver error; with one → clean', async () => {
  for (const n of ['חייל 30', 'חייל 31', 'חייל 32', 'חייל 33']) {
    await manualRow(n, 'סיור', F1, `${F1} 14:00`, `${F1} 22:00`);
  }
  let f = await validateDay(F1);
  assert.ok(f.some((x) => x.rule === 'driver' && x.severity === 'error'
    && x.message.includes('סיור') && x.message.includes('נהג דוד')),
    JSON.stringify(f.filter((x) => x.rule === 'driver')));

  // negative: crew carrying חייל 11 (נהג דוד) raises no driver finding
  for (const n of ['חייל 11', 'חייל 34', 'חייל 35', 'חייל 36']) {
    await manualRow(n, 'סיור', F2, `${F2} 14:00`, `${F2} 22:00`);
  }
  f = await validateDay(F2);
  assert.deepEqual(f.filter((x) => x.rule === 'driver'), []);
});

test('H6-pool validator: non-pool soldier on קצין מוצב → role_gate error', async () => {
  const sid = await manualRow('חייל 30', 'קצין מוצב', G, `${G} 14:00`, `2026-10-07 14:00`);
  const f = await validateDay(G);
  assert.ok(f.some((x) => x.rule === 'role_gate' && x.severity === 'error' && x.soldierId === sid
    && x.message.includes('ברשימת המועמדים')),
    JSON.stringify(f.filter((x) => x.rule === 'role_gate')));
});

test('מפלג restriction: a רס"פ soldier manually put on עמדות הגנה → allowed_positions error', async () => {
  await query(`insert into soldiers (personal_number, full_name, platoon, role, rifle_level)
               values ('S090', 'רספ בדיקה', '1', 'רס"פ', 0)`);
  const sid = await manualRow('רספ בדיקה', 'עמדות הגנה', G, `${G} 14:00`, `${G} 18:00`);
  const f = await validateDay(G);
  assert.ok(f.some((x) => x.rule === 'allowed_positions' && x.severity === 'error'
    && x.soldierId === sid && x.message.includes('מפלג')),
    JSON.stringify(f.filter((x) => x.rule === 'allowed_positions')));
});
