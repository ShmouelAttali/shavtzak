// soldier_fairness draft-scope rewrite (query review, 2026-07-26).
//
// The draft-scope predicate used to contain a CORRELATED `not exists` inside a
// CASE, which the planner turns into a SubPlan re-executed once per non-draft
// row. db/query-review-2026-07-26.sql replaced it with a `draft_days` CTE plus
// `sa.day not in (select day from draft_days)` — a single hashed subquery.
//
// This suite guards the rewrite from two sides:
//   1. the DOCUMENTED semantics, asserted as concrete numbers on a fixture that
//      mixes import / manual / locked / auto / chain rows over a day that holds
//      drafts and a day that does not;
//   2. FULL OUTPUT EQUIVALENCE against the pre-rewrite body — loaded verbatim
//      from db/fairness-draft-scope-2026-07-26.sql under the temporary name
//      soldier_fairness_old, so nothing is hand-copied and the comparison
//      cannot drift.
//
// Synthetic rows only (no generate()). Positions are resolved by NAME per the
// testing policy — never by seed id.
import './env.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { freshSchema, closePool, query } from './helpers.js';

// 2026-08-09 is a Sunday, so the fairness week anchored on any of the days
// below opens at 09/08 14:00 (asserted in the first test).
const PUB = '2026-08-10';    // Monday   — published-only day (no draft rows)
const DRAFT = '2026-08-11';  // Tuesday  — holds auto + chain rows
const CHAIN = '2026-08-12';  // Wednesday— holds a chain row
const AS_OF = '2026-08-13';  // Thursday — window 09/08 14:00 → 13/08 14:00

/** Every as_of the equivalence sweep runs on: before the week, mid-week (so the
 *  window clips rows), and after every fixture row. */
const AS_OFS = ['2026-08-09', '2026-08-11', '2026-08-12', AS_OF, '2026-08-16'];

interface Row {
  night_count_7d: string; night_count_total: string;
  mission_hours_7d: string; weighted_hours_7d: string;
  readiness_hours_7d: string; tracker_hours_total: string;
  position_counts: Record<string, number>;
}

async function fair(name: string, includeDrafts: boolean, asOf = AS_OF): Promise<Row> {
  const rows = await query<Row>(`
    select f.* from soldier_fairness($1::date, $2) f
      join soldiers s on s.id = f.soldier_id
     where s.full_name = $3`, [asOf, includeDrafts, name]);
  assert.equal(rows.length, 1, `${name} must appear exactly once in soldier_fairness`);
  return rows[0];
}

const hours = (r: Row) => Number(r.mission_hours_7d);

/** Insert one shift_assignments row, resolving position + soldier by name. */
function add(opts: {
  day: string; position: string; soldier: string; from: string; to: string;
  source: string; seat?: number; locked?: boolean; blocks?: boolean;
}) {
  return query(`
    insert into shift_assignments
      (day, position_id, soldier_id, period, source, seat_index, locked, blocks_overlap)
    select $1::date,
           (select id from positions where name = $2),
           (select id from soldiers where full_name = $3),
           tsrange($4::timestamp, $5::timestamp), $6, $7, $8, $9`,
    [opts.day, opts.position, opts.soldier, opts.from, opts.to, opts.source,
     opts.seat ?? 1, opts.locked ?? false, opts.blocks ?? true]);
}

/** The PRE-rewrite function body, loaded verbatim from its own delta file and
 *  installed under a temporary name. Renaming is a pure textual substitution of
 *  the function name, so the body (incl. the correlated NOT EXISTS) is exactly
 *  what production ran before the query review. */
