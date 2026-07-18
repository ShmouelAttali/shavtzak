// H9/R7 — half-day exit requests: shift-position placement, packing outside
// the exit window, back-to-back relaxation (exit soldier only), chain/daily
// exclusion, seat-rule release, and the validator's exit_* rules.
import './env.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshSchema, seedSoldiers, soldierId, closePool, query } from './helpers.js';
import { generate, persist } from '../src/generate.js';
import { validateDay } from '../src/validate.js';
import { RationaleEntry } from '../src/rationale.js';

const D1 = '2026-08-01', D2 = '2026-08-02', D3 = '2026-08-03';
const D4 = '2026-08-04', D5 = '2026-08-05', D6 = '2026-08-06';
const D7 = '2026-08-07', D8 = '2026-08-08';
const F1 = '2026-08-20';   // validator-only day, never generated

const SHIFT_POSITIONS = ['סיור', 'עמדות הגנה'];

/** insert an exit request [day 14:00 + fromH, day 14:00 + toH) */
async function addExit(name: string, day: string, fromH: number, toH: number): Promise<number> {
  const sid = await soldierId(name);
  await query(`insert into exit_requests (soldier_id, period)
               values ($1, tsrange(day_start($2) + make_interval(hours => $3),
                                   day_start($2) + make_interval(hours => $4)))`,
    [sid, day, fromH, toH]);
  return sid;
}

const dayRows = (sid: number, day: string) => query<{
  name: string; lo: string; hi: string; mission_class: string;
  violations: string[]; rationale: RationaleEntry[];
}>(`select p.name, lower(sa.period)::text lo, upper(sa.period)::text hi, p.mission_class,
           sa.violations, sa.rationale
    from shift_assignments sa join positions p on p.id = sa.position_id
    where sa.soldier_id = $1 and sa.day = $2 order by lower(sa.period)`, [sid, day]);

before(async () => {
  await freshSchema();
  await seedSoldiers();
  await query(`update soldiers set role = 'מ"פ' where full_name = 'חייל 55'`);
  await query(`update positions set config = config || $1::jsonb where name = 'חפק'`, [JSON.stringify({
    seat_rules: [
      { sub: 'מפקד', roles: ['מ"פ'], commander: true },
      { sub: 'קשר', soldiers: ['חייל 20', 'חייל 21'], ordered: true, release_unpicked: true },
      { sub: 'חובש', soldiers: ['חייל 23', 'חייל 24'] },
      { sub: 'נהג', soldiers: ['חייל 25', 'חייל 26'] },
    ],
  })]);
  for (const d of [D1, D2, D3]) await persist(await generate(d));
});
after(closePool);

test('exit day: shift position only, ~8h packed outside the window', async () => {
  const sid = await addExit('חייל 30', D4, 4, 12);   // 18:00–02:00
  await persist(await generate(D4));

  const bucket = await query<{ name: string }>(`
    select p.name from day_assignments da join positions p on p.id = da.position_id
    where da.soldier_id = $1 and da.day = $2`, [sid, D4]);
  assert.ok(SHIFT_POSITIONS.includes(bucket[0]?.name), `level1 = ${bucket[0]?.name}`);

  const rows = await dayRows(sid, D4);
  assert.ok(rows.length > 0, 'exit soldier works');
  // nothing inside the window, no daily/readiness rows
  const inWindow = await query(`
    select 1 from shift_assignments
    where soldier_id = $1 and day = $2
      and period && tsrange(day_start($2) + interval '4 hours', day_start($2) + interval '12 hours')`,
    [sid, D4]);
  assert.deepEqual(inWindow, []);
  for (const r of rows) {
    assert.ok(SHIFT_POSITIONS.includes(r.name), `assigned to ${r.name}`);
    assert.notEqual(r.mission_class, 'readiness');
  }
  const [{ h }] = await query<{ h: number }>(`
    select sum(least(hours(sa.period), 8)) h from shift_assignments sa
    join positions p on p.id = sa.position_id
    where sa.soldier_id = $1 and sa.day = $2 and p.mission_class not in ('readiness','rest')`,
    [sid, D4]);
  assert.equal(Number(h), 8, `packed ${h}h`);
  const codes = new Set(rows.flatMap((r) => r.rationale.map((e) => e.code)));
  assert.ok(codes.has('exit_shift_fill'), 'exit_shift_fill rationale');
  assert.ok(codes.has('exit_packed'), 'exit_packed rationale');

  const findings = await validateDay(D4);
  assert.deepEqual(findings.filter((f) =>
    ['exit_window', 'exit_daily'].includes(f.rule)), []);
});

test('16h exit: back-to-back shifts allowed for the exit soldier (R7, בדוחק)', async () => {
  const sid = await soldierId('חייל 31');
  await query(`update soldiers set allowed_positions = '{"עמדות הגנה"}' where id = $1`, [sid]);
  await addExit('חייל 31', D5, 8, 24);   // 22:00 → next 14:00, only 14:00-22:00 remains
  await persist(await generate(D5));

  const rows = await dayRows(sid, D5);
  assert.equal(rows.length, 2, JSON.stringify(rows));
  assert.ok(rows[0].hi === rows[1].lo, `not back-to-back: ${rows[0].hi} → ${rows[1].lo}`);
  assert.ok(rows[1].violations.some((v) => v.includes('בדוחק')), JSON.stringify(rows[1].violations));
  assert.ok(rows[1].rationale.some((e) => e.code === 'caveat_exit_rest'), 'caveat_exit_rest');

  const findings = await validateDay(D5);
  assert.deepEqual(findings.filter((f) => f.rule === 'rest' && f.soldierId === sid
    && f.severity === 'error'), [], 'no hard rest error for the exit soldier');
  assert.ok(findings.some((f) => f.rule === 'exit_rest' && f.soldierId === sid),
    'exit_rest warning present');
});

