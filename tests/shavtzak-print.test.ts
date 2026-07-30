// The two title strings behind the שבצק tab's הדפס button. Everything else
// about printing is CSS (@media print in index.css + print: classes), so these
// helpers are the only printable logic worth pinning.
//
// Note these format `selectedDate` and nothing more — no schedule-day anchoring.
// The sheet's תאריך is the literal calendar day (see shavtzak-display.test.ts),
// so the printed heading is simply that date's own weekday.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { printDayTitle, printDocTitle, mergeCommanderSubType, CMD_TAG } from '../src/components/Shavtzak';

// ── printDayTitle: the heading on the paper ─────────────────────────────────

test('day title carries the Hebrew weekday and the date as-is', () => {
  // 30/07/2026 is a Thursday → יום ה׳
  assert.equal(printDayTitle('30/07/2026'), 'יום ה׳ · 30/07/2026');
  // 26/07/2026 is a Sunday → יום א׳, the week's first day
  assert.equal(printDayTitle('26/07/2026'), 'יום א׳ · 26/07/2026');
  // Saturday is ש, not ז
  assert.equal(printDayTitle('01/08/2026'), 'יום ש׳ · 01/08/2026');
});

test('day title accepts the draft tab\'s ISO form too', () => {
  // parseAnyDate handles both separators; the label echoes what it was given.
  assert.equal(printDayTitle('2026-07-30'), 'יום ה׳ · 2026-07-30');
});

test('day title is empty before a date is selected', () => {
  // selectedDate starts as '' for a tick before the defaulting effect runs.
  assert.equal(printDayTitle(''), '');
});

test('day title falls back to the raw string it cannot parse', () => {
  assert.equal(printDayTitle('not a date'), 'not a date');
});

// ── printDocTitle: the browser's print header + default PDF filename ────────

test('doc title strips the slashes a filename cannot hold', () => {
  assert.equal(printDocTitle('30/07/2026'), 'שבצק 30-07-2026');
  assert.ok(!printDocTitle('30/07/2026').includes('/'));
});

test('doc title has no trailing space when there is no date', () => {
  assert.equal(printDocTitle(''), 'שבצק');
});

// ── mergeCommanderSubType: the print-only "מפקד X" + "X" fold ───────────────

const slot = (time: string, soldiers: string[], ms: number) =>
  ({ time, gray: false, dateLabel: '', soldiers, ms });

test('folds a מפקד sub-type into its pair, commander first and tagged', () => {
  const merged = mergeCommanderSubType([
    { sug: 'מפקד כרמל חטיבה', times: [slot('10:00', ['א'], 600)] },
    { sug: 'כרמל חטיבה', times: [slot('10:00', ['ב', 'ג'], 600)] },
  ]);
  assert.ok(merged);
  assert.equal(merged.length, 1, 'two columns become one');
  assert.equal(merged[0].sug, 'כרמל חטיבה', 'keeps the plain sub-type label');
  assert.deepEqual(merged[0].times[0].soldiers, ['א' + CMD_TAG, 'ב', 'ג']);
});

test('merges across the union of time slots, not just shared ones', () => {
  const merged = mergeCommanderSubType([
    { sug: 'מפקד כרמל', times: [slot('10:00', ['א'], 600), slot('22:00', ['ב'], 1320)] },
    { sug: 'כרמל', times: [slot('14:00', ['ג'], 840), slot('22:00', ['ד'], 1320)] },
  ]);
  assert.ok(merged);
  // sorted by ms, every slot present, commander-only and rest-only both kept
  assert.deepEqual(merged[0].times.map(t => t.time), ['10:00', '14:00', '22:00']);
  assert.deepEqual(merged[0].times.map(t => t.soldiers),
    [['א' + CMD_TAG], ['ג'], ['ב' + CMD_TAG, 'ד']]);
});

test('leaves every other shape alone so it prints as it appears', () => {
  // not a pair
  assert.equal(mergeCommanderSubType([{ sug: 'כרמל', times: [] }]), null);
  // two sub-types, but neither is the other's commander
  assert.equal(mergeCommanderSubType([
    { sug: 'בונקר', times: [] }, { sug: 'שג', times: [] },
  ]), null);
  // a מפקד of something else entirely
  assert.equal(mergeCommanderSubType([
    { sug: 'מפקד סיור', times: [] }, { sug: 'כרמל חטיבה', times: [] },
  ]), null);
});
