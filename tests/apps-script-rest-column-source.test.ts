import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';

/**
 * v3.20: the מנוחה column names the source of the gap when it was measured off
 * a daily כוננות התקפית — "4ש׳ (מהתקפי)".
 *
 * v3.14 deliberately made that column show the *raw* gap, so that the number on
 * screen always matches what is written in the שבצק, and left the credit to be
 * explained in the התאמה column. That is still true here: the marker is added,
 * the number is not touched. Without it a bare "0ש׳" on a row the engine
 * happily recommends reads as a bug rather than as the credit doing its job.
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
vm.runInContext(';globalThis.REC = SHABTZAK_REC_CONFIG;', ctx);

const REC = ctx.REC;
const YESTERDAY = new Date(2026, 7, 10);
const TODAY = new Date(2026, 7, 11);

function task(position: string, type: string, timeValue: string, baseDate: Date, rowNumber = 40) {
  return ctx.buildTaskFromFields_({
    rowNumber, position, type, timeValue, assigned: '',
    baseDate, explicitDate: true, config: REC,
  });
}

function soldier() {
  return {
    name: 'אמיתי שמעון',
    nameKey: ctx.normalizeNameKey_('אמיתי שמעון'),
    role: 'לוחם',
    platoon: '2',
    statusYesterday: 'נוכח',
    statusToday: 'נוכח',
    statusTomorrow: 'נוכח',
    isCommander: false,
    isSeniorCommander: false,
    isStaticCommander: false,
    isDudDriver: false,
    isTigerDriver: false,
  };
}

function evaluate(slot: any, history: any[]) {
  const s = soldier();
  const assignmentsBySoldier: Record<string, any[]> = {};
  assignmentsBySoldier[s.nameKey] = history.map((t: any) => {
    const a = ctx.taskToAssignment_(t, REC);
    a.source = 'history';
    a.soldierName = s.name;
    a.soldierKey = s.nameKey;
    return a;
  });

  return ctx.evaluateCandidateForTask_(s, slot, {
    config: REC,
    baseDate: TODAY,
    availabilityCache: {},
    statsCache: {},
    assignmentsBySoldier,
    currentBySoldier: {},
    currentTasks: [slot],
    soldiersByName: { [s.nameKey]: s },
    group: { tasks: [slot] },
    ignoreSameRow: false,
    excludeAssignedSameOperationalDay: false,
  });
}

const dailyAttack = () => task('התקפי', 'התקפי', 'יומי', YESTERDAY);
const staticSlot = () => task('עמדות הגנה', 'מזרחית', '14:00', TODAY);

test('coming off a daily התקפי marks the rest column', () => {
  const ev = evaluate(staticSlot(), [dailyAttack()]);
  assert.equal(ev.restBeforeFromAttackReadiness, true);
  assert.equal(ctx.formatRestCell_(ev), ctx.formatRestShort_(ev.restBeforeHours) + ' (מהתקפי)');
});

test('the marker does not change the number — v3.14 still holds', () => {
  const ev = evaluate(staticSlot(), [dailyAttack()]);
  // the התקפי ends exactly when the slot starts, so the true gap is 0 —
  // the 4h credit is what makes him eligible, and it stays out of the digits.
  assert.equal(ev.restBeforeHours, 0);
  assert.match(ctx.formatRestCell_(ev), /^0/);
});

test('an ordinary previous shift is not marked', () => {
  const ev = evaluate(staticSlot(), [task('עמדות הגנה', 'שג', '02:00', TODAY, 39)]);
  assert.equal(ev.restBeforeFromAttackReadiness, false);
  assert.equal(ctx.formatRestCell_(ev), ctx.formatRestShort_(ev.restBeforeHours));
});

test('an התקפי written with a real time range is an ordinary shift, so no marker', () => {
  // only the daily form earns the credit (restCreditAfter_), and the marker
  // must track the credit rather than the word "התקפי"
  const timed = task('התקפי', 'התקפי', '06:00-14:00', TODAY, 39);
  const ev = evaluate(staticSlot(), [timed]);
  assert.equal(ev.restBeforeFromAttackReadiness, false);
});

test('no previous assignment at all leaves the cell as it was', () => {
  const ev = evaluate(staticSlot(), []);
  assert.equal(ev.restBeforeFromAttackReadiness, false);
  assert.equal(ctx.formatRestCell_(ev), ctx.formatRestShort_(ev.restBeforeHours));
});

test('formatRestCell_ is safe on an empty evaluation', () => {
  assert.equal(ctx.formatRestCell_(null), '');
  assert.equal(ctx.formatRestCell_({ restBeforeHours: null, restBeforeFromAttackReadiness: true }), '');
});
