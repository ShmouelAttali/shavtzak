// soldier_fairness(as_of, include_drafts) — owner request 2026-07-26 (הוגנות tab
// toggle): fairness should count the already-scheduled PUBLISHED work, with a
// toggle that factors drafts in, where a day's DRAFT supersedes its published
// rows if a draft version exists.
//
// Synthetic rows only (no generate()) so the assertions test the function's row
// selection and nothing else. Positions/sub-positions are resolved by NAME per
// the testing policy — never by seed id.
//
// 2026-08-09 = Sunday, so as_of 2026-08-12 (Wed) gives a week window of
// Sun 09/08 14:00 → Wed 12/08 14:00, covering both days used below.
import './env.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshSchema, closePool, query } from './helpers.js';

const PUB_DAY = '2026-08-10';    // published-only day (Monday)
const DRAFT_DAY = '2026-08-11';  // day that holds drafts (Tuesday)
const AS_OF = '2026-08-12';      // Wednesday — window ends 12/08 14:00

interface Row { mission_hours_7d: string; weighted_hours_7d: string }

/** Fairness for one soldier, either with the default (1-arg) call or explicitly. */
async function fair(name: string, includeDrafts?: boolean): Promise<Row> {
  const call = includeDrafts === undefined
    ? `soldier_fairness($1::date)`
    : `soldier_fairness($1::date, ${includeDrafts})`;
  const rows = await query<Row>(`
    select f.mission_hours_7d, f.weighted_hours_7d
      from ${call} f join soldiers s on s.id = f.soldier_id
     where s.full_name = $2`, [AS_OF, name]);
  assert.equal(rows.length, 1, `${name} must appear exactly once in soldier_fairness`);
  return rows[0];
}

const hours = (r: Row) => Number(r.mission_hours_7d);

before(async () => {
  await freshSchema();
  for (const [pn, name] of [['S1', 'טיוטה בלבד'], ['S2', 'פורסם בלבד'],
                            ['S3', 'מעורב'], ['S4', 'נעול']] as const) {
    await query(`insert into soldiers (personal_number, full_name, platoon, role, rifle_level)
                 values ($1, $2, '1', 'לוחם', 3)`, [pn, name]);
  }
  for (const d of [PUB_DAY, DRAFT_DAY]) {
    await query(`insert into schedule_days (day, status) values ($1, 'generated')
                 on conflict do nothing`, [d]);
  }

  // seat_index must differ between two non-import rows that share a
  // day/position/period — that is the `shift_assignments_seat_key` partial
  // unique index (it excludes source='import', so import rows are free).
  const add = (day: string, name: string, from: string, to: string,
               source: string, seat = 1, locked = false) =>
    query(`insert into shift_assignments
             (day, position_id, soldier_id, period, source, seat_index, locked)
           select $1::date,
                  (select id from positions where name = 'מגן'),
                  (select id from soldiers where full_name = $2),
                  tsrange($3::timestamp, $4::timestamp), $5, $6, $7`,
      [day, name, from, to, source, seat, locked]);

  // draft-only soldier: 4h auto row on the draft day
  await add(DRAFT_DAY, 'טיוטה בלבד', '2026-08-11 15:00', '2026-08-11 19:00', 'auto', 1);
  // published-only soldier: 4h import row on the published day
  await add(PUB_DAY, 'פורסם בלבד', '2026-08-10 15:00', '2026-08-10 19:00', 'import');
  // mixed soldier: BOTH an auto (4h) and an import (6h) row on the SAME day.
  // Non-overlapping windows so no_double_booking stays satisfied; the differing
  // lengths are what make the two modes distinguishable.
  await add(DRAFT_DAY, 'מעורב', '2026-08-11 15:00', '2026-08-11 19:00', 'auto', 2);
  await add(DRAFT_DAY, 'מעורב', '2026-08-12 08:00', '2026-08-12 14:00', 'import');
  // locked draft row: human truth, must count in BOTH modes
  await add(DRAFT_DAY, 'נעול', '2026-08-11 19:00', '2026-08-11 23:00', 'auto', 1, true);
});
after(closePool);

test('include_drafts=false counts published work and ignores drafts', async () => {
  assert.equal(hours(await fair('פורסם בלבד', false)), 4, 'import row must count');
  assert.equal(hours(await fair('טיוטה בלבד', false)), 0, 'auto row must NOT count');
});

test('include_drafts=true counts drafts', async () => {
  assert.equal(hours(await fair('טיוטה בלבד', true)), 4, 'auto row must count');
  assert.equal(hours(await fair('פורסם בלבד', true)), 4,
    'a day with no draft still contributes its published rows');
});

test("a day's draft supersedes its published rows — never both", async () => {
  // include_drafts: the 4h auto row wins, the 6h import row on that day is out
  assert.equal(hours(await fair('מעורב', true)), 4, 'draft supersedes published');
  // published-only: the 6h import row is all that counts
  assert.equal(hours(await fair('מעורב', false)), 6, 'published rows only');
  // the point of superseding: neither mode sums 4+6
  assert.notEqual(hours(await fair('מעורב', true)), 10);
  assert.notEqual(hours(await fair('מעורב', false)), 10);
});

test('locked rows are human truth and count in both modes', async () => {
  assert.equal(hours(await fair('נעול', true)), 4);
  assert.equal(hours(await fair('נעול', false)), 4,
    'a locked row survives the published-only filter');
});

test('the 1-arg call still works and keeps the old draft-inclusive behaviour', async () => {
  // load.ts and every existing test call soldier_fairness(day) with one arg —
  // dropping the old signature (rather than leaving both) is what keeps this
  // from failing with "function soldier_fairness(date) is not unique".
  for (const name of ['טיוטה בלבד', 'פורסם בלבד', 'מעורב', 'נעול']) {
    assert.equal(hours(await fair(name)), hours(await fair(name, true)),
      `${name}: default must equal include_drafts=true`);
  }
});
