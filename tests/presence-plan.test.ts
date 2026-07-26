// Unit tests for the נוכחות tab's pure presence math (src/lib/presencePlan.ts):
// the day↔period inverse pair. Writing must reproduce exactly what
// scheduler/import/cleanup.py part 3 emits — one row per consecutive same-kind
// run, [firstDay bus, lastDay+1 bus) with bus = 08:00 on Sunday / 06:00
// otherwise — and reading must map those rows back to the same days.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FULL_DAY_KINDS, PRESENT, addDays, busTs, canonicalKind, dayOfWeek, dayRange,
  isFullDayKind, offeredStates, planPresenceWrite, presenceMatrix, rowDays,
  type UnavailRow,
} from '../src/lib/presencePlan';

// 2026-07-19 is a Sunday; 2026-07-20..25 Mon..Sat; 2026-07-26 Sunday again.
const SUN = '2026-07-19', MON = '2026-07-20', TUE = '2026-07-21', WED = '2026-07-22',
  THU = '2026-07-23', FRI = '2026-07-24', SAT = '2026-07-25', SUN2 = '2026-07-26';

const row = (id: number, kind: string, start: string, end: string): UnavailRow =>
  ({ id, kind, start, end });
/** A full-day run over days first..last, exactly as cleanup.py writes it. */
const runRow = (id: number, kind: string, first: string, last: string): UnavailRow =>
  row(id, kind, busTs(first), busTs(addDays(last, 1)));

test('bus hours: Sunday 08:00, any other day 06:00', () => {
  assert.equal(dayOfWeek(SUN), 0);
  assert.equal(busTs(SUN), `${SUN} 08:00:00`);
  assert.equal(busTs(MON), `${MON} 06:00:00`);
  assert.equal(busTs(SAT), `${SAT} 06:00:00`);
  assert.equal(busTs(SUN2), `${SUN2} 08:00:00`);
});

test('offeredStates intersects the DB constraint with the full-day kinds', () => {
  // the real constraint list (schema.sql), both מגויס spellings included
  const constraint = [
    'חופש', 'לא מגויס', 'לא מגוייס', 'שחרור', 'גיוס', 'מחלה',
    'יציאה', 'יציאה בבוקר', 'יציאה ב14:00', 'יציאה בערב', 'חזרה ב14:00', 'חזרה בערב',
  ];
  assert.deepEqual(offeredStates(constraint),
    [PRESENT, 'חופש', 'מחלה', 'לא מגויס', 'שחרור', 'גיוס']);
  // the two spellings collapse onto ONE offered state
  assert.equal(offeredStates(constraint).filter((s) => s.startsWith('לא מג')).length, 1);
  // a kind dropped from the DB disappears from the UI
  assert.ok(!offeredStates(constraint.filter((k) => k !== 'גיוס')).includes('גיוס'));
  // both spellings match, the canonical one is what we write
  assert.equal(canonicalKind('לא מגוייס'), 'לא מגויס');
  assert.equal(canonicalKind('לא מגויס'), 'לא מגויס');
  assert.ok(isFullDayKind('לא מגוייס') && isFullDayKind('לא מגויס'));
  assert.ok(!isFullDayKind('יציאה בבוקר'));
  assert.deepEqual([...FULL_DAY_KINDS], ['חופש', 'מחלה', 'לא מגויס', 'שחרור', 'גיוס']);
});

// ── write ───────────────────────────────────────────────────────────────────

test('consecutive days of the same kind merge into ONE row', () => {
  const plan = planPresenceWrite(
    [MON, TUE, WED].map((day) => ({ day, status: 'חופש' })), []);
  assert.deepEqual(plan.deleteIds, []);
  assert.deepEqual(plan.insert, [
    { kind: 'חופש', start: `${MON} 06:00:00`, end: `${THU} 06:00:00` },
  ]);
});

