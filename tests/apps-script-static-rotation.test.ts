import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';

/**
 * v3.14: warn when a soldier spends more than MAX_CONSECUTIVE_STATIC_DAYS
 * consecutive operational days on עמדות הגנה.
 *
 * A static day is two 4-hour rounds (e.g. 14-18 and 02-06), so the number of
 * rounds *inside* a day is already policed by the 8-hour cap. What was missing
 * is the day-to-day rotation: after a static day the soldier is meant to move
 * to a dynamic one (סיור / התקפי). A third static day in a row is a warning,
 * not an error — sometimes there is no choice.
 */
const OPS = path.join(process.cwd(), 'apps-script/plugat-gaash/ShabtzakOps.js');
const ctx: any = {
  console, Date, Math, JSON, String, Number, Boolean, Array, Object, Map, Set,
  isNaN, parseInt, parseFloat, RegExp, Error,
  SpreadsheetApp: {
    getUi: () => ({ createMenu: () => ({ addItem() { return this; }, addSeparator() { return this; }, addToUi() {} }) }),
  },
  HtmlService: {},
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(OPS, 'utf8') + '\n;globalThis.CONFIG = CONFIG;\n', ctx);

const MAX = ctx.CONFIG.MAX_CONSECUTIVE_STATIC_DAYS;
const TARGET = new Date(2026, 7, 10); // op day 10/08/2026

/* ------------------------- what counts as static ------------------------- */

test('isDefensePostShift_ recognises the סוג column and the four posts', () => {
  assert.equal(ctx.isDefensePostShift_({ type: 'עמדות הגנה', position: 'שג' }), true);
  for (const position of ['שג', 'מזרחית', 'בונקר', 'דרומית']) {
    assert.equal(ctx.isDefensePostShift_({ type: 'משהו אחר', position }), true, position);
  }
});

test('סיור, התקפי, כרמל and גשש are not עמדות הגנה', () => {
  assert.equal(ctx.isDefensePostShift_({ type: 'סיור', position: 'סיור' }), false);
  assert.equal(ctx.isDefensePostShift_({ type: 'התקפי', position: 'כוננות' }), false);
  assert.equal(ctx.isDefensePostShift_({ type: 'כרמל חטיבה', position: 'כרמל חטיבה' }), false);
  assert.equal(ctx.isDefensePostShift_({ type: 'כונן גשש', position: 'גשש' }), false);
  assert.equal(ctx.isDefensePostShift_(null), false);
});

/* ------------------------------ the streak ------------------------------ */

type Kind = 'static' | 'tour';

const shift = (soldier: string, kind: Kind, date = TARGET) =>
  kind === 'static'
    ? { soldier, date, type: 'עמדות הגנה', position: 'שג', timeText: '14:00-18:00' }
    : { soldier, date, type: 'סיור', position: 'סיור', timeText: '14:00' };

/** history in the order the script builds it: yesterday, the day before, ... */
function history(days: Kind[][], soldiers: string[][] = []) {
  return days.map((kinds, i) => ({
    opDay: new Date(2026, 7, 10 - (i + 1)),
    shifts: kinds.map((kind, j) => shift((soldiers[i] ?? [])[j] ?? 'אבי כהן', kind, new Date(2026, 7, 10 - (i + 1)))),
  }));
}

function warn(today: Kind, previous: Kind[][]) {
  const warnings: string[] = [];
  ctx.validateConsecutiveStaticDays_([shift('אבי כהן', today)], history(previous), warnings);
  return warnings;
}

test(`${MAX} consecutive static days is fine — that is the allowed rotation`, () => {
  assert.deepEqual(warn('static', [['static'], ['tour'], ['tour']]), []);
});

test(`${MAX + 1} consecutive static days warns, and names the soldier`, () => {
  const warnings = warn('static', [['static'], ['static'], ['tour']]);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /אבי כהן/);
  assert.match(warnings[0], new RegExp(`${MAX + 1} ימים רצופים בעמדות הגנה`));
});

