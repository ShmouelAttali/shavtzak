// Unit tests for the Shavtzak display model. Two distinct builders, because
// the two tabs' data sources disagree about what a row's date means:
//   - buildDisplayGroups: the draft tab's scheduler DB genuinely anchors a
//     schedule day at 14:00->14:00 — an early hour in a day's own data can
//     really belong to the calendar day after, resolved via a real
//     calendar moment and (optionally) merged with the previous day's own
//     tail.
//   - buildSheetDisplayGroups: the live tab's שבצק sheet has no such
//     concept — its own תאריך is always the literal, correct day for every
//     row (confirmed by the owner after a bug report: a row dated 21/07 is
//     really on 21/07, full stop) — so today's own slots are sorted by
//     literal hour, never gray, and a bounded look-ahead into tomorrow's
//     own record (its shifts before 14:00) is appended, grayed and dated.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDisplayGroups, buildSheetDisplayGroups, computeTodayHeadcounts, spansToNextDay } from '../src/components/Shavtzak';
import type { StationGroup } from '../api/_handlers/shavtzak';

const SEL_DATE = '21/07/2026';

function group(name: string, sug: string, times: [string, string[]][]): StationGroup {
  return { name, subTypes: [{ sug, times: times.map(([time, soldiers]) => ({ time, soldiers })) }] };
}

// ── buildSheetDisplayGroups (live tab) ──────────────────────────────────────

test('sheet: sorts a day\'s own slots by literal hour, never gray', () => {
  const current = [group('סיור', 'סיור', [
    ['14:00', ['א']], ['22:00', ['ב']], ['06:00', ['ג']], ['10:00', ['ד']],
  ])];

  const [display] = buildSheetDisplayGroups(current, null, '');
  const slots = display.subTypes[0].times;

  assert.deepEqual(slots.map(s => s.time), ['06:00', '10:00', '14:00', '22:00']);
  assert.ok(slots.every(s => !s.gray));
  // A row dated 21/07 at 06:00 stays exactly there — no rollover to 22/07.
  assert.deepEqual(slots[0].soldiers, ['ג']);
});

test('sheet: an overnight range (כרמל חטיבה\'s "22:00-6:00" block) sorts by its start hour', () => {
  const current = [group('כרמל חטיבה', 'כרמל חטיבה', [
    ['06:00', ['א']], ['10:00', ['ב']], ['14:00', ['ג']], ['18:00', ['ד']], ['22:00-6:00', ['ה']],
  ])];

  const [display] = buildSheetDisplayGroups(current, null, '');
  const slots = display.subTypes[0].times;

  assert.deepEqual(slots.map(s => s.time), ['06:00', '10:00', '14:00', '18:00', '22:00-6:00']);
});

test('sheet: a free-form same-day range (תורנים\'s "7:30-20:30") sorts by its start hour too', () => {
  const current = [group('תורנים', 'תורנים', [['7:30-20:30', ['א']]])];
  const [display] = buildSheetDisplayGroups(current, null, '');
  assert.equal(display.subTypes[0].times[0].time, '7:30-20:30');
  assert.equal(display.subTypes[0].times[0].gray, false);
});

test('sheet: a group with nobody assigned is dropped, not shown as an empty box', () => {
  const current = [group('נהגים', 'השתלמיות', [['14:15-15:30', []]])];
  const display = buildSheetDisplayGroups(current, null, '');
  assert.equal(display.find(g => g.name === 'נהגים'), undefined);
});

test('sheet: computeTodayHeadcounts excludes חפק/חמ"ל from the combat count (gray never applies here)', () => {
  const current = [
    group('סיור', 'סיור', [['14:00', ['א', 'ב']]]),
    group('חפק', 'חפק', [['14:00', ['ג']]]),
    group('חמ"ל', 'חמ"ל', [['14:00', ['ד']]]),
  ];
  const groups = buildSheetDisplayGroups(current, null, '');
  const {total, combat} = computeTodayHeadcounts(groups);

  assert.equal(total, 4);
  assert.equal(combat, 2); // א, ב — סיור only
});

