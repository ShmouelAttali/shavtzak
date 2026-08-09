import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';

// The sheet's bound Apps Script (apps-script/plugat-gaash) is plain JS that only
// touches SpreadsheetApp/HtmlService *inside* functions, so the pure date/time
// helpers can be loaded into a vm and tested here.
const OPS = path.join(process.cwd(), 'apps-script/plugat-gaash/ShabtzakOps.js');

const ctx: any = {
  console, Date, Math, JSON, String, Number, Array, Object, Map, Set, isNaN, parseInt, parseFloat, RegExp, Error,
  SpreadsheetApp: { getUi: () => ({ createMenu: () => ({ addItem() { return this; }, addSeparator() { return this; }, addToUi() {} }) }) },
  HtmlService: {},
};
vm.createContext(ctx);
// top-level `const CONFIG` lives in script scope, not on the vm global
vm.runInContext(fs.readFileSync(OPS, 'utf8') + '\n;globalThis.CONFIG = CONFIG;\n', ctx);

const parse = (timeText: string, type = 'מגן השומרון', position = 'מגן + תגבצ') =>
  ctx.parseShiftTime_({ rowNumber: 1, timeText, type, position }, [], 'test');

test('"יומי" and "14:00-14:00" are the same mission', () => {
  const daily = parse('יומי');
  const fullRange = parse('14:00-14:00');

  assert.equal(daily.isDaily, true);
  assert.deepEqual(fullRange, daily);
  // counts DAILY_HOURS toward the cap, not 24
  assert.equal(fullRange.hoursForDailyTotal, ctx.CONFIG.DAILY_HOURS);
  // no real time range => excluded from the overlap check
  assert.equal(fullRange.hasRealTimeRange, false);
});

test('the long half of a split daily mission is daily; the short complement is not', () => {
  const long = parse('14:00-09:00');   // 19h — יום שלם עד ההעברה ב-09:00
  const short = parse('09:00-14:00');  // 5h  — המשלים

  assert.equal(long.isDaily, true);
  assert.equal(long.hoursForDailyTotal, ctx.CONFIG.DAILY_HOURS);
  assert.equal(long.hasRealTimeRange, false);

  assert.equal(short.isDaily, false);
  assert.equal(short.hasRealTimeRange, true);
  assert.equal(short.hoursForDailyTotal, 5);
});

test('ordinary shifts keep their real length and stay overlap-checked', () => {
  for (const [text, hours] of [['22:00-06:00', 8], ['19:30-6:00', 10.5], ['06:00-9:00', 3]] as const) {
    const s = parse(text);
    assert.equal(s.isDaily, false, text);
    assert.equal(s.hasRealTimeRange, true, text);
    assert.equal(s.hoursForDailyTotal, hours, text);
  }
});

test('the DAILY_MIN_SPAN_HOURS boundary', () => {
  assert.equal(parse('14:00-01:00').isDaily, false); // 11h
  assert.equal(parse('14:00-02:00').isDaily, true);  // 12h — at the threshold
});

test('תאריך is the literal calendar day; the operational day is a grouping over it', () => {
  // A 06:00 slot written on 12/08 belongs to the op day that started 11/08 14:00.
  const morning = ctx.operationalDayOfDateTime_(new Date(2026, 7, 12), 6 * 60);
  assert.equal(ctx.sameDate_(morning, new Date(2026, 7, 11)), true);

  // A 22:00 slot written on 11/08 belongs to that same op day.
  const evening = ctx.operationalDayOfDateTime_(new Date(2026, 7, 11), 22 * 60);
  assert.equal(ctx.sameDate_(evening, new Date(2026, 7, 11)), true);
});
