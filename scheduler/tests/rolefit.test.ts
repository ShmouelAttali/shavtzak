// P5 role fit (SPEC §6.1): driver preferences + מ"כ spread as tie-break keys
// placed after the P4 rotation keys.
import './env.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshSchema, seedSoldiers, soldierId, closePool, query } from './helpers.js';
import { generate, persist } from '../src/generate.js';

const D1 = '2026-08-01';

before(async () => {
  await freshSchema();
  await seedSoldiers();
});
after(closePool);

test('P5: נהג טיגריס preferred for התקפי over equal-fairness non-drivers', async () => {
  // 'חייל 57' sorts near-last by name — without the P5 key an equal-fairness
  // day would never place him in the 8-man התקפי crew
  await query(`insert into soldier_qualifications (soldier_id, qualification)
               select id, 'נהג טיגריס' from soldiers where full_name = 'חייל 57'`);
  await persist(await generate(D1));
  const rows = await query(`
    select 1 from day_assignments da
    join positions p on p.id = da.position_id
    join soldiers s on s.id = da.soldier_id
    where da.day = $1 and p.name = 'התקפי' and s.full_name = 'חייל 57'`, [D1]);
  assert.equal(rows.length, 1, 'tiger driver must be in the התקפי crew');
});

test('P5: non-driver still picked when the drivers are unavailable', async () => {
  const D2 = '2026-08-02';
  await query(`insert into unavailability (soldier_id, period, kind)
               select id, tsrange(day_start($1), day_start($1) + interval '1 day'), 'חופש'
               from soldiers where full_name in ('חייל 13', 'חייל 14', 'חייל 57')`, [D2]);
  await persist(await generate(D2));
  const n = await query<{ n: string }>(`
    select count(*) n from day_assignments da
    join positions p on p.id = da.position_id
    where da.day = $1 and p.name = 'התקפי'`, [D2]);
  assert.equal(Number(n[0].n), 8, 'התקפי crew fills without any tiger driver');
  await query(`delete from unavailability`);
  await query(`delete from shift_assignments where day = $1`, [D2]);
  await query(`delete from day_assignments where day = $1`, [D2]);
});

test('P5: נהג דוד preferred for the night patrol slot (22:00, overlaps 00-06)', async () => {
  const D3 = '2026-08-03';
  // put a late-sorting driver INTO the patrol group via a locked Level-1 row,
  // then check WHICH shift Level-2 hands him: without the P5 key the equal-
  // fairness tie-break (Hebrew name) would give the night slot to an earlier
  // name; the driver key must win the 22:00 slot for him
  await query(`insert into soldier_qualifications (soldier_id, qualification)
               select id, 'נהג דוד' from soldiers where full_name = 'חייל 59'`);
  const sid = await soldierId('חייל 59');
  await query(`insert into schedule_days (day) values ($1) on conflict do nothing`, [D3]);
  await query(`insert into day_assignments (day, soldier_id, position_id, source, locked)
               values ($1, $2, (select id from positions where name = 'סיור'), 'manual', true)`, [D3, sid]);
  await persist(await generate(D3));
  const rows = await query<{ lo: string }>(`
    select lower(sa.period)::text lo from shift_assignments sa
    join positions p on p.id = sa.position_id
    where sa.day = $1 and sa.soldier_id = $2 and p.name = 'סיור'`, [D3, sid]);
  assert.equal(rows.length, 1, 'locked patrol member must hold exactly one patrol shift');
  assert.ok(rows[0].lo.includes('22:00:00'), `driver got ${rows[0].lo}, expected the 22:00 night shift`);
  await query(`delete from shift_assignments where day = $1`, [D3]);
  await query(`delete from day_assignments where day = $1`, [D3]);
});

test('P5 מ"כ spread: no hour of the defense grid stacks two commanders when fighters suffice', async () => {
  // focused world: only עמדות הגנה slots, exactly 2 static commanders in the
  // pool — 4 commander-shifts over 6 grid hours can and must avoid stacking
  await freshSchema();
  await seedSoldiers();
  await query(`update soldiers set role = 'לוחם' where full_name in ('חייל 03','חייל 04','חייל 05','חייל 06')`);
  await query(`delete from slot_templates where position_id <> (select id from positions where name = 'עמדות הגנה')`);
  const D4 = '2026-08-04';
  await persist(await generate(D4));
  const rows = await query<{ lo: string; n: string }>(`
    select lower(sa.period)::text lo, count(*) filter (where s.role in ('מ"כ', 'מ"ח')) n
    from shift_assignments sa
    join positions p on p.id = sa.position_id
    join soldiers s on s.id = sa.soldier_id
    where sa.day = $1 and p.name = 'עמדות הגנה'
    group by 1`, [D4]);
  assert.ok(rows.length >= 6, 'defense grid hours exist');
  for (const r of rows) {
    assert.ok(Number(r.n) <= 1, `hour ${r.lo}: ${r.n} commanders on static posts (max 1 expected)`);
  }
});
