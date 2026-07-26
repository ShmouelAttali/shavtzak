// validateDay()'s day_slots SCOPE: the validator judges the same slots the
// צור שבצק / מבנה יומי tabs render — `is_scheduled and mission_class <> 'rest'
// and not (config ? 'staff_all_roles')`, mirroring api/_handlers/day-structure.ts's SCOPE
// constant. A staff_all_roles crew (חמל/מפלג) sizes itself, so its `seats` is a
// cap and not a demand; a non-scheduled position is staffed by hand or not at
// all. Neither may produce a coverage or commander-seat finding.
import './env.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshSchema, seedSoldiers, soldierId, closePool, query } from './helpers.js';
import { validateDay } from '../src/validate.js';

const D = '2026-09-20';

before(async () => {
  await freshSchema();
  await seedSoldiers();
  await query(`insert into schedule_days (day) values ($1)`, [D]);
});
after(closePool);

test('a staff_all_roles slot yields no coverage / commander-seat finding', async () => {
  // מפלג is staff_all_roles (seed.sql id 14) and has a full-day slot template.
  // Make that template demand a commander seat too, then man it with a plain
  // לוחם and leave the rest of its seats empty: with the old scope the slot
  // produced both a `coverage` error and a role_gate "אין מפקד במשמרת".
  await query(`update slot_templates set commander_first_seat = true, seats = 3
               where position_id = (select id from positions where name = 'מפלג')`);
  const sid = await soldierId('חייל 40');
  await query(`
    insert into shift_assignments (day, position_id, soldier_id, period, source, blocks_overlap, seat_index)
    select $1, p.id, $2, tsrange(day_start($1), day_start($1) + interval '1 day'), 'manual', true, 1
    from positions p where p.name = 'מפלג'`, [D, sid]);

  const f = await validateDay(D);
  const about = f.filter((x) => x.message.includes('מפלג'));
  assert.deepEqual(about.filter((x) => x.rule === 'coverage'), [],
    `staff_all_roles seats are a cap, not demand: ${JSON.stringify(about)}`);
  assert.deepEqual(about.filter((x) => x.rule === 'role_gate'), [],
    `a self-sizing staff crew has no commander-seat rule: ${JSON.stringify(about)}`);
  // sanity: the slot really is in day_slots — the finding is absent because of
  // the SCOPE, not because there was nothing to judge
  const [slot] = await query<{ n: string }>(`
    select count(*)::text n from day_slots ds join positions p on p.id = ds.position_id
    where ds.day = $1 and p.name = 'מפלג'`, [D]);
  assert.ok(Number(slot.n) > 0, 'the מפלג slot must exist in day_slots');
});

test('a non-scheduled position never reaches the coverage rule', async () => {
  // חמל is is_scheduled=false — staffed by hand from the חמל tab, never
  // generated. Give it a template slot anyway (the tab's 10:00 tiling does not
  // create day_slots rows, but nothing stops a leftover template) and leave it
  // empty: the validator must not report an unmanned seat the tab never shows.
  await query(`
    insert into slot_templates (position_id, sub_position_id, start_time, duration_minutes, seats, valid_from)
    select p.id, null, '14:00', 240, 2, $1 from positions p where p.name = 'חמל'`, [D]);
  const [slot] = await query<{ n: string }>(`
    select count(*)::text n from day_slots ds join positions p on p.id = ds.position_id
    where ds.day = $1 and p.name = 'חמל'`, [D]);
  assert.ok(Number(slot.n) > 0, 'the חמל slot must exist in day_slots');

  const f = await validateDay(D);
  assert.deepEqual(f.filter((x) => x.rule === 'coverage' && x.message.includes('חמל')), [],
    JSON.stringify(f.filter((x) => x.message.includes('חמל'))));
  await query(`delete from slot_templates where position_id = (select id from positions where name = 'חמל')`);
});