test('the warning reports the true streak length and its first day', () => {
  const warnings = warn('static', [['static'], ['static'], ['static'], ['static']]);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /5 ימים רצופים/);
  assert.match(warnings[0], /מ־06\/08\/2026/);
});

test('a dynamic day breaks the streak: static, סיור, static does not warn', () => {
  assert.deepEqual(warn('static', [['tour'], ['static'], ['static']]), []);
});

test('a dynamic day today never warns, however long the static run behind it', () => {
  assert.deepEqual(warn('tour', [['static'], ['static'], ['static'], ['static']]), []);
});

test('a day with no assignment at all breaks the streak', () => {
  assert.deepEqual(warn('static', [[], ['static'], ['static']]), []);
});

test('when the whole read history is static the count is prefixed לפחות', () => {
  const warnings = warn('static', [['static'], ['static'], ['static']]);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /^לפחות 4 ימים רצופים/);
});

test('too little history to establish a streak: no warning', () => {
  const warnings: string[] = [];
  ctx.validateConsecutiveStaticDays_([shift('אבי כהן', 'static')], history([['static']]), warnings);
  assert.deepEqual(warnings, []);
});

test('ignored placeholder names never warn', () => {
  const warnings: string[] = [];
  const days = history([['static'], ['static']], [['הפלוגה הקודמת'], ['הפלוגה הקודמת']]);
  ctx.validateConsecutiveStaticDays_([shift('הפלוגה הקודמת', 'static')], days, warnings);
  assert.deepEqual(warnings, []);
});

test('each soldier is judged separately', () => {
  const warnings: string[] = [];
  const days = [
    { opDay: new Date(2026, 7, 9), shifts: [shift('אבי כהן', 'static'), shift('דוד לוי', 'tour')] },
    { opDay: new Date(2026, 7, 8), shifts: [shift('אבי כהן', 'static'), shift('דוד לוי', 'static')] },
    { opDay: new Date(2026, 7, 7), shifts: [shift('דוד לוי', 'static')] },
  ];
  ctx.validateConsecutiveStaticDays_(
    [shift('אבי כהן', 'static'), shift('דוד לוי', 'static')],
    days,
    warnings,
  );
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /אבי כהן/);
});

test('MAX_CONSECUTIVE_STATIC_DAYS = 0 turns the check off', () => {
  const saved = ctx.CONFIG.MAX_CONSECUTIVE_STATIC_DAYS;
  ctx.CONFIG.MAX_CONSECUTIVE_STATIC_DAYS = 0;
  try {
    assert.deepEqual(warn('static', [['static'], ['static'], ['static']]), []);
  } finally {
    ctx.CONFIG.MAX_CONSECUTIVE_STATIC_DAYS = saved;
  }
});

/* ------------------ op-day grouping through getOpDayShifts_ ------------------ */

test('a 06:00 row dated the next morning belongs to the previous op day', () => {
  // this is what made the real 7-day streak real: 06:00 on 22/07 is op day 21/07
  const rows = [
    { rowNumber: 2, date: new Date(2026, 6, 22), position: 'דרומית', type: 'עמדות הגנה', timeText: '06:00-10:00', soldier: 'אבי כהן' },
    { rowNumber: 3, date: new Date(2026, 6, 22), position: 'שג', type: 'עמדות הגנה', timeText: '18:00-22:00', soldier: 'אבי כהן' },
  ];
  const prev = ctx.getOpDayShifts_(rows, new Date(2026, 6, 21), [], [], 'test');
  const same = ctx.getOpDayShifts_(rows, new Date(2026, 6, 22), [], [], 'test');
  assert.equal(prev.length, 1);
  assert.equal(prev[0].timeText, '06:00-10:00');
  assert.equal(same.length, 1);
  assert.equal(same[0].timeText, '18:00-22:00');
});
