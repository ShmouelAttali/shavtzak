import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';

// Both files share one global scope in Apps Script and are loaded in filename
// order (ShabtzakOps before ShavtzakRecommendation), so parseExitStatus_ is
// visible to the engine and the engine's addDays_ wins the name collision.
// Loading them the same way here keeps the test faithful to production.
const DIR = path.join(process.cwd(), 'apps-script/plugat-gaash');

const ctx: any = {
  console, Date, Math, JSON, String, Number, Array, Object, Map, Set, isNaN, parseInt, parseFloat, RegExp, Error,
  SpreadsheetApp: { getUi: () => ({ createMenu: () => ({ addItem() { return this; }, addSeparator() { return this; }, addToUi() {} }) }) },
  HtmlService: {},
};
vm.createContext(ctx);
for (const f of ['ShabtzakOps.js', 'ShavtzakRecommendation.js']) {
  vm.runInContext(fs.readFileSync(path.join(DIR, f), 'utf8'), ctx);
}
vm.runInContext(';globalThis.CONFIG = CONFIG; globalThis.REC = SHABTZAK_REC_CONFIG;', ctx);

const at = (y: number, m: number, d: number, hh: number, mm = 0) => new Date(y, m - 1, d, hh, mm);

/* ---------------- the shared parser ---------------- */

test('יציאה מHH עד HH — an explicit window', () => {
  // field-by-field: objects built inside the vm carry the vm's Object.prototype,
  // so deepStrictEqual against a host literal fails on the prototype alone
  const exit = ctx.parseExitStatus_('יציאה מ10 עד 22');
  assert.equal(exit.startMin, 10 * 60);
  assert.equal(exit.endMin, 22 * 60);
  assert.equal(exit.text, 'יציאה מ10 עד 22');
});

test('יציאה מHH — out until the end of the calendar day', () => {
  const exit = ctx.parseExitStatus_('יציאה מ20');
  assert.equal(exit.startMin, 20 * 60);
  assert.equal(exit.endMin, 24 * 60);
});

test('יציאה עד HH — away from midnight until that hour', () => {
  const exit = ctx.parseExitStatus_('יציאה עד 10');
  assert.equal(exit.startMin, 0);
  assert.equal(exit.endMin, 10 * 60);
});

test('single-digit hours are accepted', () => {
  assert.equal(ctx.parseExitStatus_('יציאה מ8 עד 9').startMin, 8 * 60);
  assert.equal(ctx.parseExitStatus_('יציאה עד 6').endMin, 6 * 60);
});

test('rejects anything outside the three allowed forms', () => {
  for (const bad of [
    'יציאה מ22 עד 6',    // ends before it starts — same calendar day only
    'יציאה מ10 עד 10',   // zero length
    'יציאה מ24',         // not a valid hour
    'יציאה עד 24',
    'יציאה מ30 עד 22',
    'יציאה עד 0',        // zero length
    'יציאה 12:00-20:00', // the old format is gone
    'יציאה מ10:30 עד 22',// minutes are not allowed
    'יציאה', 'נוכח', 'חופש', '',
  ]) {
    assert.equal(ctx.parseExitStatus_(bad), null, bad);
  }
});

test('legacy dropdown exits keep their old meaning — parsed as nothing, flagged as nothing', () => {
  for (const legacy of ['יציאה בערב', 'יציאה בבוקר', 'יציאה ב14:00']) {
    assert.equal(ctx.parseExitStatus_(legacy), null, legacy);
    assert.equal(ctx.looksLikeTimedExit_(legacy), false, legacy);
  }
});

test('a malformed timed exit is detectable, so it can warn instead of vanishing', () => {
  assert.equal(ctx.looksLikeTimedExit_('יציאה מ10 עד'), true);
  assert.equal(ctx.looksLikeTimedExit_('יציאה מ22 עד 6'), true);
  assert.equal(ctx.looksLikeTimedExit_('נוכח'), false);
});

test('touching intervals do not overlap — out until 22:00, on duty at 22:00', () => {
  assert.equal(ctx.rangesOverlap_(22 * 60, 30 * 60, 12 * 60, 22 * 60), false);
  assert.equal(ctx.rangesOverlap_(21 * 60, 30 * 60, 12 * 60, 22 * 60), true);
});

/* ---------------- Ops: the red flag ---------------- */

function opsCheck(timeText: string, statusToday: string, statusTomorrow = 'נוכח') {
  const rows = [{ rowNumber: 2, date: new Date(2026, 7, 11), position: 'סיור', type: 'סיור', timeText, soldier: 'דני' }];
  const shifts = ctx.buildParsedShifts_(rows, [], [], 'test');
  const roster = {
    soldiers: new Map([['דני', {
      name: 'דני', status: statusToday, statusToday, statusTomorrow,
      unavailable: false, unavailableToday: false, unavailableTomorrow: false,
      hasTomorrowColumn: true, active: true,
    }]]),
  };
  const errors: string[] = [], warnings: string[] = [];
  ctx.validateAvailabilityAndMissingAssignments_(shifts, roster, errors, warnings);
  return { errors, warnings };
}

