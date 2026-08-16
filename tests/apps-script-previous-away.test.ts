import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';

/**
 * v3.21: the "משימה קודמת" column used to always name the last real shift, even
 * when the soldier had been at home ever since. It now says חופש / יציאה when
 * one of those falls in the gap between that shift and the slot.
 *
 * Both files are loaded in filename order, as Apps Script concatenates them:
 * parseExitStatus_ and the vacation helpers live in ShabtzakOps.js.
 */
const DIR = path.join(process.cwd(), 'apps-script/plugat-gaash');

const ctx: any = {
  console, Date, Math, JSON, String, Number, Boolean, Array, Object, Map, Set,
  isNaN, parseInt, parseFloat, RegExp, Error, Infinity,
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
const MONDAY = new Date(2026, 7, 10);
const TUESDAY = new Date(2026, 7, 11);
const SUNDAY = new Date(2026, 7, 9);

test('the fixture dates are the weekdays this file assumes', () => {
  assert.equal(MONDAY.getDay(), 1);
  assert.equal(SUNDAY.getDay(), 0);
});

function soldier(statusYesterday: string, statusToday: string, statusTomorrow: string) {
  return {
    name: 'אמיתי שמעון',
    nameKey: ctx.normalizeNameKey_('אמיתי שמעון'),
    role: 'לוחם',
    platoon: '2',
    statusYesterday,
    statusToday,
    statusTomorrow,
    isCommander: false,
    isSeniorCommander: false,
    isStaticCommander: false,
    isDudDriver: false,
    isTigerDriver: false,
  };
}

/** a task on the calendar day `date` at `timeValue` */
function task(timeValue: string, date: Date, rowNumber = 30, position = 'עמדות הגנה', type = 'מזרחית') {
  return ctx.buildTaskFromFields_({
    rowNumber, position, type, timeValue,
    assigned: '', baseDate: date, explicitDate: true, config: REC,
  });
}

/** a history assignment for `s`, the same way the engine builds them */
function assignment(s: any, timeValue: string, date: Date, position = 'סיור', type = 'סיור') {
  const t = ctx.buildTaskFromFields_({
    rowNumber: 900, position, type, timeValue,
    assigned: s.name, baseDate: date, explicitDate: true, config: REC,
  });
  return ctx.taskToAssignment_(t, REC);
}

/** what the משימה קודמת column would show for this candidate */
function previousColumn(s: any, slot: any, baseDate: Date, history: any[] = []) {
  const res = ctx.evaluateCandidateForTask_(s, slot, {
    config: REC,
    baseDate,
    availabilityCache: {},
    statsCache: {},
    assignmentsBySoldier: { [s.nameKey]: history },
    currentBySoldier: {},
    currentTasks: [slot],
    soldiersByName: { [s.nameKey]: s },
    group: { tasks: [slot] },
    ignoreSameRow: false,
    excludeAssignedSameOperationalDay: false,
  });
  assert.equal(res.rejected, false, 'candidate unexpectedly rejected: ' + res.rejectReason);
  return ctx.formatPreviousAssignmentForCell_(res);
}

/* ---------------- the windows ---------------- */

test('a full vacation day is a whole-day window; transition days are partial', () => {
  // yesterday=חופש with no column before it -> full day (same rule as v3.18)
  const full = ctx.vacationWindowsForSoldier_(soldier('חופש', 'נוכח', 'נוכח'), MONDAY);
  assert.equal(full.length, 2);                       // the vacation day + the return day
  assert.deepEqual(full[0].start, new Date(2026, 7, 9, 0, 0));
  assert.deepEqual(full[0].end, new Date(2026, 7, 10, 0, 0));
  // MONDAY is the return day: home until 06:00
  assert.deepEqual(full[1].start, new Date(2026, 7, 10, 0, 0));
  assert.deepEqual(full[1].end, new Date(2026, 7, 10, 6, 0));

  // the day he leaves: home *from* the change time
  const leaving = ctx.vacationWindowsForSoldier_(soldier('נוכח', 'חופש', 'חופש'), MONDAY);
  assert.deepEqual(leaving[0].start, new Date(2026, 7, 10, 6, 0));
  assert.deepEqual(leaving[0].end, new Date(2026, 7, 11, 0, 0));
});

test('the Sunday change hour (09:00) is used for a Sunday window', () => {
  // baseDate SUNDAY, yesterday=חופש, today=נוכח -> back on Sunday at 09:00
  const windows = ctx.vacationWindowsForSoldier_(soldier('חופש', 'נוכח', 'נוכח'), SUNDAY);
  const returnDay = windows[windows.length - 1];
  assert.deepEqual(returnDay.end, new Date(2026, 7, 9, 9, 0));
});

test('no vacation status means no window at all', () => {
  assert.equal(ctx.vacationWindowsForSoldier_(soldier('נוכח', 'נוכח', 'נוכח'), MONDAY).length, 0);
  // לא מגויס is not a חופש — it never had a transition and gets none here either
  assert.equal(ctx.vacationWindowsForSoldier_(soldier('נוכח', 'לא מגויס', 'נוכח'), MONDAY).length, 0);
});

test('the long-exit threshold is a config value, and it is strictly greater', () => {
  assert.equal(REC.previousColumn.longExitMinHours, 8);
  const long = (status: string) =>
    ctx.longExitWindowsForSoldier_(soldier('', status, ''), MONDAY, REC).length;

  assert.equal(long('יציאה מ10 עד 22'), 1);   // 12h
  assert.equal(long('יציאה עד 10'), 1);       // 10h, midnight -> 10:00
  assert.equal(long('יציאה מ20'), 0);         // 4h, to midnight
  assert.equal(long('יציאה מ8 עד 16'), 0);    // exactly 8h — "longer than 8" excludes it
  assert.equal(long('יציאה מ8 עד 17'), 1);    // 9h
  assert.equal(long('יציאה בערב'), 0);        // legacy dropdown value, no times
});

/* ---------------- the column ---------------- */

test('without a vacation the column still names the last shift', () => {
  const s = soldier('נוכח', 'נוכח', 'נוכח');
  const history = [assignment(s, '22:00-06:00', new Date(2026, 7, 8))];
  assert.equal(previousColumn(s, task('14:00-22:00', MONDAY), MONDAY, history), 'סיור 22:00-06:00');
});

test('a vacation between the last shift and the slot replaces it', () => {
  // shift on Saturday night, חופש Sunday, back Monday at 06:00, slot Monday 14:00
  const s = soldier('חופש', 'נוכח', 'נוכח');
  const history = [assignment(s, '22:00-06:00', new Date(2026, 7, 8))];
  assert.equal(previousColumn(s, task('14:00-22:00', MONDAY), MONDAY, history), 'חופש');
});

test('a vacation that ended BEFORE the last shift is irrelevant', () => {
  // חופש Sunday, back Monday 06:00, then a real shift Monday 06:00-14:00
  const s = soldier('חופש', 'נוכח', 'נוכח');
  const history = [assignment(s, '06:00-14:00', MONDAY)];
  assert.equal(previousColumn(s, task('14:00-22:00', MONDAY), MONDAY, history), 'סיור 06:00-14:00');
});

test('with no previous shift at all a vacation is still reported', () => {
  const s = soldier('חופש', 'נוכח', 'נוכח');
  assert.equal(previousColumn(s, task('14:00-22:00', MONDAY), MONDAY, []), 'חופש');
});

test('with neither a shift nor a vacation the column is unchanged', () => {
  const s = soldier('נוכח', 'נוכח', 'נוכח');
  assert.equal(previousColumn(s, task('14:00-22:00', MONDAY), MONDAY, []), 'אין');
});

test('a long exit before the slot replaces the last shift, with its hours', () => {
  // exit 10:00-22:00 today; last shift was yesterday evening; slot at 22:00
  const s = soldier('נוכח', 'יציאה מ10 עד 22', 'נוכח');
  const history = [assignment(s, '14:00-22:00', new Date(2026, 7, 9))];
  assert.equal(previousColumn(s, task('22:00-06:00', MONDAY), MONDAY, history), 'יציאה 10:00-22:00');
});

test('a short exit does not replace anything', () => {
  // the exit is yesterday's, 20:00-24:00 — only 4h, under the threshold
  const s = soldier('יציאה מ20', 'נוכח', 'נוכח');
  const history = [assignment(s, '06:00-14:00', new Date(2026, 7, 9))];
  assert.equal(previousColumn(s, task('14:00-22:00', MONDAY), MONDAY, history), 'סיור 06:00-14:00');
});

test('an exit that starts after the slot is not "what he has been doing"', () => {
  // exit tomorrow 00:00-10:00, slot today 14:00-22:00 — entirely in the future
  const s = soldier('נוכח', 'נוכח', 'יציאה עד 10');
  const history = [assignment(s, '06:00-14:00', new Date(2026, 7, 9))];
  assert.equal(previousColumn(s, task('14:00-22:00', MONDAY), MONDAY, history), 'סיור 06:00-14:00');
});

test('when both apply the most recent one wins', () => {
  // חופש yesterday, back today 06:00, then a long exit today 10:00-22:00,
  // and no shift since Saturday. The exit is the newer fact.
  const s = soldier('חופש', 'יציאה מ10 עד 22', 'נוכח');
  const history = [assignment(s, '14:00-22:00', new Date(2026, 7, 8))];
  assert.equal(previousColumn(s, task('22:00-06:00', MONDAY), MONDAY, history), 'יציאה 10:00-22:00');
});

test('a vacation that outlasts an earlier exit wins instead', () => {
  // Straight at the helper: a candidate in this state is rejected long before
  // the column is rendered (he is on חופש on the slot's own day), so the
  // ordering rule can only be exercised here. With three roster columns this
  // is in fact the only shape where a vacation is the *later* of the two.
  const s = soldier('יציאה מ10 עד 22', 'חופש', 'חופש');
  const prev = assignment(s, '14:00-22:00', new Date(2026, 7, 8));
  const slot = task('14:00-22:00', TUESDAY);
  assert.equal(ctx.previousAwayLabelForSlot_(s, prev, slot, MONDAY, REC), 'חופש');

  // and with the exit as the later one, the exit wins
  const s2 = soldier('חופש', 'נוכח', 'יציאה מ10 עד 22');
  assert.equal(ctx.previousAwayLabelForSlot_(s2, prev, slot, MONDAY, REC), 'יציאה 10:00-22:00');
});

test('the reason note carries the same text as the cell', () => {
  const s = soldier('חופש', 'נוכח', 'נוכח');
  const slot = task('14:00-22:00', MONDAY);
  const res = ctx.evaluateCandidateForTask_(s, slot, {
    config: REC, baseDate: MONDAY, availabilityCache: {}, statsCache: {},
    assignmentsBySoldier: { [s.nameKey]: [assignment(s, '22:00-06:00', new Date(2026, 7, 8))] },
    currentBySoldier: {}, currentTasks: [slot], soldiersByName: { [s.nameKey]: s },
    group: { tasks: [slot] }, ignoreSameRow: false, excludeAssignedSameOperationalDay: false,
  });
  assert.equal(res.previousAwayLabel, 'חופש');
  assert.match(ctx.formatRecommendationPreviousColumn_([res]), /^1\. חופש$/);
});
