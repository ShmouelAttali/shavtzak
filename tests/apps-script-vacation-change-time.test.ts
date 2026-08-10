import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';

/**
 * v3.15: a חופש changes hands at 06:00 — 09:00 on a Sunday. So the first day of
 * a vacation and the day of return are *partial* days:
 *   - leaving:   a shift that ends by the change time is legal (02:00-06:00 ✓)
 *   - returning: only a shift that starts at or after it (06:00 ✓, 02:00 ✗)
 *
 * Both files are loaded in filename order, as Apps Script concatenates them:
 * the vacation helpers live in ShabtzakOps.js and are called from the engine,
 * exactly like parseExitStatus_.
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
const SUNDAY = new Date(2026, 7, 9);
const MONDAY = new Date(2026, 7, 10);
const TUESDAY = new Date(2026, 7, 11);

test('the fixture dates are the weekdays this file assumes', () => {
  assert.equal(SUNDAY.getDay(), 0);
  assert.equal(MONDAY.getDay(), 1);
});

/* ---------------- the shared helpers ---------------- */

test('the change time is 06:00, and 09:00 on Sunday', () => {
  assert.equal(ctx.vacationChangeMinutesForDate_(MONDAY), 6 * 60);
  assert.equal(ctx.vacationChangeMinutesForDate_(TUESDAY), 6 * 60);
  assert.equal(ctx.vacationChangeMinutesForDate_(SUNDAY), 9 * 60);
});

test('a day is classified by itself and the day before it', () => {
  assert.equal(ctx.vacationTransitionForDay_('נוכח', 'חופש'), 'start');
  assert.equal(ctx.vacationTransitionForDay_('חופש', 'חופש'), 'full');
  assert.equal(ctx.vacationTransitionForDay_('חופש', 'נוכח'), 'end');
  assert.equal(ctx.vacationTransitionForDay_('נוכח', 'נוכח'), '');
});

test('an unknown previous day never opens the window', () => {
  // '' is "no column / empty cell", not "present" — otherwise every day of a
  // vacation would look like its first day and 02:00-06:00 would be allowed
  // in the middle of one.
  assert.equal(ctx.vacationTransitionForDay_('', 'חופש'), 'full');
  assert.equal(ctx.vacationTransitionForDay_(undefined, 'חופש'), 'full');
  assert.equal(ctx.vacationTransitionForDay_('', 'נוכח'), '');
});

test('לא מגויס is not a חופש and gets no partial window', () => {
  // it stays on the plain unavailable path, which blocks the whole day
  assert.equal(ctx.vacationTransitionForDay_('נוכח', 'לא מגויס'), '');
  assert.equal(ctx.vacationTransitionForDay_('לא מגויס', 'נוכח'), '');
  assert.equal(ctx.isVacationStatusText_('לא מגויס'), false);
  assert.equal(ctx.isVacationStatusText_('חופש'), true);
  assert.equal(ctx.isVacationStatusText_('חופשה'), true);
});

/* ---------------- the engine ---------------- */

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

/** a static slot on the calendar day given by `date`, at `timeValue` */
function slot(timeValue: string, date: Date, rowNumber = 30) {
  return ctx.buildTaskFromFields_({
    rowNumber,
    position: 'עמדות הגנה',
    type: 'מזרחית',
    timeValue,
    assigned: '',
    baseDate: date,
    explicitDate: true,
    config: REC,
  });
}

/** the reason the engine gives, or '' when the soldier is a legal candidate */
function engineReject(s: any, task: any, baseDate: Date, cache: any = {}) {
  const res = ctx.evaluateCandidateForTask_(s, task, {
    config: REC,
    baseDate,
    availabilityCache: cache,
    statsCache: {},
    assignmentsBySoldier: {},
    currentBySoldier: {},
    currentTasks: [task],
    soldiersByName: { [s.nameKey]: s },
    group: { tasks: [task] },
    ignoreSameRow: false,
    excludeAssignedSameOperationalDay: false,
  });
  return res.rejected ? res.rejectReason : '';
}