test('a Sunday boundary uses 08:00 on both ends', () => {
  // Sunday..Monday → [Sun 08:00, Tue 06:00); Saturday..Sunday → [Sat 06:00, Mon 06:00)
  assert.deepEqual(
    planPresenceWrite([SUN, MON].map((day) => ({ day, status: 'מחלה' })), []).insert,
    [{ kind: 'מחלה', start: `${SUN} 08:00:00`, end: `${TUE} 06:00:00` }]);
  assert.deepEqual(
    planPresenceWrite([SAT, SUN2].map((day) => ({ day, status: 'מחלה' })), []).insert,
    [{ kind: 'מחלה', start: `${SAT} 06:00:00`, end: `${addDays(SUN2, 1)} 06:00:00` }]);
  // a lone Sunday: [Sun 08:00, Mon 06:00)
  assert.deepEqual(
    planPresenceWrite([{ day: SUN, status: 'חופש' }], []).insert,
    [{ kind: 'חופש', start: `${SUN} 08:00:00`, end: `${MON} 06:00:00` }]);
});

test('different kinds on adjacent days stay separate rows', () => {
  const plan = planPresenceWrite([
    { day: MON, status: 'חופש' }, { day: TUE, status: 'מחלה' }, { day: WED, status: 'חופש' },
  ], []);
  assert.equal(plan.insert.length, 3);
  assert.deepEqual(plan.insert.map((i) => i.kind), ['חופש', 'מחלה', 'חופש']);
});

test('the canonical spelling is written even when the alias is sent', () => {
  const plan = planPresenceWrite([{ day: MON, status: 'לא מגוייס' }], []);
  assert.deepEqual(plan.insert, [
    { kind: 'לא מגויס', start: `${MON} 06:00:00`, end: `${TUE} 06:00:00` },
  ]);
});

test('נוכח in the middle of a block splits it into two rows', () => {
  const block = runRow(7, 'חופש', MON, FRI);          // Mon..Fri
  const plan = planPresenceWrite([{ day: WED, status: PRESENT }], [block]);
  assert.deepEqual(plan.deleteIds, [7]);
  assert.deepEqual(plan.insert, [
    { kind: 'חופש', start: `${MON} 06:00:00`, end: `${WED} 06:00:00` },   // Mon..Tue
    { kind: 'חופש', start: `${THU} 06:00:00`, end: `${SAT} 06:00:00` },   // Thu..Fri
  ]);
});

test('נוכח over a whole block deletes it and inserts nothing', () => {
  const block = runRow(3, 'חופש', MON, TUE);
  const plan = planPresenceWrite(
    [MON, TUE].map((day) => ({ day, status: PRESENT })), [block]);
  assert.deepEqual(plan.deleteIds, [3]);
  assert.deepEqual(plan.insert, []);
});

test('a new run MERGES with an adjacent untouched row of the same kind', () => {
  const before = runRow(11, 'חופש', SUN, MON);        // Sun..Mon already stored
  const plan = planPresenceWrite(
    [TUE, WED].map((day) => ({ day, status: 'חופש' })), [before]);
  assert.deepEqual(plan.deleteIds, [11], 'the neighbour is rewritten, not left abutting');
  assert.deepEqual(plan.insert, [
    { kind: 'חופש', start: `${SUN} 08:00:00`, end: `${THU} 06:00:00` },
  ], 'one merged Sun..Wed row');
});

test('an adjacent row of a DIFFERENT kind is rewritten unchanged', () => {
  const before = runRow(12, 'מחלה', MON, MON);
  const plan = planPresenceWrite([{ day: TUE, status: 'חופש' }], [before]);
  assert.deepEqual(plan.deleteIds, [12]);
  assert.deepEqual(plan.insert, [
    { kind: 'מחלה', start: `${MON} 06:00:00`, end: `${TUE} 06:00:00` },
    { kind: 'חופש', start: `${TUE} 06:00:00`, end: `${WED} 06:00:00` },
  ]);
});

