// H9 night-exit relaxation (owner 2026-07-19): a soldier whose approved
// half-day exit windows for the schedule day ALL fall entirely within
// 22:00–06:00 (day-start-relative hours 8–12 / 12–16 / 8–16) may
// ADDITIONALLY serve in a position flagged config.night_exit_ok (only
// תורנים carries it). Shift positions stay allowed; every other daily duty
// and readiness row stays forbidden; non-night exits keep the old
// shift-position-only rule. The validator downgrades the exit_window /
// exit_daily errors to ONE exit_night_toranut warning for that combination.
import './env.js';
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshSchema, soldierId, closePool, query } from './helpers.js';
import { generate, persist } from '../src/generate.js';
import { validateDay } from '../src/validate.js';
import { isNightExitWindows } from '../src/config.js';
import { RationaleEntry } from '../src/rationale.js';

async function addExit(sid: number, day: string, fromH: number, toH: number) {
  await query(`insert into exit_requests (soldier_id, period)
               values ($1, tsrange(day_start($2) + make_interval(hours => $3),
                                   day_start($2) + make_interval(hours => $4)))`,
    [sid, day, fromH, toH]);
}

after(closePool);

// ── 1: pure unit tests — no DB ──────────────────────────────────────────────
describe('isNightExitWindows (pure)', () => {
  const H = 60;
  test('each qualifying window relative to day start: 22–02, 02–06, 22–06', () => {
    assert.equal(isNightExitWindows([[8 * H, 12 * H]], 0), true);     // 22:00–02:00
    assert.equal(isNightExitWindows([[12 * H, 16 * H]], 0), true);    // 02:00–06:00
    assert.equal(isNightExitWindows([[8 * H, 16 * H]], 0), true);     // 22:00–06:00
  });
  test('a window reaching outside 22:00–06:00 disqualifies', () => {
    assert.equal(isNightExitWindows([[4 * H, 12 * H]], 0), false);    // 18:00–02:00
    assert.equal(isNightExitWindows([[12 * H, 20 * H]], 0), false);   // 02:00–10:00
  });
  test('two night windows qualify; a mixed pair does not', () => {
    assert.equal(isNightExitWindows([[8 * H, 12 * H], [12 * H, 16 * H]], 0), true);
    assert.equal(isNightExitWindows([[8 * H, 12 * H], [4 * H, 8 * H]], 0), false);
  });
  test('empty window list is not a night exit', () => {
    assert.equal(isNightExitWindows([], 0), false);
  });
  test('windows are relative to a non-zero day start', () => {
    const ds = 29_760_000;   // arbitrary absolute day-start minute
    assert.equal(isNightExitWindows([[ds + 8 * H, ds + 16 * H]], ds), true);
    assert.equal(isNightExitWindows([[ds + 8 * H - 1, ds + 16 * H]], ds), false);
    assert.equal(isNightExitWindows([[ds + 8 * H, ds + 16 * H + 1]], ds), false);
  });
});