test('sheet: appends tomorrow\'s early look-ahead (before 14:00), grayed and dated, after today\'s own rows', () => {
  const current = [group('עמדות הגנה', 'שג', [
    ['14:00', ['א']], ['18:00', ['ב']], ['22:00', ['ג']],
  ])];
  const tomorrow = [group('עמדות הגנה', 'שג', [
    ['02:00', ['ד']], ['06:00', ['ה']], ['10:00', ['ו']], ['14:00', ['ז']], // 14:00 excluded — not "before 14:00"
  ])];

  const [display] = buildSheetDisplayGroups(current, tomorrow, '22/07');
  const slots = display.subTypes[0].times;

  assert.deepEqual(slots.map(s => `${s.time}${s.gray ? '*' : ''}`),
    ['14:00', '18:00', '22:00', '02:00*', '06:00*', '10:00*']);
  assert.ok(slots.slice(0, 3).every(s => s.dateLabel === ''));
  assert.ok(slots.slice(3).every(s => s.dateLabel === '22/07'));
  assert.deepEqual(slots[3].soldiers, ['ד']);
});

test('sheet: tomorrow\'s own rows do not affect today\'s empty-box filtering when today has nobody', () => {
  const current: StationGroup[] = [];
  const tomorrow = [group('חפק', 'חפק', [['06:00', ['א']]])];

  const display = buildSheetDisplayGroups(current, tomorrow, '22/07');
  const found = display.find(g => g.name === 'חפק');
  assert.ok(found);
  assert.equal(found!.subTypes[0].times[0].gray, true);
});

// ── sheet: the התקפי "עד 14:00" carry-over ─────────────────────────────────
// כוננות התקפי is seated 14:00->14:00, so until 14:00 today the position is
// still manned by yesterday's crew — who appear nowhere in today's own rows.
// Deliberately scoped to התקפי by name and to the exact "14:00-14:00" form.

test('sheet: התקפי gets yesterday\'s 14:00-14:00 crew as a leading "עד 14:00" column', () => {
  const current = [group('התקפי', 'כוננות', [['14:00-14:00', ['אביאל', 'מתן']]])];
  const yesterday = [group('התקפי', 'כוננות', [['14:00-14:00', ['שמואל', 'אלי']]])];

  const [display] = buildSheetDisplayGroups(current, null, '', yesterday, '20/07');
  const slots = display.subTypes[0].times;

  assert.deepEqual(slots.map(s => s.time), ['14:00-14:00', '14:00-14:00']);
  assert.equal(slots[0].gray, true);
  assert.equal(slots[0].startDateLabel, '20/07');
  assert.equal(slots[0].endDateLabel, '');
  assert.deepEqual(slots[0].soldiers, ['שמואל', 'אלי']);
  // today's own row is untouched
  assert.equal(slots[1].gray, false);
  assert.deepEqual(slots[1].soldiers, ['אביאל', 'מתן']);
});

test('sheet: the carry-over column sorts ahead of every other hour, including a 06:00 sub-type', () => {
  const current: StationGroup[] = [{
    name: 'התקפי',
    subTypes: [
      { sug: 'כוננות', times: [{ time: '14:00-14:00', soldiers: ['א'] }] },
      { sug: 'תגבצ בוקר', times: [{ time: '06:30-09:00', soldiers: ['ב'] }] },
    ],
  }];
  const yesterday = [group('התקפי', 'כוננות', [['14:00-14:00', ['ג']]])];

  const [display] = buildSheetDisplayGroups(current, null, '', yesterday, '20/07');
  const konenut = display.subTypes.find(s => s.sug === 'כוננות')!;

  assert.deepEqual(konenut.times.map(s => s.time), ['14:00-14:00', '14:00-14:00']);
  assert.equal(konenut.times[0].startDateLabel, '20/07');
  // the carry-over is per-sub-type: תגבצ בוקר has no 14:00-14:00 row to carry
  assert.deepEqual(display.subTypes.find(s => s.sug === 'תגבצ בוקר')!.times.map(s => s.time), ['06:30-09:00']);
});

test('sheet: a carrying sub-type missing from today\'s own rows still gets its column', () => {
  const current = [group('התקפי', 'תגבצ ערב', [['17:00-22:00', ['א']]])];
  const yesterday = [group('התקפי', 'כוננות', [['14:00-14:00', ['ג', 'ד']]])];

  const [display] = buildSheetDisplayGroups(current, null, '', yesterday, '20/07');
  const konenut = display.subTypes.find(s => s.sug === 'כוננות');

  assert.ok(konenut);
  assert.deepEqual(konenut!.times.map(s => s.time), ['14:00-14:00']);
  assert.equal(konenut!.times[0].startDateLabel, '20/07');
  assert.deepEqual(konenut!.times[0].soldiers, ['ג', 'ד']);
});

test('sheet: no carry-over for a non-התקפי group, even with a 14:00-14:00 row yesterday', () => {
  const current = [group('סיור', 'סיור', [['14:00-14:00', ['א']]])];
  const yesterday = [group('סיור', 'סיור', [['14:00-14:00', ['ב']]])];

  const [display] = buildSheetDisplayGroups(current, null, '', yesterday, '20/07');
  assert.deepEqual(display.subTypes[0].times.map(s => s.time), ['14:00-14:00']);
});