test('leaving: on the first vacation day a shift ending by 06:00 is recommendable', () => {
  // the slot is on TUESDAY, the first day of the vacation; MONDAY he was here
  const s = soldier('נוכח', 'נוכח', 'חופש');
  assert.equal(engineReject(s, slot('02:00', TUESDAY), MONDAY), '');
});

test('leaving: anything reaching past 06:00 on that day is not', () => {
  const s = soldier('נוכח', 'נוכח', 'חופש');
  assert.match(engineReject(s, slot('06:00', TUESDAY), MONDAY), /יוצא לחופש ב־06:00/);
  // 04:00-08:00 runs two hours into the vacation
  assert.match(engineReject(s, slot('04:00', TUESDAY), MONDAY), /יוצא לחופש/);
});

test('returning: 06:00 is in, 02:00 is out', () => {
  // TUESDAY is the return day: MONDAY was חופש, TUESDAY is not
  const s = soldier('נוכח', 'חופש', 'נוכח');
  assert.equal(engineReject(s, slot('06:00', TUESDAY), MONDAY), '');
  assert.match(engineReject(s, slot('02:00', TUESDAY), MONDAY), /חוזר מחופש ב־06:00/);
});

test('on Sunday the change is at 09:00, so a 06:00 slot is too early', () => {
  // the slot is on SUNDAY, the return day; Saturday was חופש
  const s = soldier('חופש', 'חופש', 'נוכח');
  const saturday = new Date(2026, 7, 8);
  assert.match(engineReject(s, slot('06:00', SUNDAY), saturday), /חוזר מחופש ב־09:00/);
  assert.equal(engineReject(s, slot('10:00', SUNDAY), saturday), '');
});

test('the middle of a vacation stays fully blocked', () => {
  const s = soldier('חופש', 'חופש', 'חופש');
  assert.match(engineReject(s, slot('02:00', TUESDAY), MONDAY), /סטטוס לא זמין/);
});

test('with no previous-day status the day stays fully blocked', () => {
  const s = soldier('', '', 'חופש');
  assert.match(engineReject(s, slot('02:00', TUESDAY), MONDAY), /סטטוס לא זמין/);
});

test('a daily 14:00-14:00 mission cannot start on the day he leaves, but can on the day he returns', () => {
  const daily = (date: Date) => ctx.buildTaskFromFields_({
    rowNumber: 40, position: 'קצין מוצב', type: 'קצין מוצב', timeValue: 'יומי',
    assigned: '', baseDate: date, explicitDate: true, config: REC,
  });

  // leaving on MONDAY: the mission would run 24h from 14:00 the day before
  const leaving = soldier('נוכח', 'חופש', 'חופש');
  assert.match(engineReject(leaving, daily(MONDAY), MONDAY), /יוצא לחופש/);

  // returning on MONDAY: back at 06:00, so a 14:00 start is fine
  const returning = soldier('חופש', 'נוכח', 'נוכח');
  returning.isCommander = true;      // קצין מוצב is a commander slot
  returning.isSeniorCommander = true;
  assert.equal(engineReject(returning, daily(MONDAY), MONDAY), '');
});

test('the per-day availability cache does not leak one slot hour onto another', () => {
  // the real regression risk: availabilityCache is keyed by day, so the
  // time-dependent answer must be computed outside it.
  const s = soldier('נוכח', 'חופש', 'נוכח');
  const shared = {};
  assert.match(engineReject(s, slot('02:00', TUESDAY), MONDAY, shared), /חוזר מחופש/);
  assert.equal(engineReject(s, slot('06:00', TUESDAY, 31), MONDAY, shared), '');
  // and in the other order, on a fresh cache
  const shared2 = {};
  assert.equal(engineReject(s, slot('06:00', TUESDAY, 31), MONDAY, shared2), '');
  assert.match(engineReject(s, slot('02:00', TUESDAY), MONDAY, shared2), /חוזר מחופש/);
});

/* ---------------- the validator ---------------- */

