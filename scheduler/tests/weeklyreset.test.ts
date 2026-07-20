// Weekly reset (owner decisions 2026-07-19):
//  - מגן continuity holds within the work week only — a SUNDAY schedule day
//    rebuilds the crew around the persisted weekly מגן commander instead of
//    carrying yesterday's crew by right (no continuity_crew rationale, no
//    rotation stay-bonus); Monday continues from Sunday as usual.
//  - fairness counters are week-scoped: soldier_fairness's window opens at
//    the week's Sunday 14:00, so on a Sunday the counters are all zero.
// 2026-08-08 = Saturday, 08-09 = Sunday, 08-10 = Monday.
import './env.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshSchema, closePool, query } from './helpers.js';
import { generate, persist } from '../src/generate.js';
import { RationaleEntry } from '../src/rationale.js';

const SAT = '2026-08-08', SUN = '2026-08-09', MON = '2026-08-10';

const magenRationale = async (day: string) =>
  query<{ full_name: string; rationale: RationaleEntry[] }>(`
    select s.full_name, sa.rationale
    from shift_assignments sa join positions p on p.id = sa.position_id
    join soldiers s on s.id = sa.soldier_id
    where sa.day = $1 and p.name = 'מגן'`, [day]);

before(async () => {
  await freshSchema();
  // מגן-only world (pattern: magensticky.test.ts) — 10 fighters, one platoon
  await query(`update positions set is_scheduled = false
               where name not in ('מגן', 'מנוחה', 'בבית')`);
  for (let i = 1; i <= 10; i++) {
    await query(`insert into soldiers (personal_number, full_name, platoon, role, rifle_level)
                 values ($1, $2, '1', $3, 3)`,
      [`W${String(i).padStart(2, '0')}`, `שבועי ${i}`, i === 1 ? 'מ"כ' : 'לוחם']);
  }
  // weekly decision effective before SAT — id-based history row (name lookup
  // per testing policy)
  await query(`insert into magen_commander_history (valid_from, soldier_id)
               select $1, id from soldiers where full_name = $2`,
    ['2026-08-02', 'שבועי 1']);
  for (const d of [SAT, SUN, MON]) await persist(await generate(d));
});
after(async () => {
  await query(`delete from magen_commander_history`);
  await closePool();
});

test('Sunday: nobody continues by right — crew rebuilt around the מגן commander', async () => {
  const rows = await magenRationale(SUN);
  assert.ok(rows.length > 0, 'Sunday מגן crew exists');
  for (const r of rows) {
    assert.ok(!r.rationale.some((e) => e.code === 'continuity_crew'),
      `${r.full_name}: continuity must NOT cross the Sunday boundary`);
  }
  const cmd = rows.find((r) => r.full_name === 'שבועי 1');
  assert.ok(cmd, 'the weekly מגן commander anchors the Sunday crew');
  assert.ok(cmd!.rationale.some((e) => e.code === 'magen_commander'),
    JSON.stringify(cmd!.rationale));
});

test('Monday: continuity resumes from the Sunday crew', async () => {
  const rows = await magenRationale(MON);
  assert.ok(rows.some((r) => r.rationale.some((e) => e.code === 'continuity_crew')),
    'weekday continuity must still work');
});

test('week-scoped fairness: Sunday counters are zero despite Saturday work', async () => {
  const f = await query<{ night_count_7d: string; weighted_hours_7d: string; position_counts: Record<string, number> }>(`
    select night_count_7d, weighted_hours_7d, position_counts
    from soldier_fairness($1::date)
    join soldiers s on s.id = soldier_id
    where s.full_name = 'שבועי 2'`, [SUN]);
  assert.equal(Number(f[0].night_count_7d), 0, 'Sunday window must be empty');
  assert.equal(Number(f[0].weighted_hours_7d), 0, 'Sunday window must be empty');
  assert.ok(!Object.values(f[0].position_counts ?? {}).some((n) => Number(n) > 0),
    'position balance is week-scoped — zero on Sunday');
  // and on Monday the window covers Sunday's work only
  const m = await query<{ weighted_hours_7d: string }>(`
    select weighted_hours_7d from soldier_fairness($1::date)
    join soldiers s on s.id = soldier_id
    where s.full_name = 'שבועי 2'`, [MON]);
  assert.ok(Number(m[0].weighted_hours_7d) > 0, 'Monday window covers Sunday');
});