test('sheet: no carry-over when yesterday\'s התקפי is a split day (14:00-09:00)', () => {
  // On those days the sheet already spells today's morning out as its own row.
  const current = [group('התקפי', 'כוננות', [['09:00-14:00', ['א']]])];
  const yesterday = [group('התקפי', 'כוננות', [['14:00-09:00', ['ב']]])];

  const [display] = buildSheetDisplayGroups(current, null, '', yesterday, '20/07');
  assert.deepEqual(display.subTypes[0].times.map(s => s.time), ['09:00-14:00']);
});

test('sheet: no prev-day source (the sheet\'s first date) leaves התקפי unchanged', () => {
  const current = [group('התקפי', 'כוננות', [['14:00-14:00', ['א']]])];

  const [display] = buildSheetDisplayGroups(current, null, '');
  assert.deepEqual(display.subTypes[0].times.map(s => s.time), ['14:00-14:00']);
});

test('sheet: the carry-over crew does not inflate today\'s headcounts', () => {
  const current = [group('התקפי', 'כוננות', [['14:00-14:00', ['א', 'ב']]])];
  const yesterday = [group('התקפי', 'כוננות', [['14:00-14:00', ['ג', 'ד']]])];

  const groups = buildSheetDisplayGroups(current, null, '', yesterday, '20/07');
  const {total, combat} = computeTodayHeadcounts(groups);

  assert.equal(total, 2);
  assert.equal(combat, 2);
});

test('sheet: spansToNextDay tags any range whose end lands on the day after its start', () => {
  // 14:00-14:00 is a full 24h shift — the label needs a date tag or it reads
  // as a zero-length slot. A genuine overnight range (14:00-09:00,
  // 22:00-6:00) also ends the next calendar day, so it's tagged too.
  // Same-day ranges (end strictly after start) must stay untagged.
  assert.equal(spansToNextDay('14:00-14:00'), true);
  assert.equal(spansToNextDay('06:00-06:00'), true);
  assert.equal(spansToNextDay('14:00-09:00'), true);
  assert.equal(spansToNextDay('22:00-6:00'), true);

  assert.equal(spansToNextDay('09:00-14:00'), false);
  assert.equal(spansToNextDay('14:00'), false);
  assert.equal(spansToNextDay('יומי'), false);
  assert.equal(spansToNextDay(''), false);
});

// ── buildDisplayGroups (draft tab: genuine 14:00-anchored scheduler DB) ─────

test('draft: merges previous day tail as non-gray, keeps current day tail gray, in chronological order', () => {
  // Previous schedule day (20/07 14:00 -> 21/07 14:00): its own tail is
  // 21/07's morning.
  const prev = [group('סיור', 'סיור', [
    ['14:00', ['א']], ['22:00', ['ב']], ['06:00', ['ג']],
  ])];
  // Current schedule day (21/07 14:00 -> 22/07 14:00).
  const current = [group('סיור', 'סיור', [
    ['14:00', ['ד']], ['22:00', ['ה']], ['06:00', ['ו']],
  ])];

  const [merged] = buildDisplayGroups(SEL_DATE, current, prev);
  const slots = merged.subTypes[0].times;

  assert.deepEqual(
    slots.map(s => `${s.time}${s.gray ? '*' : ''}`),
    ['06:00', '14:00', '22:00', '06:00*']
  );
  // The borrowed morning slot carries prev day's soldier, not current day's.
  assert.deepEqual(slots[0].soldiers, ['ג']);
  assert.deepEqual(slots[3].soldiers, ['ו']);
  // The grayed slot's real date is resolved (22/07), not assumed.
  assert.equal(slots[3].dateLabel, '22/07');
  assert.equal(slots[0].dateLabel, '');
});

test('draft: with no previous day (first date in range), only the current tail is gray', () => {
  const current = [group('סיור', 'סיור', [
    ['14:00', ['א']], ['22:00', ['ב']], ['06:00', ['ג']],
  ])];

  const [merged] = buildDisplayGroups(SEL_DATE, current, null);
  const slots = merged.subTypes[0].times;

  assert.deepEqual(
    slots.map(s => `${s.time}${s.gray ? '*' : ''}`),
    ['14:00', '22:00', '06:00*']
  );
});

