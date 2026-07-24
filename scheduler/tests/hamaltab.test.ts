// חמל tab (Task 8): "manual replaces auto-staffing". A day with manual/locked
// חמל rows is authoritative — the generator skips its auto role-based
// (staff_all_roles) fill for that day, and the manual picks survive persist().
import './env.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshSchema, seedSoldiers, soldierId, closePool, query } from './helpers.js';
import { generate, persist } from '../src/generate.js';

const D = '2026-08-01';

async function hamalCrew(day: string): Promise<string[]> {
  const rows = await query<{ full_name: string }>(`
    select s.full_name from shift_assignments sa
    join positions p on p.id = sa.position_id
    join soldiers s on s.id = sa.soldier_id
    where sa.day = $1 and p.name = 'חמל' order by s.full_name`, [day]);
  return rows.map((r) => r.full_name);
}

before(async () => {
  await freshSchema();
  await seedSoldiers();
  // two role-חמל soldiers — the auto staff_all_roles fill would pin them to חמל
  await query(`insert into soldiers (personal_number, full_name, platoon, role, rifle_level)
               values ('H001', 'חמלניק א', '1', 'חמל', 0),
                      ('H002', 'חמלניק ב', '2', 'חמל', 0)`);
});
after(closePool);

test('baseline: role-חמל soldiers are auto-assigned to חמל', async () => {
  await persist(await generate(D));
  assert.deepEqual(await hamalCrew(D), ['חמלניק א', 'חמלניק ב'].sort());
});

test('manual replaces auto: locked חמל picks are authoritative; auto role fill is skipped', async () => {
  // pick a regular לוחם manually (mimics api/hamal.ts): a locked/manual חמל
  // shift row + a locked/manual day_assignments bucket
  const picked = await soldierId('חייל 40');
  const hamalId = (await query<{ id: number }>(`select id from positions where name = 'חמל'`))[0].id;
  // the חמל tab resets the day's חמל rows before writing the manual picks
  // (api/hamal.ts) — remove the baseline auto rows first
  await query(`delete from shift_assignments where day = $1 and position_id = $2`, [D, hamalId]);
  await query(`delete from day_assignments where day = $1 and position_id = $2`, [D, hamalId]);
  await query(`insert into shift_assignments
                 (day, position_id, soldier_id, period, seat_index, is_commander_seat,
                  source, blocks_overlap, locked)
               values ($1, $2, $3, day_range($1), 1, false, 'manual', false, true)`,
    [D, hamalId, picked]);
  await query(`insert into day_assignments (day, soldier_id, position_id, source, locked)
               values ($1, $2, $3, 'manual', true)
               on conflict (day, soldier_id) do update
                 set position_id = excluded.position_id, source = 'manual', locked = true`,
    [D, picked, hamalId]);

  await persist(await generate(D));

  // the manual pick is the entire חמל crew — the role-חמל soldiers are NOT
  // auto-added (manual wins)
  assert.deepEqual(await hamalCrew(D), ['חייל 40']);

  // the manual row survived persist with its source/lock intact
  const meta = await query<{ source: string; locked: boolean }>(`
    select sa.source, sa.locked from shift_assignments sa
    join positions p on p.id = sa.position_id
    join soldiers s on s.id = sa.soldier_id
    where sa.day = $1 and p.name = 'חמל' and s.full_name = 'חייל 40'`, [D]);
  assert.equal(meta[0]?.source, 'manual');
  assert.equal(meta[0]?.locked, true);

  // the picked לוחם holds no OTHER position (pinned to חמל via the day lock)
  const elsewhere = await query(`
    select 1 from shift_assignments sa
    join positions p on p.id = sa.position_id
    where sa.day = $1 and sa.soldier_id = $2 and p.name <> 'חמל'`, [D, picked]);
  assert.deepEqual(elsewhere, []);
});

test('clearing the manual picks restores auto role-based fill', async () => {
  const hamalId = (await query<{ id: number }>(`select id from positions where name = 'חמל'`))[0].id;
  await query(`delete from shift_assignments where day = $1 and position_id = $2 and (locked or source = 'manual')`, [D, hamalId]);
  await query(`delete from day_assignments where day = $1 and position_id = $2 and (locked or source = 'manual')`, [D, hamalId]);

  await persist(await generate(D));
  assert.deepEqual(await hamalCrew(D), ['חמלניק א', 'חמלניק ב'].sort());
});