test('14:00 start right after a 14:00 end across the rotation boundary', async () => {
  const sid = await soldierId('חייל 32');
  await query(`update soldiers set allowed_positions = '{"עמדות הגנה"}' where id = $1`, [sid]);
  // plant a locked manual shift on D5 ending exactly at D6 14:00
  await query(`delete from shift_assignments where soldier_id = $1 and day = $2`, [sid, D5]);
  await query(`insert into shift_assignments
                 (day, position_id, sub_position_id, soldier_id, period, seat_index, source, locked)
               values ($1, (select id from positions where name = 'עמדות הגנה'),
                       (select id from sub_positions where name = 'שג'),
                       $2, tsrange(day_start($3) - interval '4 hours', day_start($3)), 1, 'manual', true)`,
    [D5, sid, D6]);
  await addExit('חייל 32', D6, 8, 24);   // free window: 14:00–22:00 only
  await persist(await generate(D6));

  const rows = await dayRows(sid, D6);
  assert.ok(rows.length > 0, 'exit soldier works on D6');
  assert.ok(String(rows[0].lo).includes('14:00:00'),
    `first shift must start 14:00 (zero rest, exit day): ${rows[0].lo}`);
  assert.ok(rows[0].violations.some((v) => v.includes('בדוחק')), JSON.stringify(rows[0].violations));
});

test('exit soldier is excluded from chains — standby completed by others (T4/H9)', async () => {
  const sid = await soldierId('חייל 33');
  await query(`update soldiers set allowed_positions = '{"עמדות הגנה"}' where id = $1`, [sid]);
  await addExit('חייל 33', D7, 12, 24);   // 02:00 → 14:00; he works 14:00-02:00 shifts
  await persist(await generate(D7));

  const readiness = await query(`
    select p.name from shift_assignments sa join positions p on p.id = sa.position_id
    where sa.soldier_id = $1 and sa.day = $2 and p.mission_class = 'readiness'`, [sid, D7]);
  assert.deepEqual(readiness, [], 'no readiness/on-call rows for the exit soldier');
  const findings = await validateDay(D7);
  assert.deepEqual(findings.filter((f) => f.severity === 'error'
    && ['chain', 'carmel_staffing'].includes(f.rule)), [], 'chains staffed without him');
});

test('validator: exit_window / exit_daily errors on manual violations', async () => {
  await query(`insert into schedule_days (day) values ($1) on conflict do nothing`, [F1]);
  const sidA = await addExit('חייל 40', F1, 4, 12);   // 18:00–02:00
  const sidB = await addExit('חייל 41', F1, 4, 12);
  // A: shift row INSIDE the window; plus a back-to-back pair outside it
  await query(`insert into shift_assignments (day, position_id, soldier_id, period, seat_index, source)
               values ($1, (select id from positions where name = 'עמדות הגנה'), $2,
                       tsrange(day_start($1) + interval '8 hours', day_start($1) + interval '12 hours'), 1, 'manual'),
                      ($1, (select id from positions where name = 'עמדות הגנה'), $2,
                       tsrange(day_start($1) + interval '12 hours', day_start($1) + interval '16 hours'), 1, 'manual'),
                      ($1, (select id from positions where name = 'עמדות הגנה'), $2,
                       tsrange(day_start($1) + interval '16 hours', day_start($1) + interval '20 hours'), 1, 'manual')`,
    [F1, sidA]);
  // B: a daily 24h duty on his exit day
  await query(`insert into shift_assignments (day, position_id, soldier_id, period, seat_index, source)
               values ($1, (select id from positions where name = 'תורנים'), $2,
                       tsrange(day_start($1), day_start($1) + interval '24 hours'), 1, 'manual')`,
    [F1, sidB]);

  const findings = await validateDay(F1);
  assert.ok(findings.some((f) => f.rule === 'exit_window' && f.soldierId === sidA),
    'row inside the exit window flagged');
  assert.ok(findings.some((f) => f.rule === 'exit_daily' && f.soldierId === sidB),
    'daily duty on exit day flagged');
  // the zero-rest pair (02:00→06:00→10:00) downgrades to exit_rest warning
  assert.deepEqual(findings.filter((f) => f.rule === 'rest' && f.soldierId === sidA
    && f.severity === 'error'), []);
  assert.ok(findings.some((f) => f.rule === 'exit_rest' && f.soldierId === sidA));
});

test('seat-rule candidate with an exit is skipped — next on the list takes the seat', async () => {
  const sid20 = await addExit('חייל 20', D8, 4, 12);   // חפק קשר priority 1
  await persist(await generate(D8));

  const kesher = await query<{ full_name: string }>(`
    select s.full_name from shift_assignments sa
    join soldiers s on s.id = sa.soldier_id
    join sub_positions sp on sp.id = sa.sub_position_id
    where sa.day = $1 and sp.name = 'קשר'`, [D8]);
  assert.equal(kesher[0]?.full_name, 'חייל 21', 'next candidate mans the seat');

  const bucket = await query<{ name: string }>(`
    select p.name from day_assignments da join positions p on p.id = da.position_id
    where da.soldier_id = $1 and da.day = $2`, [sid20, D8]);
  assert.ok(SHIFT_POSITIONS.includes(bucket[0]?.name),
    `exit candidate released to a shift position, got ${bucket[0]?.name}`);
  const hafak = await query(`
    select 1 from shift_assignments sa join positions p on p.id = sa.position_id
    where sa.soldier_id = $1 and sa.day = $2 and p.name = 'חפק'`, [sid20, D8]);
  assert.deepEqual(hafak, []);
});