test('assigning a soldier during his approved exit is an error', () => {
  const { errors } = opsCheck('14:00-22:00', 'יציאה מ12 עד 20');
  assert.equal(errors.length, 1);
  assert.match(errors[0], /יציאה מאושרת/);
  assert.match(errors[0], /דני/);
});

test('a shift that only touches the end of the exit is fine', () => {
  assert.deepEqual(opsCheck('22:00-06:00', 'יציאה מ12 עד 22').errors, []);
});

test('the exit is matched against the right calendar column', () => {
  // 06:00-14:00 runs on the *next* calendar day, so tomorrow's cell applies
  assert.equal(opsCheck('06:00-14:00', 'נוכח', 'יציאה מ5 עד 9').errors.length, 1);
  assert.deepEqual(opsCheck('06:00-14:00', 'יציאה מ5 עד 9', 'נוכח').errors, []);
});

test('a daily mission covers the whole operational day, so any exit collides', () => {
  assert.equal(opsCheck('יומי', 'יציאה מ15 עד 18').errors.length, 1);
});

test('a malformed exit warns rather than silently reading as present', () => {
  const { errors, warnings } = opsCheck('14:00-22:00', 'יציאה מ22 עד 6');
  assert.deepEqual(errors, []);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /פורמט לא תקין/);
});

/* ---------------- Recommendation: hard block ---------------- */

const soldierWith = (statusToday: string, statusTomorrow = 'נוכח', statusYesterday = 'נוכח') =>
  ({ name: 'דני', nameKey: 'דני', statusYesterday, statusToday, statusTomorrow });

test('the engine blocks only the overlapping slot, not the whole day', () => {
  const base = at(2026, 8, 11, 0);
  const soldier = soldierWith('יציאה מ12 עד 20');

  const during = { start: at(2026, 8, 11, 14), end: at(2026, 8, 11, 22), durationHours: 8 };
  const after = { start: at(2026, 8, 11, 22), end: at(2026, 8, 12, 6), durationHours: 8 };

  assert.ok(ctx.findExitConflict_(soldier, during, base), 'overlapping slot must be blocked');
  assert.equal(ctx.findExitConflict_(soldier, after, base), null, 'later slot must stay available');
});

test('an exit crossing 14:00 is seen from both operational days', () => {
  // Exit is on 11/08. For the operational day that began 10/08 14:00, the
  // 12:00-14:00 part of that exit is in range — and 11/08 is that day's
  // "tomorrow" column, so the three-column lookup is what finds it.
  const soldier = soldierWith('נוכח', 'יציאה מ12 עד 20');
  const prevOpDaySlot = { start: at(2026, 8, 11, 12), end: at(2026, 8, 11, 14), durationHours: 2 };
  assert.ok(ctx.findExitConflict_(soldier, prevOpDaySlot, at(2026, 8, 10, 0)));

  // ...and the same exit blocks the 14:00 slot of the *next* operational day
  const nextOpDaySlot = { start: at(2026, 8, 11, 14), end: at(2026, 8, 11, 22), durationHours: 8 };
  assert.ok(ctx.findExitConflict_(soldierWith('יציאה מ12 עד 20'), nextOpDaySlot, at(2026, 8, 11, 0)));
});

/* ---------------- Recommendation: the soft penalty ---------------- */

function misfitScore(statusToday: string, task: any, sameDayHours = 0, statusTomorrow = 'נוכח') {
  const result = { score: 0, warnings: [] as string[] };
  ctx.applyExitPackageScoring_(result, soldierWith(statusToday, statusTomorrow), task,
    sameDayHours, { baseDate: at(2026, 8, 11, 0) }, ctx.REC);
  return result;
}

const tour = { start: at(2026, 8, 11, 22), end: at(2026, 8, 12, 6), durationHours: 8 };
const staticShift = { start: at(2026, 8, 11, 17), end: at(2026, 8, 11, 21), durationHours: 4 };

test('a soldier with no exit is never touched by the penalty', () => {
  assert.equal(misfitScore('נוכח', staticShift).score, 0);
});

test('a full-day-closing mission is never penalised — nothing left to place', () => {
  assert.equal(misfitScore('יציאה מ6 עד 13', tour).score, 0);
});

test('when the exit fits around both options, neither is penalised', () => {
  // short exit: the 4h complement still has room, so ranking is left to the
  // ordinary factors (rotation, same task yesterday, load)
  assert.equal(misfitScore('יציאה מ15 עד 18', tour).score, 0);
  assert.equal(misfitScore('יציאה מ6 עד 9', staticShift).score, 0);
});

test('a partial mission is penalised when the exit leaves no room for the complement', () => {
  // exit until 13:00 tomorrow + a 4h slot placed mid-evening leaves only 3h gaps
  const r = misfitScore('נוכח', staticShift, 0, 'יציאה עד 13');
  assert.equal(r.score, ctx.REC.scoring.exitPackageMisfitPenalty);
  assert.match(r.warnings[0], /משמרת המשלימה/);
});
