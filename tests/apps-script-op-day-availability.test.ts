import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';

/**
 * Ops v3.16: "available" is measured over the operational day (14:00 → 14:00),
 * not over a calendar column.
 *
 * The alert this fixes fired on soldiers who were not in the day at all. The
 * example that surfaced it: `יציאה מ14` today plus `חופש` tomorrow — out from
 * the very minute the day starts, and every day the officer was told he was
 * "marked available with no mission", with a note claiming he was free in
 * exactly the half he was gone for.
 *
 * ⚠ availableMinutesInOpDay_ deliberately does NOT use formatHours_: that name
 * is defined in both script files and the engine's definition wins live, so a
 * message built with it would read differently in production than here.
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
vm.runInContext(';globalThis.CONFIG = CONFIG;', ctx);

const TUESDAY = new Date(2026, 7, 11); // 11/08/2026 — the op day under test
const DAY = 24 * 60;

function soldier(statusYesterday: string, statusToday: string, statusTomorrow: string, hasTomorrowColumn = true) {
  const unavailable = (s: string) =>
    ctx.CONFIG.UNAVAILABLE_STATUS_WORDS.some((w: string) => String(s).indexOf(w) !== -1);
  return {
    name: 'אמיתי שמעון',
    platoon: '3',
    role: 'לוחם',
    statusYesterday,
    statusToday,
    statusTomorrow,
    unavailableToday: unavailable(statusToday),
    unavailableTomorrow: unavailable(statusTomorrow),
    hasTomorrowColumn,
    active: !(unavailable(statusToday) && unavailable(statusTomorrow)),
  };
}

const minutes = (s: any) => ctx.availableMinutesInOpDay_(s, { targetDate: TUESDAY });

/* ---------------- the ordinary cases ---------------- */

test('a present soldier has the whole operational day', () => {
  assert.equal(minutes(soldier('נוכח', 'נוכח', 'נוכח')), DAY);
});

test('a full vacation on both sides is zero', () => {
  assert.equal(minutes(soldier('חופש', 'חופש', 'חופש')), 0);
});

/* ---------------- the case that started this ---------------- */

test('יציאה מ14 today plus חופש tomorrow leaves only the pre-06:00 window', () => {
  // out 14:00→24:00 by the exit; tomorrow is his FIRST vacation day, so by
  // v3.15 he is still here until the 06:00 changeover — six real hours.
  assert.equal(minutes(soldier('נוכח', 'יציאה מ14', 'חופש')), 6 * 60);
});

test('יציאה מ14 today plus לא מגויס tomorrow is zero — no changeover window there', () => {
  // לא מגויס is not a חופש, so it gets no partial window and takes the whole
  // second half. (A מחר that is mid-vacation cannot be reached from an exit
  // today: the transition is judged against *today's* column, and an exit is
  // not a vacation, so tomorrow always reads as a first vacation day.)
  assert.equal(minutes(soldier('נוכח', 'יציאה מ14', 'לא מגויס')), 0);
});

test('יציאה מ14 today plus יציאה עד 14 tomorrow is zero — both halves gone', () => {
  assert.equal(minutes(soldier('נוכח', 'יציאה מ14', 'יציאה עד 14')), 0);
});

test('חופש today plus יציאה עד 14 tomorrow is zero', () => {
  assert.equal(minutes(soldier('חופש', 'חופש', 'יציאה עד 14')), 0);
});

/* ---------------- the partial ones stay partial ---------------- */

test('a short exit inside the day only costs its own window', () => {
  assert.equal(minutes(soldier('נוכח', 'יציאה מ16 עד 20', 'נוכח')), DAY - 4 * 60);
});

test('an exit wholly before the day starts costs nothing', () => {
  // 08:00-12:00 on the day the op day *starts* is before 14:00 — outside it
  assert.equal(minutes(soldier('נוכח', 'יציאה מ8 עד 12', 'נוכח')), DAY);
});

test('the first vacation day leaves the pre-changeover window on the tomorrow half', () => {
  assert.equal(minutes(soldier('נוכח', 'נוכח', 'חופש')), 10 * 60 + 6 * 60);
});

test('the return day gives back everything from the changeover on', () => {
  // today חופש (mid-vacation, whole half gone), tomorrow he returns at 06:00
  assert.equal(minutes(soldier('חופש', 'חופש', 'נוכח')), 8 * 60);
});

test('on a Sunday return the changeover is 09:00, not 06:00', () => {
  // 15/08/2026 is a Saturday, so the "tomorrow" half is Sunday 16/08
  const saturday = new Date(2026, 7, 15);
  assert.equal(saturday.getDay(), 6);
  const s = soldier('חופש', 'חופש', 'נוכח');
  assert.equal(ctx.availableMinutesInOpDay_(s, { targetDate: saturday }), 5 * 60);
});

/* ---------------- the safety net ---------------- */

test('without a tomorrow column the second half counts as present', () => {
  // better a redundant alert than a real one swallowed by a missing column
  // only the 14:00-24:00 half is charged; the 00:00-14:00 half is unknowable
  const s = soldier('נוכח', 'יציאה מ14', 'יציאה מ14', false);
  assert.equal(minutes(s), 14 * 60);
});

test('לא מגויס blocks its whole half — it is not a חופש and gets no window', () => {
  assert.equal(minutes(soldier('נוכח', 'נוכח', 'לא מגויס')), 10 * 60);
  assert.equal(minutes(soldier('נוכח', 'לא מגויס', 'נוכח')), 14 * 60);
});

/* ---------------- the alert itself ---------------- */

function unassignedAlerts(s: any) {
  const roster = { soldiers: new Map([[s.name, s]]), targetDate: TUESDAY };
  const errors: string[] = [];
  ctx.validateAvailabilityAndMissingAssignments_([], roster, errors, []);
  return errors.filter((e) => e.indexOf('בלי משימה') !== -1);
}

test('a soldier with no minute in the day raises no unassigned alert', () => {
  assert.equal(unassignedAlerts(soldier('נוכח', 'יציאה מ14', 'יציאה עד 14')).length, 0);
});

test('a soldier who is genuinely free still does', () => {
  const alerts = unassignedAlerts(soldier('נוכח', 'נוכח', 'נוכח'));
  assert.equal(alerts.length, 1);
  assert.match(alerts[0], /סטטוס: "נוכח"/);
});

test('a partially available soldier is alerted, and the note states the real window', () => {
  // the old note said 'זמין בחלק "היום"' here — the exact half he is gone for
  const alerts = unassignedAlerts(soldier('נוכח', 'יציאה מ14', 'חופש'));
  assert.equal(alerts.length, 1);
  assert.match(alerts[0], /זמין 6 שעות ביממה/);
  assert.doesNotMatch(alerts[0], /זמין בחלק/);
});

test('a one-hour sliver is still reported, and named honestly', () => {
  const s = soldier('נוכח', 'יציאה מ14', 'נוכח');
  s.statusTomorrow = 'יציאה עד 13';
  s.unavailableTomorrow = false;
  const alerts = unassignedAlerts(s);
  assert.match(alerts[0], /זמין 1 שעות ביממה/);
});
