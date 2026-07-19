import './env.js';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshSchema, soldierId, closePool, query } from './helpers.js';
import { generate, persist } from '../src/generate.js';
import { validateDay } from '../src/validate.js';

// תורנים reclassification (mission_class 'other') + soft weekly rule T5.
const D = '2026-08-25';

async function addSoldier(pn: string, name: string) {
  await query(`insert into soldiers (personal_number, full_name, platoon, role, rifle_level)
               values ($1, $2, '1', 'לוחם', 3)`, [pn, name]);
}

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
}

/** Fresh DB where only תורנים (2 seats, 14:00→14:00) is generated. */
async function toranimOnly() {
  await freshSchema();
  await query(`update positions set is_scheduled = false
               where name not in ('תורנים', 'מנוחה', 'בבית')`);
}

after(closePool);

test('T3: תורנים days no longer create a static streak', async () => {
  await freshSchema();
  await addSoldier('T101', 'תורן רצוף');
  await manualRow('תורן רצוף', 'תורנים', '2026-08-23', '2026-08-23 14:00', '2026-08-24 14:00');
  await manualRow('תורן רצוף', 'תורנים', '2026-08-24', '2026-08-24 14:00', '2026-08-25 14:00');
  await manualRow('תורן רצוף', 'עמדות הגנה', D, '2026-08-25 18:00', '2026-08-25 22:00');
  const f = await validateDay(D);
  assert.ok(!f.some((x) => x.rule === 'static_streak'), JSON.stringify(f));
});

test('T5 soft: recent-תורנות soldier loses תורנים to soldiers without one', async () => {
  await toranimOnly();
  await addSoldier('T102', 'ותיק תורן');
  await addSoldier('T103', 'חדש אחד');
  await addSoldier('T104', 'חדש שניים');
  await manualRow('ותיק תורן', 'תורנים', '2026-08-22', '2026-08-22 14:00', '2026-08-23 14:00');
  // give the others a night patrol the same week: the pre-T5 ranking (P2
  // fewest nights) would have preferred the ותיק — only the T5 key flips it
  await manualRow('חדש אחד', 'סיור', '2026-08-22', '2026-08-22 22:00', '2026-08-23 06:00');
  await manualRow('חדש שניים', 'סיור', '2026-08-22', '2026-08-22 22:00', '2026-08-23 06:00');
  await persist(await generate(D));
  const rows = await query<{ name: string }>(`
    select s.full_name name from shift_assignments sa
    join positions p on p.id = sa.position_id
    join soldiers s on s.id = sa.soldier_id
    where sa.day = $1 and p.name = 'תורנים'`, [D]);
  assert.deepEqual(rows.map((r) => r.name).sort(), ['חדש אחד', 'חדש שניים']);
});

test('T5 is soft, not hard: forced repeat is assigned and the validator warns', async () => {
  await toranimOnly();
  await addSoldier('T105', 'תורן חוזר');
  await addSoldier('T106', 'תורן חוזר שני');
  await manualRow('תורן חוזר', 'תורנים', '2026-08-22', '2026-08-22 14:00', '2026-08-23 14:00');
  await manualRow('תורן חוזר שני', 'תורנים', '2026-08-22', '2026-08-22 14:00', '2026-08-23 14:00');
  await persist(await generate(D));
  const rows = await query(`
    select count(*) n from shift_assignments sa
    join positions p on p.id = sa.position_id
    where sa.day = $1 and p.name = 'תורנים'`, [D]);
  assert.equal(Number(rows[0].n), 2);   // both assigned despite the recent תורנות
  const f = await validateDay(D);
  const warns = f.filter((x) => x.rule === 'second_toranut_week');
  assert.equal(warns.length, 2, JSON.stringify(f));
  assert.ok(warns.every((w) => w.severity === 'warning'));
});