test('a partial-kind row on a touched day is deleted; on an untouched day it survives', () => {
  const touched = row(21, 'יציאה בבוקר', `${TUE} 06:00:00`, `${WED} 00:00:00`);
  const other = row(22, 'חזרה בערב', `${THU} 00:00:00`, `${THU} 20:00:00`);
  const plan = planPresenceWrite([{ day: TUE, status: 'חופש' }], [touched, other]);
  assert.deepEqual(plan.deleteIds, [21]);
  assert.deepEqual(plan.insert, [
    { kind: 'חופש', start: `${TUE} 06:00:00`, end: `${WED} 06:00:00` },
  ]);

  // and choosing נוכח on that cell removes the partial without inserting anything
  const cleared = planPresenceWrite([{ day: TUE, status: PRESENT }], [touched, other]);
  assert.deepEqual(cleared.deleteIds, [21]);
  assert.deepEqual(cleared.insert, []);
});

test('extending a block by one day rewrites it as a single longer row', () => {
  const block = runRow(31, 'שחרור', MON, TUE);
  const plan = planPresenceWrite([{ day: WED, status: 'שחרור' }], [block]);
  assert.deepEqual(plan.deleteIds, [31]);
  assert.deepEqual(plan.insert, [
    { kind: 'שחרור', start: `${MON} 06:00:00`, end: `${THU} 06:00:00` },
  ]);
});

test('an empty day list is a no-op', () => {
  assert.deepEqual(planPresenceWrite([], [runRow(1, 'חופש', MON, TUE)]),
    { deleteIds: [], insert: [] });
});

// ── read ────────────────────────────────────────────────────────────────────

test('rowDays maps a run back to exactly its days', () => {
  assert.deepEqual(rowDays(runRow(1, 'חופש', MON, WED)), [MON, TUE, WED]);
  assert.deepEqual(rowDays(runRow(2, 'חופש', SUN, SUN)), [SUN]);
  // partial kinds occupy the single day they start on
  assert.deepEqual(rowDays(row(3, 'יציאה בערב', `${MON} 18:00:00`, `${TUE} 08:00:00`)), [MON]);
  assert.deepEqual(rowDays(row(4, 'חזרה ב14:00', `${MON} 00:00:00`, `${MON} 14:00:00`)), [MON]);
});

test('presenceMatrix is the exact inverse of planPresenceWrite', () => {
  const days = dayRange(SUN, SUN2);
  const desired: Record<string, string> = {
    [SUN]: PRESENT, [MON]: 'חופש', [TUE]: 'חופש', [WED]: PRESENT,
    [THU]: 'מחלה', [FRI]: PRESENT, [SAT]: 'לא מגויס', [SUN2]: 'לא מגויס',
  };
  const plan = planPresenceWrite(days.map((day) => ({ day, status: desired[day] })), []);
  assert.equal(plan.insert.length, 3, 'חופש run, מחלה day, לא מגויס run');
  const stored = plan.insert.map((i, idx) => row(idx + 1, i.kind, i.start, i.end));
  assert.deepEqual(presenceMatrix(days, stored), desired);
});

test('presenceMatrix shows partial kinds verbatim and prefers the dominant row', () => {
  const days = dayRange(MON, WED);
  const block = runRow(1, 'חופש', MON, TUE);                                  // [Mon 06, Wed 06)
  const back = row(2, 'חזרה ב14:00', `${WED} 00:00:00`, `${WED} 14:00:00`);   // legal overlay
  const morning = row(3, 'יציאה בבוקר', `${MON} 06:00:00`, `${TUE} 00:00:00`);
  assert.deepEqual(presenceMatrix(days, [block, back]),
    { [MON]: 'חופש', [TUE]: 'חופש', [WED]: 'חזרה ב14:00' });
  // the full-day block (18h of Monday) beats the partial (18h too, full-day wins the tie)
  assert.equal(presenceMatrix([MON], [morning, block])[MON], 'חופש');
  // alone, the partial shows as itself
  assert.equal(presenceMatrix([MON], [morning])[MON], 'יציאה בבוקר');
});

test('a day with no row is נוכח', () => {
  assert.deepEqual(presenceMatrix([MON, TUE], []), { [MON]: PRESENT, [TUE]: PRESENT });
});
