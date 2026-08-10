import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';

/**
 * v3.19, two related things:
 *
 * 1. The validator and the engine must agree on what a mission is WORTH.
 *    ShabtzakOps has always counted a daily mission as CONFIG.DAILY_HOURS (8)
 *    and a כוננות התקפית as 0; the engine counted 16 for both. A soldier on the
 *    daily standby was therefore over maxSameDayMissionHours (10) before he was
 *    given anything, and came out "בדוחק" on every slot of that operational day.
 *    This is the same drift that v3.16 fixed for כונן גשש.
 *
 * 2. Four different rules print the same word "בדוחק", and three of them are
 *    invisible on screen. The marker now carries a short reason.
 */
const DIR = path.join(process.cwd(), 'apps-script/plugat-gaash');
const ctx: any = {
  console, Date, Math, JSON, String, Number, Boolean, Array, Object, Map, Set,
  isNaN, parseInt, parseFloat, RegExp, Error,
  SpreadsheetApp: {
    getUi: () => ({ createMenu: () => ({ addItem() { return this; }, addSeparator() { return this; }, addToUi() {} }) }),
  },
  HtmlService: {},
};
vm.createContext(ctx);
for (const f of ['ShabtzakOps.js', 'ShavtzakRecommendation.js']) {
  vm.runInContext(fs.readFileSync(path.join(DIR, f), 'utf8'), ctx);
}
vm.runInContext(';globalThis.CONFIG = CONFIG; globalThis.REC = SHABTZAK_REC_CONFIG;', ctx);

const REC = ctx.REC;
const DAY = new Date(2026, 7, 11); // 11/08/2026

function task(position: string, type: string, timeValue: string, baseDate = DAY, rowNumber = 40) {
  return ctx.buildTaskFromFields_({
    rowNumber, position, type, timeValue, assigned: '',
    baseDate, explicitDate: true, config: REC,
  });
}
const asAssignment = (t: any) => {
  const a = ctx.taskToAssignment_(t, REC);
  a.source = 'history';
  return a;
};

/* ---------------- the two files must agree ---------------- */

test('a daily mission is worth the same in the engine as in the validator', () => {
  // the whole point: one number, two files. If someone changes CONFIG.DAILY_HOURS
  // and not this, the engine starts marking בדוחק on schedules the validator likes.
  assert.equal(REC.scoring.dailyMissionWorkloadHours, ctx.CONFIG.DAILY_HOURS);
});

test('כוננות התקפית is recognised through the validator\'s own rule', () => {
  // isAttackReadiness_ lives in ShabtzakOps.js and needs BOTH words
  assert.equal(ctx.isAttackReadinessAssignment_({ position: 'כוננות התקפית', type: 'התקפי' }), true);
  assert.equal(ctx.isAttackReadinessAssignment_({ position: 'התקפי', type: 'התקפי' }), false);
  assert.equal(ctx.isAttackReadinessAssignment_({ position: 'כרמל', type: 'כרמל' }), false);
  assert.equal(ctx.isAttackReadinessAssignment_(null), false);
});

/* ---------------- same-operational-day load ---------------- */

const sameDay = (assignments: any[], forTask: any) =>
  ctx.calculateSameOperationalDayHours_(assignments, forTask, REC);

test('a daily mission costs 8 hours of load, not 16', () => {
  const daily = asAssignment(task('קצין מוצב', 'קצין מוצב', 'יומי'));
  const slot = task('עמדות הגנה', 'מזרחית', '02:00', new Date(2026, 7, 12), 41);
  assert.equal(sameDay([daily], slot).missionHours, ctx.CONFIG.DAILY_HOURS);
});

test('כוננות התקפית costs 0 hours of mission load, like כרמל and the גשש', () => {
  const readiness = asAssignment(task('כוננות התקפית', 'התקפי', 'יומי'));
  const slot = task('עמדות הגנה', 'מזרחית', '02:00', new Date(2026, 7, 12), 41);
  const res = sameDay([readiness], slot);
  assert.equal(res.missionHours, 0);
  assert.ok(res.konenutHours > 0, 'the hours should still be visible as כוננות');
});

test('an ordinary shift is unaffected', () => {
  const shift = asAssignment(task('עמדות הגנה', 'מזרחית', '14:00'));
  const slot = task('עמדות הגנה', 'דרומית', '02:00', new Date(2026, 7, 12), 41);
  assert.equal(sameDay([shift], slot).missionHours, 4);
});

/* ---------------- the 7-day counter uses the same rule ---------------- */

test('the 7-day totals count the standby the same way — no new gap between the two counters', () => {
  const readiness = asAssignment(task('כוננות התקפית', 'התקפי', 'יומי'));
  const stats = ctx.calculateStats_([readiness], new Date(2026, 7, 12, 14, 0), REC);
  assert.equal(stats.totalHours, 0);
  assert.ok(stats.konenutHours > 0);

  const daily = asAssignment(task('קצין מוצב', 'קצין מוצב', 'יומי'));
  const dailyStats = ctx.calculateStats_([daily], new Date(2026, 7, 12, 14, 0), REC);
  assert.equal(dailyStats.totalHours, ctx.CONFIG.DAILY_HOURS);
});

/* ---------------- the marker explains itself ---------------- */

test('בדוחק carries its reason into the candidates cell', () => {
  const ev = (name: string, fallback: boolean, short = '') => ({
    soldier: { name }, fallback, fallbackShort: short,
  });
  const text = ctx.formatRecommendationNamesColumn_([
    ev('אורי רום', false),
    ev('אריאל ביר', true, 'עומס 16ש׳'),
    ev('מנדי הלפרין', true, 'מנוחה אחרי 0ש׳'),
  ]);
  assert.equal(
    text,
    '1. אורי רום\n2. אריאל ביר (בדוחק: עומס 16ש׳)\n3. מנדי הלפרין (בדוחק: מנוחה אחרי 0ש׳)',
  );
});

test('a fallback with no label still renders the plain marker', () => {
  const text = ctx.formatRecommendationNamesColumn_([
    { soldier: { name: 'דני' }, fallback: true, fallbackShort: '' },
  ]);
  assert.equal(text, '1. דני (בדוחק)');
});

test('markFallback_ keeps the FIRST reason and its label together', () => {
  // two rules can fire on one candidate; the cell must not show reason A with label B
  const result: any = { score: 0, reasons: [], warnings: [] };
  ctx.markFallback_(result, 'יעבור 10ש׳ משימה היום (16ש׳)', REC, 'עומס 16ש׳');
  ctx.markFallback_(result, 'אחר כך פחות מ־4 שעות מנוחה', REC, 'מנוחה אחרי 0ש׳');
  assert.equal(result.fallbackReason, 'יעבור 10ש׳ משימה היום (16ש׳)');
  assert.equal(result.fallbackShort, 'עומס 16ש׳');
  assert.equal(result.warnings.length, 2, 'both reasons still surface in the warnings');
});