/**
 * One shift on the operational day whose base date is MONDAY, so a pre-14:00
 * time (02:00, 06:00) falls on TUESDAY and is judged against tomorrow's column.
 */
function opsErrors(
  timeText: string,
  statuses: { yesterday?: string; today: string; tomorrow: string },
  targetDate: Date = MONDAY,
) {
  const rows = [{ rowNumber: 2, date: targetDate, position: 'סיור', type: 'סיור', timeText, soldier: 'דני' }];
  const shifts = ctx.buildParsedShifts_(rows, [], [], 'test');
  const isUnavailable = (t: string) => ['חופש', 'לא מגויס'].some((w) => (t || '').indexOf(w) !== -1);
  const roster = {
    targetDate,
    soldiers: new Map([['דני', {
      name: 'דני',
      status: statuses.today,
      statusToday: statuses.today,
      statusTomorrow: statuses.tomorrow,
      statusYesterday: statuses.yesterday || '',
      unavailable: isUnavailable(statuses.today),
      unavailableToday: isUnavailable(statuses.today),
      unavailableTomorrow: isUnavailable(statuses.tomorrow),
      hasTomorrowColumn: true,
      hasYesterdayColumn: !!statuses.yesterday,
      active: !(isUnavailable(statuses.today) && isUnavailable(statuses.tomorrow)),
    }]]),
  };
  const errors: string[] = [], warnings: string[] = [];
  ctx.validateAvailabilityAndMissingAssignments_(shifts, roster, errors, warnings);
  // the "available but unassigned" alert is a different check; ignore it here
  return errors.filter((e) => e.indexOf('בלי משימה') === -1);
}

test('validator: 02:00-06:00 on the first vacation day is no longer an error', () => {
  assert.deepEqual(opsErrors('02:00-06:00', { today: 'נוכח', tomorrow: 'חופש' }), []);
});

test('validator: a shift running past the change time on that day still is', () => {
  const errors = opsErrors('06:00-10:00', { today: 'נוכח', tomorrow: 'חופש' });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /"חופש"/);
});

test('validator: the return day before the change time is a new, explicit error', () => {
  const errors = opsErrors('02:00-06:00', { yesterday: 'נוכח', today: 'חופש', tomorrow: 'נוכח' });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /לפני שעת ההחלפה ביום חזרתו מחופש \(06:00/);
  assert.match(errors[0], /דני/);
});

test('validator: the return day from the change time on is fine', () => {
  assert.deepEqual(
    opsErrors('06:00-10:00', { yesterday: 'נוכח', today: 'חופש', tomorrow: 'נוכח' }),
    [],
  );
});

test('validator: on a Sunday return the 06:00 shift is an error naming 09:00', () => {
  // targetDate SATURDAY -> the pre-14:00 half of the operational day is SUNDAY
  const saturday = new Date(2026, 7, 8);
  const errors = opsErrors('06:00-10:00', { yesterday: 'חופש', today: 'חופש', tomorrow: 'נוכח' }, saturday);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /09:00/);
});

test('validator: the middle of a vacation is still blocked at every hour', () => {
  assert.equal(opsErrors('02:00-06:00', { yesterday: 'חופש', today: 'חופש', tomorrow: 'חופש' }).length, 1);
  assert.equal(opsErrors('14:00-22:00', { yesterday: 'חופש', today: 'חופש', tomorrow: 'חופש' }).length, 1);
});

test('validator: without a yesterday column nothing is softened', () => {
  // today=חופש, no yesterday -> cannot be known to be the first day
  assert.equal(opsErrors('14:00-22:00', { today: 'חופש', tomorrow: 'חופש' }).length, 1);
});

test('validator: the 14:00-24:00 half of the day is unaffected by the change hour', () => {
  // he leaves tomorrow at 06:00, so tonight is entirely his
  assert.deepEqual(opsErrors('14:00-22:00', { yesterday: 'נוכח', today: 'נוכח', tomorrow: 'חופש' }), []);
});
