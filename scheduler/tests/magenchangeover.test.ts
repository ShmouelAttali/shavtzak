// מגן weekly changeover (owner 2026-07-20): the crew is replaced at the
// Sunday 08:00 bus, which falls inside SATURDAY's schedule day. Each מגן seat
// splits at that bus — outgoing half (14:00→08:00, a leaver) + incoming half
// (08:00→14:00, the INCOMING week's commander + his מחלקה). Here Saturday
// 2026-08-08 → Sunday 2026-08-09; the incoming commander is מחלקה-3.
import './env.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshSchema, soldierId, closePool, query } from './helpers.js';
import { generate, persist } from '../src/generate.js';

const SAT = '2026-08-08';   // Saturday: tomorrow (09/08) is Sunday
const SUN = '2026-08-09';
const busFrom = 18;         // 08:00 next day = 14:00 + 18h

before(async () => {
  await freshSchema();
  await query(`update positions set is_scheduled = false where name not in ('מגן','מנוחה','בבית')`);
  // outgoing crew: 12 מחלקה-2 soldiers, present until the Sunday 08:00 bus
  for (let i = 1; i <= 12; i++) {
    await query(`insert into soldiers (personal_number, full_name, platoon, role, rifle_level)
                 values ($1, $2, '2', 'לוחם', 3)`, [`O${String(i).padStart(2,'0')}`, `יוצא ${i}`]);
  }
  // incoming crew: a מחלקה-3 commander + 11 מחלקה-3 soldiers, arrive at the bus
  await query(`insert into soldiers (personal_number, full_name, platoon, role, rifle_level)
               values ('C01', 'מפקד נכנס', '3', 'סמל', 3)`);
  for (let i = 1; i <= 11; i++) {
    await query(`insert into soldiers (personal_number, full_name, platoon, role, rifle_level)
                 values ($1, $2, '3', 'לוחם', 3)`, [`N${String(i).padStart(2,'0')}`, `נכנס ${i}`]);
  }
  // outgoing leave at the Sunday 08:00 bus; incoming are away until it
  for (let i = 1; i <= 12; i++) {
    const sid = await soldierId(`יוצא ${i}`);
    await query(`insert into unavailability (soldier_id, period, kind)
                 values ($1, tsrange(day_start($2)+make_interval(hours=>$3), day_start($2)+interval '24 hours'), 'חופש')`,
      [sid, SAT, busFrom]);
  }
  for (const name of ['מפקד נכנס', ...Array.from({length: 11}, (_, i) => `נכנס ${i + 1}`)]) {
    const sid = await soldierId(name);
    await query(`insert into unavailability (soldier_id, period, kind)
                 values ($1, tsrange(day_start($2), day_start($2)+make_interval(hours=>$3)), 'חופש')`,
      [sid, SAT, busFrom]);
  }
  // the incoming week's מגן commander decision (effective the Sunday)
  await query(`insert into magen_commander_history (soldier_id, valid_from)
               select id, $1 from soldiers where full_name='מפקד נכנס'`, [SUN]);
  await persist(await generate(SAT));
});
after(closePool);

const magenRows = () => query<{ full_name: string; platoon: string; lo: string; rationale: any[] }>(`
  select s.full_name, s.platoon, lower(sa.period)::time::text lo, sa.rationale
  from shift_assignments sa join positions p on p.id=sa.position_id join soldiers s on s.id=sa.soldier_id
  where sa.day=$1 and p.name='מגן' order by lo, s.full_name`, [SAT]);

test('incoming half (08:00→14:00) is the incoming commander + his מחלקה', async () => {
  const inc = (await magenRows()).filter((r) => r.lo === '08:00:00');
  assert.ok(inc.length >= 10, `incoming crew ${inc.length}/10`);
  for (const r of inc) assert.equal(r.platoon, '3', `${r.full_name} not מחלקה 3`);
  const cmd = inc.find((r) => r.full_name === 'מפקד נכנס');
  assert.ok(cmd, 'incoming commander must be on the fresh crew');
  assert.ok(cmd!.rationale.some((e) => e.code === 'magen_commander'), JSON.stringify(cmd!.rationale));
  assert.ok(inc.every((r) => r.rationale.some((e) => e.code === 'handover_in')), 'incoming halves carry handover_in');
});

test('outgoing half (14:00→08:00) is the previous (מחלקה-2) crew', async () => {
  const out = (await magenRows()).filter((r) => r.lo === '14:00:00');
  assert.ok(out.length >= 10, `outgoing crew ${out.length}/10`);
  for (const r of out) assert.equal(r.platoon, '2', `${r.full_name} not מחלקה 2`);
  assert.ok(out.every((r) => r.rationale.some((e) => e.code === 'handover_out')), 'outgoing halves carry handover_out');
});
