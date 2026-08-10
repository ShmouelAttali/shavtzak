// חמל is not part of the שבצק: that crew runs its own rotation in the sheet's
// own `שיבוץ חמל` tab, and the חמל rows inside `כל השבצק` are a hand-copied
// echo that drifts (11 of 39 shared days disagreed on 2026-08-10, and five days
// were blank there while the חמל tab had them). Owner decision 2026-08-10:
// `/api/shavtzak` builds the חמל group from `שיבוץ חמל`.
//
// These lock the three things that were easy to get wrong: the tab wins for a
// date it covers, it does NOT erase history for dates it predates, and its
// dates are literal (02:00 belongs to the calendar day it happens on, so it
// sorts within that day and never rolls into the previous one).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseShavtzakAll, parseHamalShifts } from '../api/_handlers/shavtzak';

const MAIN_HEADER = ['תאריך', 'העמדה', 'סוג', 'השעה', 'החייל'];
const HAMAL_HEADER = ['תאריך', 'שעה', 'שם החייל', ''];

// Two days. Both carry a סיור group; both carry stale חמל rows.
const mainRows = [
  MAIN_HEADER,
  ['06/07/2026', 'סיור', 'סיור', '14:00', 'דני'],
  ['06/07/2026', 'חמל', 'חמל', '10:00', 'מישהו אחר'],
  ['06/07/2026', 'חמל', 'חמל', '18:00', 'מישהו אחר'],
  ['07/07/2026', 'סיור', 'סיור', '14:00', 'רוני'],
  ['07/07/2026', 'חמל', 'חמל', '10:00', 'עוד מישהו'],
];

// Covers only 07/07 — 06/07 predates it, exactly like the real tab starting
// eleven days after `כל השבצק` does.
const hamalRows = [
  HAMAL_HEADER,
  ['07/07/2026', '02:00', 'אלחנן שמידוב', ''],
  ['07/07/2026', '10:00', 'אריה הופמן', ''],
  ['07/07/2026', '18:00', 'איתן המאירי', 'שבת'],
  // trailing template rows the tab really does carry: a time, no date, no name
  ['', '02:00', '', ''],
  ['', '10:00', '', ''],
];

const hamalOf = (data: ReturnType<typeof parseShavtzakAll>, date: string) =>
  data.byDate[date].groups.find(g => g.name === 'חמל');

test('the חמל tab replaces כל השבצק\'s חמל rows for a date it covers', () => {
  const data = parseShavtzakAll(mainRows, hamalRows);
  const hamal = hamalOf(data, '07/07/2026');

  assert.ok(hamal, 'חמל group present');
  assert.equal(hamal.subTypes.length, 1);
  assert.deepEqual(
    hamal.subTypes[0].times.map(t => t.soldiers),
    [['אריה הופמן'], ['איתן המאירי'], ['אלחנן שמידוב']],
  );
  // the stale name from `כל השבצק` is gone entirely
  assert.equal(JSON.stringify(hamal).includes('עוד מישהו'), false);
});

test('a date the חמל tab does not cover keeps כל השבצק\'s own חמל rows', () => {
  const data = parseShavtzakAll(mainRows, hamalRows);
  const hamal = hamalOf(data, '06/07/2026');

  assert.ok(hamal, 'history is not erased');
  assert.deepEqual(
    hamal.subTypes[0].times.map(t => [t.time, t.soldiers]),
    [['10:00', ['מישהו אחר']], ['18:00', ['מישהו אחר']]],
  );
});

test('non-חמל groups are untouched by the swap', () => {
  const data = parseShavtzakAll(mainRows, hamalRows);
  for (const date of ['06/07/2026', '07/07/2026']) {
    const siur = data.byDate[date].groups.find(g => g.name === 'סיור');
    assert.ok(siur, `סיור present on ${date}`);
    assert.deepEqual(siur.subTypes[0].times, [
      { time: '14:00', soldiers: [date === '06/07/2026' ? 'דני' : 'רוני'] },
    ]);
  }
});

test('a day only the חמל tab knows about still appears, with just the חמל card', () => {
  // The חמל is planned further ahead than the שבצק. Hiding the day would hide
  // a חמל soldier's next shift from לוז אישי — the people this change is for.
  const ahead = [...hamalRows, ['13/08/2026', '10:00', 'קובי מלצר', '']];
  const data = parseShavtzakAll(mainRows, ahead);

  assert.deepEqual(data.dates, ['06/07/2026', '07/07/2026', '13/08/2026']);
  assert.deepEqual(
    data.byDate['13/08/2026'].groups,
    [{ name: 'חמל', subTypes: [{ sug: 'חמל', times: [{ time: '10:00', soldiers: ['קובי מלצר'] }] }] }],
  );
});

test('rows without a real date or without a name are dropped, never carried forward', () => {
  // There is deliberately no blank-date carry-forward here (unlike `כל השבצק`):
  // 02:00 sits at the TOP of its own date's block in this tab, so an implied
  // date would be a guess, and the trailing template rows would invent shifts.
  const shifts = parseHamalShifts(hamalRows);
  assert.deepEqual([...shifts.keys()], ['07/07/2026']);
  assert.equal(shifts.get('07/07/2026')!.length, 3);
});

test('a missing/unreadable חמל tab leaves the sheet\'s own חמל rows standing', () => {
  // The handler passes [] when the חמל read fails, so a renamed tab degrades to
  // the old behaviour instead of blanking the group.
  const data = parseShavtzakAll(mainRows, []);
  assert.ok(hamalOf(data, '06/07/2026'));
  assert.ok(hamalOf(data, '07/07/2026'));
  assert.deepEqual(data.dates, ['06/07/2026', '07/07/2026']);
});

test('the חמל tab alone still yields a usable payload when כל השבצק is empty', () => {
  const data = parseShavtzakAll([], hamalRows);
  assert.deepEqual(data.dates, ['07/07/2026']);
  assert.equal(hamalOf(data, '07/07/2026')!.subTypes[0].times.length, 3);
});
