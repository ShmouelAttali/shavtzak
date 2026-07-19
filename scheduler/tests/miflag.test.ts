// מפלג staff crew (staff_all_roles: רס"פ/סרס"פ/מנהלה) and the weekly
// מגן-commander decision (magen_commander_history), over one generated day.
import './env.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshSchema, seedSoldiers, closePool, query } from './helpers.js';
import { generate, persist } from '../src/generate.js';
import { validateDay } from '../src/validate.js';
import { RationaleEntry } from '../src/rationale.js';

const D = '2026-08-01';
const STAFF = ['רספ פלוגה', 'מנהלן פלוגה'];

before(async () => {
  await freshSchema();
  await seedSoldiers();
  await query(`insert into soldiers (personal_number, full_name, platoon, role, rifle_level)
               values ('S001', 'רספ פלוגה', '1', 'רס"פ', 0),
                      ('S002', 'מנהלן פלוגה', '2', 'מנהלה', 0)`);
  // weekly decision: חייל 35 (platoon '3') leads the מגן crew — id-based
  // history row effective from D (name lookup per testing policy)
  await query(`insert into magen_commander_history (valid_from, soldier_id)
               select $1, id from soldiers where full_name = $2`, [D, 'חייל 35']);
  await persist(await generate(D));
});
after(async () => {
  await query(`delete from magen_commander_history`);
  await closePool();
});

test('מפלג: staff roles land there daily for the full schedule day, and nowhere else', async () => {
  const rows = await query<{ full_name: string; lo: string; dur_h: string }>(`
    select s.full_name, lower(sa.period)::text lo,
           extract(epoch from (upper(sa.period) - lower(sa.period))) / 3600 dur_h
    from shift_assignments sa join positions p on p.id = sa.position_id
    join soldiers s on s.id = sa.soldier_id
    where sa.day = $1 and p.name = 'מפלג' order by s.full_name`, [D]);
  assert.deepEqual(rows.map((r) => r.full_name).sort(), [...STAFF].sort());
  for (const r of rows) {
    assert.ok(r.lo.includes('14:00:00'), r.lo);
    assert.equal(Number(r.dur_h), 24);
  }
  const elsewhere = await query(`
    select 1 from shift_assignments sa
    join positions p on p.id = sa.position_id
    join soldiers s on s.id = sa.soldier_id
    where sa.day = $1 and s.full_name = any($2) and p.name <> 'מפלג'`, [D, STAFF]);
  assert.deepEqual(elsewhere, [], 'staff must hold no other position');

  const f = await validateDay(D);
  assert.deepEqual(f.filter((x) => x.rule === 'allowed_positions'), []);
});

test('magen_commander_history: the decided soldier anchors the מגן crew and its platoon', async () => {
  const crew = await query<{ full_name: string; platoon: string; rationale: RationaleEntry[] }>(`
    select s.full_name, s.platoon, sa.rationale
    from shift_assignments sa join positions p on p.id = sa.position_id
    join soldiers s on s.id = sa.soldier_id
    where sa.day = $1 and p.name = 'מגן'`, [D]);
  assert.equal(crew.length, 12, 'surplus day fills מגן to its flex max');
  const cmd = crew.find((r) => r.full_name === 'חייל 35');
  assert.ok(cmd, 'the configured commander must be in the מגן crew');
  assert.ok(cmd!.rationale.some((e) => e.code === 'magen_commander'), JSON.stringify(cmd!.rationale));
  // same_platoon anchors on the commander's platoon ('3': 35 % 3 = 2 → '3')
  assert.equal(cmd!.platoon, '3');
  for (const r of crew) assert.equal(r.platoon, '3', `${r.full_name} not from the commander's platoon`);
});