async function installOldFairness(): Promise<void> {
  const path = fileURLToPath(new URL('../db/fairness-draft-scope-2026-07-26.sql', import.meta.url));
  const sql = readFileSync(path, 'utf8');
  assert.ok(sql.includes('not exists (select 1 from shift_assignments d'),
    'the old delta must still carry the correlated NOT EXISTS — otherwise this ' +
    'suite is comparing the rewrite against itself');
  await query(sql.replace(/soldier_fairness\(/g, 'soldier_fairness_old('));
}

before(async () => {
  await freshSchema();
  await installOldFairness();

  const soldiers: [string, string][] = [
    ['Q01', 'ייבוא בלבד'],        // import row on a day with no drafts
    ['Q02', 'טיוטה בלבד'],        // auto row on the draft day
    ['Q03', 'מעורב'],             // auto + import on the draft day
    ['Q04', 'נעול'],              // locked auto + unlocked import on the draft day
    ['Q05', 'ידני ביום פרסום'],   // manual on the published-only day
    ['Q06', 'ידני ביום טיוטה'],   // manual on the draft day
    ['Q07', 'שרשרת'],             // chain + import on the chain day
    ['Q08', 'לילה'],              // auto NIGHT row
    ['Q09', 'גשש'],               // chain כונן גשש NIGHT row (tracker hours)
    ['Q10', 'ריק'],               // no rows at all
    ['Q11', 'מנוחה בלבד'],        // rest position only — excluded by mission_class
    ['Q12', 'מגן יומי'],          // 24h daily duty: capped at 8h, night_exempt
    ['Q13', 'ארכיון'],            // archived — must not appear at all
  ];
  for (const [pn, name] of soldiers) {
    await query(`insert into soldiers (personal_number, full_name, platoon, role, rifle_level)
                 values ($1, $2, '1', 'לוחם', 3)`, [pn, name]);
  }
  await query(`update soldiers set archived_at = now() where full_name = 'ארכיון'`);

  for (const d of [PUB, DRAFT, CHAIN]) {
    await query(`insert into schedule_days (day, status) values ($1, 'generated')
                 on conflict do nothing`, [d]);
  }

  // ── the published-only day (PUB holds NO auto/chain row — that is the point)
  await add({ day: PUB, position: 'סיור', soldier: 'ייבוא בלבד',
              from: '2026-08-10 15:00', to: '2026-08-10 19:00', source: 'import' });
  await add({ day: PUB, position: 'סיור', soldier: 'ידני ביום פרסום',
              from: '2026-08-10 15:00', to: '2026-08-10 19:00', source: 'manual' });
  await add({ day: PUB, position: 'מנוחה', soldier: 'מנוחה בלבד',
              from: '2026-08-10 15:00', to: '2026-08-10 19:00', source: 'import' });
  await add({ day: PUB, position: 'מגן', soldier: 'מגן יומי',
              from: '2026-08-10 14:00', to: '2026-08-11 14:00', source: 'import' });
  await add({ day: PUB, position: 'סיור', soldier: 'ארכיון',
              from: '2026-08-10 15:00', to: '2026-08-10 19:00', source: 'import' });

  // ── the draft day: seat_index must differ between non-import rows sharing a
  //    day/position/period (shift_assignments_seat_key excludes source='import')
  await add({ day: DRAFT, position: 'סיור', soldier: 'טיוטה בלבד',
              from: '2026-08-11 15:00', to: '2026-08-11 19:00', source: 'auto', seat: 1 });
  await add({ day: DRAFT, position: 'סיור', soldier: 'מעורב',
              from: '2026-08-11 15:00', to: '2026-08-11 19:00', source: 'auto', seat: 2 });
  await add({ day: DRAFT, position: 'סיור', soldier: 'ידני ביום טיוטה',
              from: '2026-08-11 15:00', to: '2026-08-11 19:00', source: 'manual', seat: 3 });
  await add({ day: DRAFT, position: 'סיור', soldier: 'מעורב',
              from: '2026-08-12 08:00', to: '2026-08-12 14:00', source: 'import' });
  await add({ day: DRAFT, position: 'סיור', soldier: 'נעול',
              from: '2026-08-11 19:00', to: '2026-08-11 23:00', source: 'auto', locked: true });
  await add({ day: DRAFT, position: 'סיור', soldier: 'נעול',
              from: '2026-08-12 06:00', to: '2026-08-12 12:00', source: 'import' });
  await add({ day: DRAFT, position: 'סיור', soldier: 'לילה',
              from: '2026-08-12 00:00', to: '2026-08-12 06:00', source: 'auto' });
  await add({ day: DRAFT, position: 'כונן גשש', soldier: 'גשש',
              from: '2026-08-12 00:00', to: '2026-08-12 06:00', source: 'chain', blocks: false });

  // ── the chain day
  await add({ day: CHAIN, position: 'סיור', soldier: 'שרשרת',
              from: '2026-08-12 15:00', to: '2026-08-12 19:00', source: 'chain' });
  await add({ day: CHAIN, position: 'סיור', soldier: 'שרשרת',
              from: '2026-08-13 08:00', to: '2026-08-13 14:00', source: 'import' });
});
after(closePool);

test('the fixture week is Sunday-anchored as assumed', async () => {
  const [r] = await query<{ dow: string; t_start: string }>(
    `select extract(dow from $1::date)::text as dow,
            day_start($1::date - (extract(dow from $1::date))::int)::text as t_start`, [AS_OF]);
  assert.equal(r.dow, '4', `${AS_OF} must be a Thursday`);
  assert.ok(r.t_start.startsWith('2026-08-09 14:00'), `window opens Sun 09/08 14:00, got ${r.t_start}`);
});

test('include_drafts=true — a day WITH drafts contributes its drafts only', async () => {
  assert.equal(hours(await fair('טיוטה בלבד', true)), 4, 'the auto row counts');
  assert.equal(hours(await fair('מעורב', true)), 4,
    'the 4h auto row supersedes the 6h import row on the same day — never 10');
  assert.equal(hours(await fair('ידני ביום טיוטה', true)), 0,
    'a manual (non-draft, non-locked) row on a draft day is superseded too');
  assert.equal(hours(await fair('שרשרת', true)), 4, 'chain counts as a draft row');
});

test('include_drafts=true — a day WITHOUT drafts still contributes its published rows', async () => {
  assert.equal(hours(await fair('ייבוא בלבד', true)), 4);
  assert.equal(hours(await fair('ידני ביום פרסום', true)), 4);
});

test('include_drafts=false — only published work, drafts ignored', async () => {
  assert.equal(hours(await fair('ייבוא בלבד', false)), 4);
  assert.equal(hours(await fair('ידני ביום פרסום', false)), 4);
  assert.equal(hours(await fair('טיוטה בלבד', false)), 0, 'the auto row must NOT count');
  assert.equal(hours(await fair('מעורב', false)), 6, 'only the 6h import row — never 10');
  assert.equal(hours(await fair('ידני ביום טיוטה', false)), 4,
    'manual is published work, and here the draft no longer supersedes it');
  assert.equal(hours(await fair('שרשרת', false)), 6, 'the import row, not the chain row');
});

test('locked rows are human truth and count in BOTH modes', async () => {
  assert.equal(hours(await fair('נעול', true)), 4,
    'the locked 4h draft counts; the same day’s unlocked 6h import is superseded');
  assert.equal(hours(await fair('נעול', false)), 10,
    'published mode: the locked draft (4h) AND the import row (6h)');
});

test('the default (1-arg call) is include_drafts=true', async () => {
  for (const name of ['טיוטה בלבד', 'מעורב', 'ידני ביום טיוטה', 'נעול', 'שרשרת']) {
    const [d] = await query<Row>(`
      select f.* from soldier_fairness($1::date) f
        join soldiers s on s.id = f.soldier_id where s.full_name = $2`, [AS_OF, name]);
    assert.equal(hours(d), hours(await fair(name, true)), `${name}: default = include_drafts=true`);
  }
});

test('the derived columns follow the same draft scope', async () => {
  const nightT = await fair('לילה', true);
  assert.equal(nightT.night_count_7d, '1', 'the auto night row counts as a night');
  assert.equal(Number(nightT.mission_hours_7d), 6);
  const nightF = await fair('לילה', false);
  assert.equal(nightF.night_count_7d, '0', 'published-only: the draft night is gone');

  const gashashT = await fair('גשש', true);
  assert.equal(Number(gashashT.tracker_hours_total), 6, 'R3 night גשש load');
  assert.equal(Number(gashashT.readiness_hours_7d), 6);
  assert.equal(Number(gashashT.mission_hours_7d), 0, 'readiness never counts as mission hours');
  assert.equal(Number((await fair('גשש', false)).tracker_hours_total), 0,
    'the chain גשש row is a draft — out in published mode');

  const magen = await fair('מגן יומי', true);
  assert.equal(Number(magen.mission_hours_7d), 8, 'a 24h daily duty is capped at 8h (R4)');
  assert.equal(magen.night_count_7d, '0', 'daily ⇒ night_exempt');
});

test('rows the function must ignore entirely', async () => {
  for (const include of [true, false]) {
    const empty = await fair('ריק', include);
    assert.equal(hours(empty), 0);
    assert.deepEqual(empty.position_counts, {}, 'no rows ⇒ empty position_counts');
    assert.equal(hours(await fair('מנוחה בלבד', include)), 0, 'mission_class=rest is excluded');
  }
  const archived = await query(`
    select 1 from soldier_fairness($1::date, true) f
      join soldiers s on s.id = f.soldier_id where s.full_name = 'ארכיון'`, [AS_OF]);
  assert.equal(archived.length, 0, 'an archived soldier is out of fairness entirely');
});

test('the rewrite returns byte-identical rows to the pre-rewrite body', async () => {
  for (const asOf of AS_OFS) {
    for (const include of [true, false]) {
      const [r] = await query<{ only_new: string; only_old: string; n: string }>(`
        with a as (select * from soldier_fairness($1::date, $2)),
             b as (select * from soldier_fairness_old($1::date, $2))
        select (select count(*) from (select * from a except all select * from b) x)::text as only_new,
               (select count(*) from (select * from b except all select * from a) y)::text as only_old,
               (select count(*) from a)::text as n`, [asOf, include]);
      const where = `as_of=${asOf} include_drafts=${include}`;
      assert.equal(r.only_new, '0', `${where}: rows only the NEW body returns`);
      assert.equal(r.only_old, '0', `${where}: rows only the OLD body returns`);
      assert.equal(r.n, '12', `${where}: 12 non-archived soldiers expected`);
    }
  }
});
