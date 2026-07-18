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

test('H6d quota: with the regular tigers out, a late-sorting tiger is drafted into התקפי', async () => {
  // 'חייל 57' sorts near-last by name — only the hard driver quota (H6d)
  // places him in the 8-man crew when the usual tigers are unavailable.
  // (The old soft "prefer extra tigers" premise is obsolete: once the crew
  // has its required tiger, the platoon-group preference fills the rest.)
  await query(`insert into soldier_qualifications (soldier_id, qualification)
               select id, 'נהג טיגריס' from soldiers where full_name = 'חייל 57'`);
  await query(`insert into unavailability (soldier_id, period, kind)
               select id, tsrange(day_start($1), day_start($1) + interval '1 day'), 'חופש'
               from soldiers where full_name in ('חייל 13', 'חייל 14')`, [D1]);
  await persist(await generate(D1));
  const rows = await query(`
    select 1 from day_assignments da
    join positions p on p.id = da.position_id
    join soldiers s on s.id = da.soldier_id
    where da.day = $1 and p.name = 'התקפי' and s.full_name = 'חייל 57'`, [D1]);
  assert.equal(rows.length, 1, 'the only available tiger must be in the התקפי crew');
  await query(`delete from unavailability`);
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

test('H6d: every patrol shift crew includes a נהג דוד (hard driver rule)', async () => {
  const D3 = '2026-08-03';
  // the soft night-preference key is superseded by the hard rule: EVERY
  // patrol crew must carry a qualified driver, night and day alike
  await persist(await generate(D3));
  const rows = await query<{ lo: string; drivers: string }>(`
    select lower(sa.period)::text lo,
           count(*) filter (where exists (
             select 1 from soldier_qualifications q
             where q.soldier_id = sa.soldier_id and q.qualification = 'נהג דוד')) drivers
    from shift_assignments sa
    join positions p on p.id = sa.position_id
    where sa.day = $1 and p.name = 'סיור'
    group by 1 order by 1`, [D3]);
  assert.equal(rows.length, 3, 'three patrol shifts exist');
  for (const r of rows) {
    assert.ok(Number(r.drivers) >= 1, `patrol ${r.lo}: no נהג דוד in crew`);
  }
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
