// slot_templates versioning: a day before the 2026-07-19 cutover uses the old
// 06:00-22:00 מגן window; from the cutover it runs 14:00-14:00 (SPEC §2
// boundary rule). Also guards the new no-overlap EXCLUDE constraint.
import './env.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshSchema, seedSoldiers, closePool, query } from './helpers.js';
import { generate, persist } from '../src/generate.js';

const OLD_DAY = '2026-07-17';   // before the cutover
const NEW_DAY = '2026-07-19';   // cutover day

before(async () => {
  await freshSchema();
  await seedSoldiers();
  // the fixture mirrors the live DB's closed pre-cutover מגן version
  // (the consolidated seed only carries the current 14:00-14:00 row)
  await query(`insert into slot_templates
                 (position_id, start_time, duration_minutes, seats, valid_from, valid_to)
               values ((select id from positions where name = 'מגן'), '06:00', 960, 10,
                       '2026-07-15', '2026-07-18')`);
});
after(closePool);

test('day_slots: pre-cutover day resolves the old 06:00-22:00 מגן window', async () => {
  await query(`insert into schedule_days (day) values ($1), ($2) on conflict do nothing`,
    [OLD_DAY, NEW_DAY]);
  const rows = await query<{ day: string; period: string }>(`
    select ds.day::text, ds.period::text from day_slots ds
    join positions p on p.id = ds.position_id
    where p.name = 'מגן' and ds.day in ($1, $2) order by ds.day`, [OLD_DAY, NEW_DAY]);
  assert.equal(rows.length, 2, JSON.stringify(rows));
  // 06:00 start lands on the next calendar morning inside schedule day 17/7
  assert.ok(rows[0].period.includes('2026-07-18 06:00') && rows[0].period.includes('2026-07-18 22:00'),
    `old window: ${rows[0].period}`);
  assert.ok(rows[1].period.includes('2026-07-19 14:00') && rows[1].period.includes('2026-07-20 14:00'),
    `new window: ${rows[1].period}`);
});

test('generator fills מגן with the version in force on each side of the cutover', async () => {
  await persist(await generate(OLD_DAY));
  await persist(await generate(NEW_DAY));
  const dist = async (d: string) => query<{ period: string; n: string }>(`
    select sa.period::text, count(*) n from shift_assignments sa
    join positions p on p.id = sa.position_id
    where p.name = 'מגן' and sa.day = $1 group by 1`, [d]);
  const oldRows = await dist(OLD_DAY);
  assert.equal(oldRows.length, 1, JSON.stringify(oldRows));
  assert.ok(oldRows[0].period.includes('2026-07-18 06:00'), oldRows[0].period);
  assert.equal(Number(oldRows[0].n), 10);
  const newRows = await dist(NEW_DAY);
  assert.equal(newRows.length, 1, JSON.stringify(newRows));
  assert.ok(newRows[0].period.includes('2026-07-19 14:00'), newRows[0].period);
  assert.equal(Number(newRows[0].n), 10);
});

test('slot_templates no-overlap EXCLUDE rejects a version overlapping an active one', async () => {
  await assert.rejects(
    query(`insert into slot_templates (position_id, start_time, duration_minutes, seats, valid_from)
           values ((select id from positions where name = 'מגן'), '14:00', 1440, 10, '2026-07-20')`),
    /slot_templates_no_overlap/);
});