test('draft: free-form same-day time ranges are never treated as tail hours, even when they start under 14', () => {
  const prev = [group('תורנים', 'תורנים', [['7:30-20:30', ['א']]])];
  const current = [group('תורנים', 'תורנים', [['7:30-20:30', ['ב']]])];

  const [merged] = buildDisplayGroups(SEL_DATE, current, prev);
  const slots = merged.subTypes[0].times;

  // Only current day's own entry — the previous day's is a full-day duty
  // (its end, 20:30, doesn't wrap past its start), not a tail hour, so it
  // must not be borrowed.
  assert.equal(slots.length, 1);
  assert.equal(slots[0].gray, false);
  assert.deepEqual(slots[0].soldiers, ['ב']);
});

test('draft: an overnight range (כרמל חטיבה\'s "22:00-6:00" block) resolves to its start hour, sorting between 18:00 and tomorrow\'s tail', () => {
  const prev = [group('כרמל חטיבה', 'כרמל חטיבה', [
    ['06:00', ['פ1']], ['10:00', ['פ2']],
  ])];
  const current = [group('כרמל חטיבה', 'כרמל חטיבה', [
    ['14:00', ['א']], ['18:00', ['ב']], ['22:00-6:00', ['ג']], ['06:00', ['ד']], ['10:00', ['ה']],
  ])];

  const [merged] = buildDisplayGroups(SEL_DATE, current, prev);
  const slots = merged.subTypes[0].times;

  assert.deepEqual(
    slots.map(s => `${s.time}${s.gray ? '*' : ''}`),
    ['06:00', '10:00', '14:00', '18:00', '22:00-6:00', '06:00*', '10:00*']
  );
  // The overnight block's end wraps past its start, so it rolls over like a
  // bare clock time would — but since its start hour is 22:00 (>= 14), it
  // stays anchored to today, never grayed.
  assert.equal(slots[4].gray, false);
});

test('draft: a position missing entirely from the current day still shows its borrowed morning tail', () => {
  const prev = [group('חפק', 'חפק', [['06:00', ['א']]])];
  const current: StationGroup[] = [];

  const [merged] = buildDisplayGroups(SEL_DATE, current, prev);
  assert.equal(merged.name, 'חפק');
  assert.equal(merged.subTypes[0].times.length, 1);
  assert.equal(merged.subTypes[0].times[0].time, '06:00');
  assert.equal(merged.subTypes[0].times[0].gray, false);
  assert.deepEqual(merged.subTypes[0].times[0].soldiers, ['א']);
});

test('draft: a group with no assignments today or in tomorrow\'s lookahead is dropped, not shown as an empty box', () => {
  // A one-off נהגים meeting happened yesterday (21/07) and doesn't recur;
  // today (22/07) nobody at all is assigned to it.
  const prev = [group('נהגים', 'השתלמיות', [['14:15-15:30', ['א']]])];
  const current: StationGroup[] = [];

  const merged = buildDisplayGroups('22/07/2026', current, prev);
  assert.equal(merged.find(g => g.name === 'נהגים'), undefined);
});

test('draft: a group with assignments only in tomorrow\'s lookahead is still shown', () => {
  const current = [group('חפק', 'חפק', [['06:00', ['א']]])]; // tail hour -> gray, lands tomorrow
  const merged = buildDisplayGroups(SEL_DATE, current, null);
  const found = merged.find(g => g.name === 'חפק');
  assert.ok(found);
  assert.equal(found!.subTypes[0].times[0].gray, true);
});

test('draft: computeTodayHeadcounts excludes tomorrow\'s grayed lookahead and חפק/חמ"ל from the combat count', () => {
  const current = [
    group('סיור', 'סיור', [['14:00', ['א', 'ב']], ['06:00', ['ג']]]), // ['ג'] is tomorrow, gray
    group('חפק', 'חפק', [['14:00', ['ד']]]),
    group('חמ"ל', 'חמ"ל', [['14:00', ['ה']]]),
  ];
  const groups = buildDisplayGroups(SEL_DATE, current, null);
  const {total, combat} = computeTodayHeadcounts(groups);

  assert.equal(total, 4); // א, ב, ד, ה — not ג (tomorrow)
  assert.equal(combat, 2); // א, ב — סיור only, חפק/חמ"ל excluded
});

test('draft: date format (YYYY-MM-DD) resolves the same way as the sheet format', () => {
  const current = [group('סיור', 'סיור', [
    ['14:00', ['א']], ['06:00', ['ב']],
  ])];

  const [merged] = buildDisplayGroups('2026-07-21', current, null);
  const slots = merged.subTypes[0].times;

  assert.deepEqual(slots.map(s => `${s.time}${s.gray ? '*' : ''}`), ['14:00', '06:00*']);
  assert.equal(slots[1].dateLabel, '22/07');
});