// ── 2+3+5: תורנים-only world — the relaxation, its non-night negative, and
// the validator on a manual violation ───────────────────────────────────────
describe('night exit → תורנים (night_exit_ok)', () => {
  const D = '2026-10-05';    // generated day
  const DN = '2026-10-06';   // its 14:00 end boundary
  const F = '2026-10-20';    // validator-only day, never generated

  let sidNight: number;      // 22:00–02:00 exit — night exit
  let sidEve: number;        // 18:00–02:00 exit — NOT a night exit
  let issues: string[];

  before(async () => {
    await freshSchema();
    // no shift positions at all — תורנים is the only working position, so a
    // night exit lands there and a non-night exit has nowhere to go
    await query(`update positions set is_scheduled = false
                 where name not in ('תורנים', 'מנוחה', 'בבית')`);
    for (let i = 1; i <= 6; i++) {
      await query(`insert into soldiers (personal_number, full_name, platoon, role, rifle_level)
                   values ($1, $2, '1', 'לוחם', 3)`, [`N${String(i).padStart(2, '0')}`, `תורן ${i}`]);
    }
    sidNight = await soldierId('תורן 1');
    sidEve = await soldierId('תורן 2');
    await addExit(sidNight, D, 8, 12);   // 22:00–02:00 — fully inside the night
    await addExit(sidEve, D, 4, 12);     // 18:00–02:00 — starts before 22:00
    const res = await generate(D);
    issues = res.issues;
    await persist(res);
  });

  test('night-exit soldier holds the full תורנים daily row with exit_night_toranut', async () => {
    const rows = await query<{ lo: string; hi: string; rationale: RationaleEntry[] }>(`
      select lower(sa.period)::text lo, upper(sa.period)::text hi, sa.rationale
      from shift_assignments sa join positions p on p.id = sa.position_id
      where sa.soldier_id = $1 and sa.day = $2 and p.name = 'תורנים'`, [sidNight, D]);
    assert.equal(rows.length, 1, JSON.stringify(rows));
    assert.ok(rows[0].lo.includes(`${D} 14:00`), rows[0].lo);
    assert.ok(rows[0].hi.includes(`${DN} 14:00`), rows[0].hi);
    const codes = rows[0].rationale.map((e) => e.code);
    assert.ok(codes.includes('exit_night_toranut'), JSON.stringify(codes));

    // he holds the daily row itself — never handled by the shift packing
    const all = await query<{ rationale: RationaleEntry[] }>(`
      select sa.rationale from shift_assignments sa
      where sa.soldier_id = $1 and sa.day = $2`, [sidNight, D]);
    for (const r of all) {
      assert.ok(!r.rationale.some((e) => ['exit_shift_fill', 'exit_packed'].includes(e.code)),
        JSON.stringify(r.rationale));
    }

    const bucket = await query<{ name: string }>(`
      select p.name from day_assignments da join positions p on p.id = da.position_id
      where da.soldier_id = $1 and da.day = $2`, [sidNight, D]);
    assert.equal(bucket[0]?.name, 'תורנים', `level1 = ${bucket[0]?.name}`);

    assert.ok(!issues.some((i) => i.includes('תורן 1') && i.includes('יציאה קצרה')),
      JSON.stringify(issues));
  });

  test('validator: one exit_night_toranut warning replaces the exit errors', async () => {
    const f = await validateDay(D);
    assert.deepEqual(f.filter((x) => x.soldierId === sidNight
      && ['exit_window', 'exit_daily'].includes(x.rule)), [], JSON.stringify(f));
    const warn = f.filter((x) => x.rule === 'exit_night_toranut' && x.soldierId === sidNight);
    assert.equal(warn.length, 1, JSON.stringify(f));
    assert.equal(warn[0].severity, 'warning');
    assert.ok(warn[0].message.includes('באחריות מפקד ה'), warn[0].message);
  });

  test('negative: a non-night (18:00–02:00) exit stays blocked from תורנים', async () => {
    const rows = await query(`
      select 1 from shift_assignments sa join positions p on p.id = sa.position_id
      where sa.soldier_id = $1 and sa.day = $2 and p.name = 'תורנים'`, [sidEve, D]);
    assert.deepEqual(rows, [], 'evening-exit soldier must not hold a תורנים row');
    // no shift positions exist in this world — the H9 pre-pass reports it
    assert.ok(issues.some((i) => i.includes('תורן 2') && i.includes('יציאה קצרה')),
      JSON.stringify(issues));
    const f = await validateDay(D);
    assert.deepEqual(f.filter((x) => x.rule === 'exit_night_toranut' && x.soldierId === sidEve),
      [], JSON.stringify(f));
  });

  test('validator-only: manual תורנים row for a non-night exit keeps both errors', async () => {
    const sid = await soldierId('תורן 3');
    await addExit(sid, F, 4, 12);   // 18:00–02:00 — NOT a night exit
    await query(`insert into schedule_days (day) values ($1) on conflict do nothing`, [F]);
    await query(`insert into shift_assignments (day, position_id, soldier_id, period, seat_index, source)
                 values ($1, (select id from positions where name = 'תורנים'), $2,
                         tsrange(day_start($1), day_start($1) + interval '24 hours'), 1, 'manual')`,
      [F, sid]);
    await query(`insert into day_assignments (day, soldier_id, position_id, source)
                 values ($1, $2, (select id from positions where name = 'תורנים'), 'manual')`,
      [F, sid]);

    const f = await validateDay(F);
    assert.ok(f.some((x) => x.rule === 'exit_window' && x.soldierId === sid
      && x.severity === 'error'), JSON.stringify(f));
    assert.ok(f.some((x) => x.rule === 'exit_daily' && x.soldierId === sid
      && x.severity === 'error'), JSON.stringify(f));
    assert.deepEqual(f.filter((x) => x.rule === 'exit_night_toranut' && x.soldierId === sid),
      [], JSON.stringify(f));
  });
});

