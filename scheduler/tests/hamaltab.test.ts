// חמל is MANUAL-ONLY (positions.is_scheduled=false): the generator never
// auto-fills it — a role-חמל soldier is left unassigned unless the חמל tab
// places him, and חמל slot_templates present on a day do NOT trigger auto-fill.
// The other staff_all_roles crew (מפלג, is_scheduled=true) still auto-fills.
// Manual per-shift picks survive regeneration and reserve the soldier for the day.
import './env.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshSchema, seedSoldiers, soldierId, closePool, query } from './helpers.js';
import { generate, persist } from '../src/generate.js';

const D = '2026-08-01';

async function crewOf(day: string, posName: string): Promise<string[]> {
  const rows = await query<{ full_name: string }>(`
    select s.full_name from shift_assignments sa
    join positions p on p.id = sa.position_id
    join soldiers s on s.id = sa.soldier_id
    where sa.day = $1 and p.name = $2 order by s.full_name`, [day, posName]);
  return rows.map((r) => r.full_name);
}
const hamalCrew = (day: string) => crewOf(day, 'חמל');

before(async () => {
  await freshSchema();
  await seedSoldiers();
  // two role-חמל soldiers (must NOT be auto-assigned anywhere) + one מפלג staff
  // (role רס"פ — MUST still be auto-assigned to מפלג).
  await query(`insert into soldiers (personal_number, full_name, platoon, role, rifle_level)
               values ('H001', 'חמלניק א', '1', 'חמל', 0),
                      ('H002', 'חמלניק ב', '2', 'חמל', 0),
                      ('P001', 'מפלגניק', 'מפלג', 'רס"פ', 0)`);
});
after(closePool);

test('generator does NOT auto-fill חמל (manual-only) but STILL auto-fills מפלג', async () => {
  await persist(await generate(D));
  // role-חמל soldiers are left unassigned to חמל (no auto role fill)
  assert.deepEqual(await hamalCrew(D), []);
  // and they are not seated anywhere else either (H6c restricts them to חמל)
  const hamalElsewhere = await query(`
    select 1 from shift_assignments sa join soldiers s on s.id = sa.soldier_id
    where sa.day = $1 and s.full_name in ('חמלניק א','חמלניק ב')`, [D]);
  assert.deepEqual(hamalElsewhere, [], 'role-חמל soldiers are unassigned when the tab is unused');
  // מפלג staff crew is still auto-filled
  assert.deepEqual(await crewOf(D, 'מפלג'), ['מפלגניק']);
});

test('חמל slot_templates present on a day are STILL not auto-filled', async () => {
  const D2 = '2026-08-02';
  const hamalId = (await query<{ id: number }>(`select id from positions where name = 'חמל'`))[0].id;
  await query(`insert into schedule_days (day) values ($1) on conflict do nothing`, [D2]);
  // a day-scoped חמל slot_template (as the חמל tab would write) — but NO picks
  await query(`insert into slot_templates
                 (position_id, start_time, duration_minutes, seats, valid_from, valid_to)
               values ($1, '14:00', 480, 3, $2, $2)`, [hamalId, D2]);
  await persist(await generate(D2));
  assert.deepEqual(await hamalCrew(D2), [], 'is_scheduled=false ⇒ generator ignores the חמל slot');
});

test('manual PER-SHIFT rows are authoritative and survive regen; the soldier is reserved', async () => {
  // pick a regular לוחם manually across TWO shift windows (mimics api/hamal.ts):
  // per-shift locked/manual חמל rows + one locked/manual day_assignments bucket
  const picked = await soldierId('חייל 40');
  const hamalId = (await query<{ id: number }>(`select id from positions where name = 'חמל'`))[0].id;
  await query(`insert into shift_assignments
                 (day, position_id, soldier_id, period, seat_index, is_commander_seat,
                  source, blocks_overlap, locked)
               values ($1, $2, $3, tsrange($1::date + interval '14 hours', $1::date + interval '22 hours'),
                       1, false, 'manual', false, true),
                      ($1, $2, $3, tsrange($1::date + interval '22 hours', $1::date + interval '30 hours'),
                       1, false, 'manual', false, true)`,
    [D, hamalId, picked]);
  await query(`insert into day_assignments (day, soldier_id, position_id, source, locked)
               values ($1, $2, $3, 'manual', true)
               on conflict (day, soldier_id) do update
                 set position_id = excluded.position_id, source = 'manual', locked = true`,
    [D, picked, hamalId]);

  await persist(await generate(D));

  // both manual shift rows for the same soldier remain (and no auto crew appears)
  assert.deepEqual(await hamalCrew(D), ['חייל 40', 'חייל 40']);
  const meta = await query<{ source: string; locked: boolean }>(`
    select sa.source, sa.locked from shift_assignments sa
    join positions p on p.id = sa.position_id
    join soldiers s on s.id = sa.soldier_id
    where sa.day = $1 and p.name = 'חמל' and s.full_name = 'חייל 40'`, [D]);
  assert.equal(meta.length, 2);
  assert.ok(meta.every((m) => m.source === 'manual' && m.locked));

  // the picked לוחם holds no OTHER position (pinned to חמל via the day lock)
  const elsewhere = await query(`
    select 1 from shift_assignments sa
    join positions p on p.id = sa.position_id
    where sa.day = $1 and sa.soldier_id = $2 and p.name <> 'חמל'`, [D, picked]);
  assert.deepEqual(elsewhere, []);
});

test('clearing the manual picks leaves חמל empty (no auto fill)', async () => {
  const hamalId = (await query<{ id: number }>(`select id from positions where name = 'חמל'`))[0].id;
  await query(`delete from shift_assignments where day = $1 and position_id = $2 and (locked or source = 'manual')`, [D, hamalId]);
  await query(`delete from day_assignments where day = $1 and position_id = $2 and (locked or source = 'manual')`, [D, hamalId]);

  await persist(await generate(D));
  assert.deepEqual(await hamalCrew(D), []);
});
