// H9 מגן stickiness (owner decision 2026-07-19): a continuity crew member
// with an approved half-day exit STAYS on the מגן daily row — the exit window
// does not eject him from the crew (the מגן officer covers his absence
// internally); the validator downgrades the exit_window/exit_daily errors to
// one exit_magen warning. A NON-continuity soldier with an exit still cannot
// take מגן on his exit day.
import './env.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshSchema, soldierId, closePool, query } from './helpers.js';
import { generate, persist } from '../src/generate.js';
import { validateDay } from '../src/validate.js';
import { RationaleEntry } from '../src/rationale.js';

const Y = '2026-09-01';   // day 1: establishes the מגן crew
const D = '2026-09-02';   // day 2: one member + one outsider have exits

let sidSticky: number;    // מגן 1 — returning crew member with an exit
let sidFresh: number;     // חייל חדש — NOT on yesterday's crew, has an exit
let issues: string[];

async function addExit(sid: number, day: string, fromH: number, toH: number) {
  await query(`insert into exit_requests (soldier_id, period)
               values ($1, tsrange(day_start($2) + make_interval(hours => $3),
                                   day_start($2) + make_interval(hours => $4)))`,
    [sid, day, fromH, toH]);
}

before(async () => {
  await freshSchema();
  // מגן-only world (pattern: dutyrest.test.ts continuity test)
  await query(`update positions set is_scheduled = false
               where name not in ('מגן', 'מנוחה', 'בבית')`);
  for (let i = 1; i <= 10; i++) {
    await query(`insert into soldiers (personal_number, full_name, platoon, role, rifle_level)
                 values ($1, $2, '1', 'לוחם', 3)`, [`M${String(i).padStart(2, '0')}`, `מגן ${i}`]);
  }
  await query(`insert into soldiers (personal_number, full_name, platoon, role, rifle_level)
               values ('X01', 'חייל חדש', '1', 'לוחם', 3)`);
  sidSticky = await soldierId('מגן 1');
  sidFresh = await soldierId('חייל חדש');
  // the outsider is fully away on day 1, so day 1's crew is exactly מגן 1–10
  await query(`insert into unavailability (soldier_id, period, kind)
               values ($1, tsrange(day_start($2), day_start($3)), 'חופש')`, [sidFresh, Y, D]);
  await persist(await generate(Y));
  // day 2: a crew member and the outsider both hold an 18:00–02:00 exit
  await addExit(sidSticky, D, 4, 12);
  await addExit(sidFresh, D, 4, 12);
  const res = await generate(D);
  issues = res.issues;
  await persist(res);
});
after(closePool);

test('sticky: the returning crew member keeps the full מגן daily row despite the exit', async () => {
  const rows = await query<{ lo: string; hi: string; rationale: RationaleEntry[] }>(`
    select lower(sa.period)::text lo, upper(sa.period)::text hi, sa.rationale
    from shift_assignments sa join positions p on p.id = sa.position_id
    where sa.soldier_id = $1 and sa.day = $2 and p.name = 'מגן'`, [sidSticky, D]);
  assert.equal(rows.length, 1, JSON.stringify(rows));
  assert.ok(rows[0].lo.includes('2026-09-02 14:00'), rows[0].lo);
  assert.ok(rows[0].hi.includes('2026-09-03 14:00'), rows[0].hi);
  const codes = rows[0].rationale.map((e) => e.code);
  assert.ok(codes.includes('continuity_crew'), JSON.stringify(codes));
  assert.ok(codes.includes('exit_sticky_magen'), JSON.stringify(codes));

  const bucket = await query<{ name: string }>(`
    select p.name from day_assignments da join positions p on p.id = da.position_id
    where da.soldier_id = $1 and da.day = $2`, [sidSticky, D]);
  assert.equal(bucket[0]?.name, 'מגן', `level1 = ${bucket[0]?.name}`);
});

test('sticky: the exit shift-fill did not grab him (no exit_shift_fill, no packing issue)', async () => {
  const rows = await query<{ rationale: RationaleEntry[] }>(`
    select sa.rationale from shift_assignments sa
    where sa.soldier_id = $1 and sa.day = $2`, [sidSticky, D]);
  for (const r of rows) {
    assert.ok(!r.rationale.some((e) => ['exit_shift_fill', 'exit_packed'].includes(e.code)),
      JSON.stringify(r.rationale));
  }
  assert.ok(!issues.some((i) => i.includes('מגן 1') && i.includes('יציאה קצרה')),
    JSON.stringify(issues));
});

test('sticky: validator emits the exit_magen warning instead of exit_window/exit_daily errors', async () => {
  const f = await validateDay(D);
  assert.deepEqual(f.filter((x) => x.soldierId === sidSticky
    && ['exit_window', 'exit_daily'].includes(x.rule)), [], JSON.stringify(f));
  const magen = f.filter((x) => x.rule === 'exit_magen' && x.soldierId === sidSticky);
  assert.equal(magen.length, 1, JSON.stringify(f));
  assert.equal(magen[0].severity, 'warning');
  assert.ok(magen[0].message.includes('באחריות מפקד המגן'), magen[0].message);
});

test('negative: a non-continuity soldier with an exit still cannot take מגן', async () => {
  const rows = await query(`
    select 1 from shift_assignments sa join positions p on p.id = sa.position_id
    where sa.soldier_id = $1 and sa.day = $2 and p.name = 'מגן'`, [sidFresh, D]);
  assert.deepEqual(rows, [], 'fresh exit soldier must not hold a מגן row');
  const bucket = await query<{ name: string }>(`
    select p.name from day_assignments da join positions p on p.id = da.position_id
    where da.soldier_id = $1 and da.day = $2`, [sidFresh, D]);
  assert.notEqual(bucket[0]?.name, 'מגן', `level1 = ${bucket[0]?.name}`);
  // no shift positions exist in this fixture — the H9 pre-pass reports it
  assert.ok(issues.some((i) => i.includes('חייל חדש') && i.includes('יציאה קצרה')),
    JSON.stringify(issues));
  // and he must not inherit the sticky warning
  const f = await validateDay(D);
  assert.deepEqual(f.filter((x) => x.rule === 'exit_magen' && x.soldierId === sidFresh), []);
});