// ── 4: the relaxation is flag-scoped — a night exit unlocks תורנים but NOT
// מגן (or any other daily duty) ─────────────────────────────────────────────
describe('night exit does not unlock other daily duties (מגן)', () => {
  const Y = '2026-11-01';    // day 1: establishes the מגן crew without the outsider
  const D = '2026-11-02';    // day 2: the outsider has a night exit

  let sidOut: number;        // NOT on yesterday's crew — night exit on day 2

  before(async () => {
    await freshSchema();
    // both a night_exit_ok duty (תורנים) and a non-flagged daily duty (מגן)
    await query(`update positions set is_scheduled = false
                 where name not in ('מגן', 'תורנים', 'מנוחה', 'בבית')`);
    // 13 soldiers: day 1 needs מגן 10 (flex min) + תורנים 2 from the 12
    // available; the 13th (outsider) is away, so he is never crew
    for (let i = 1; i <= 13; i++) {
      await query(`insert into soldiers (personal_number, full_name, platoon, role, rifle_level)
                   values ($1, $2, '1', 'לוחם', 3)`, [`G${String(i).padStart(2, '0')}`, `חייל ${i}`]);
    }
    sidOut = await soldierId('חייל 13');
    await query(`insert into unavailability (soldier_id, period, kind)
                 values ($1, tsrange(day_start($2), day_start($3)), 'חופש')`, [sidOut, Y, D]);
    await persist(await generate(Y));
    await addExit(sidOut, D, 8, 12);   // 22:00–02:00 — a night exit
    await persist(await generate(D));
  });

  test('the night-exit outsider lands in תורנים, never in מגן', async () => {
    const magen = await query(`
      select 1 from shift_assignments sa join positions p on p.id = sa.position_id
      where sa.soldier_id = $1 and sa.day = $2 and p.name = 'מגן'`, [sidOut, D]);
    assert.deepEqual(magen, [], 'night-exit soldier must not hold a מגן row');

    const bucket = await query<{ name: string }>(`
      select p.name from day_assignments da join positions p on p.id = da.position_id
      where da.soldier_id = $1 and da.day = $2`, [sidOut, D]);
    assert.notEqual(bucket[0]?.name, 'מגן', `level1 = ${bucket[0]?.name}`);
    assert.equal(bucket[0]?.name, 'תורנים', `level1 = ${bucket[0]?.name}`);
  });

  test('validator: the warning is scoped to the תורנים row — no exit errors, no exit_magen', async () => {
    const f = await validateDay(D);
    assert.deepEqual(f.filter((x) => x.soldierId === sidOut
      && ['exit_window', 'exit_daily'].includes(x.rule)), [], JSON.stringify(f));
    assert.deepEqual(f.filter((x) => x.rule === 'exit_magen' && x.soldierId === sidOut),
      [], JSON.stringify(f));
    const warn = f.filter((x) => x.rule === 'exit_night_toranut' && x.soldierId === sidOut);
    assert.equal(warn.length, 1, JSON.stringify(f));
    assert.ok(warn[0].message.includes('תורנים'), warn[0].message);
  });
});
