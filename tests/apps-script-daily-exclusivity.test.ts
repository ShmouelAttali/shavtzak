import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';

/**
 * Engine v3.23 / Ops v3.17 — a daily mission is exclusive by default.
 *
 * The sheet renamed the daily התקפי standby on 09/08: `כוננות | התקפי` became
 * `התקפי | התקפי`, which moved it from engine category 'carmel' to 'attack' and
 * silently switched off every rule keyed on the word כוננות. So the rule is now
 * keyed on the TIME SHAPE ('יומי' / a 24-hour range), never on Hebrew keywords,
 * and the exemptions are an explicit list, pinned here:
 *
 *   - כונן גשש written 'יומי' blocks only its own shift
 *   - כרמל / כוננות is held on top of a real mission
 *   - the daily התקפי standby and an התקפי ACTIVITY (תגבצ / פטרול / צ'קפוסט)
 *     may be held together — the standby team is who executes them
 *
 * The matrix below is the regression net: for every flavour of daily mission,
 * including a position text nobody has ever written, a parallel shift in the
 * same operational day must be rejected by the engine AND error in validation.
 * A future rename lands in the default-exclusive path instead of in silence.
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
/** 11/08/2026, a Tuesday — the operational day 11/08 14:00 → 12/08 14:00 */
const BASE = new Date(2026, 7, 11);

/* ============================================================
 * the light engine harness (from apps-script-attack-rest-credit.test.ts)
 * ============================================================ */

function task(position: string, type: string, timeValue: string, baseDate = BASE, rowNumber = 40) {
  return ctx.buildTaskFromFields_({
    rowNumber, position, type, timeValue, assigned: '',
    baseDate, explicitDate: true, config: REC,
  });
}

/** a group of three seats: the first is the commander's and (for attack/tour)
 *  the last the driver's, so an ordinary לוחם is always judged on the middle one */
const group = (position: string, type: string, timeValue: string, baseDate = BASE) =>
  [40, 41, 42].map((row) => task(position, type, timeValue, baseDate, row));
const seat = (g: any[]) => g[1];

function soldier(statusYesterday = 'נוכח', statusToday = 'נוכח', statusTomorrow = 'נוכח') {
  return {
    name: 'אמיתי שמעון',
    nameKey: ctx.normalizeNameKey_('אמיתי שמעון'),
    role: 'לוחם',
    platoon: '2',
    statusYesterday, statusToday, statusTomorrow,
    isCommander: false, isSeniorCommander: false, isStaticCommander: false,
    isDudDriver: false, isTigerDriver: false,
  };
}

/** `current` = rows already filled on the sheet for this soldier, i.e. what he
 *  already holds in this operational day. excludeAssignedSameOperationalDay is
 *  on, as it is for every real recommendation pass (rankCandidatesForTask_). */
function evaluate(slot: any, groupTasks: any[], current: any[] = [], s: any = soldier()) {
  const attach = (t: any) => {
    const a = ctx.taskToAssignment_(t, REC);
    a.source = 'current';
    a.soldierName = s.name;
    a.soldierKey = s.nameKey;
    return a;
  };
  const currentBySoldier: Record<string, any[]> = {};
  if (current.length) currentBySoldier[s.nameKey] = current.map(attach);

  return ctx.evaluateCandidateForTask_(s, slot, {
    config: REC,
    baseDate: BASE,
    availabilityCache: {},
    statsCache: {},
    assignmentsBySoldier: {},
    currentBySoldier,
    currentTasks: [slot].concat(current),
    soldiersByName: { [s.nameKey]: s },
    group: { tasks: groupTasks },
    ignoreSameRow: false,
    excludeAssignedSameOperationalDay: true,
  });
}

/** '' when the candidate is legal, otherwise the engine's reason */
const reject = (slot: any, groupTasks: any[], current: any[] = [], s: any = soldier()) => {
  const ev = evaluate(slot, groupTasks, current, s);
  return ev.rejected ? ev.rejectReason : '';
};

/* ============================================================
 * the Ops harness (from apps-script-daily-mission.test.ts / vacation-change)
 * ============================================================ */

type Row = [string, string, string]; // position, type, timeText

const PRESENT = { yesterday: 'נוכח', today: 'נוכח', tomorrow: 'נוכח' };

function opsErrors(
  rows: Row[],
  statuses: { yesterday?: string; today: string; tomorrow: string } = PRESENT,
  opts: { hasTomorrowColumn?: boolean } = {},
) {
  const name = 'דני';
  const parsed = rows.map(([position, type, timeText], i) => ({
    rowNumber: i + 2, date: BASE, position, type, timeText, soldier: name,
  }));
  const errors: string[] = [];
  const warnings: string[] = [];
  const shifts = ctx.buildParsedShifts_(parsed, errors, warnings, 'test');

  const unavailable = (t: string) =>
    ctx.CONFIG.UNAVAILABLE_STATUS_WORDS.some((w: string) => String(t || '').indexOf(w) !== -1);
  const hasTomorrowColumn = opts.hasTomorrowColumn !== false;
  const tomorrow = hasTomorrowColumn ? statuses.tomorrow : statuses.today;
  const roster = {
    targetDate: BASE,
    soldiers: new Map([[name, {
      name, platoon: '2', role: 'לוחם',
      status: statuses.today,
      statusToday: statuses.today,
      statusTomorrow: tomorrow,
      statusYesterday: statuses.yesterday || '',
      unavailable: unavailable(statuses.today),
      unavailableToday: unavailable(statuses.today),
      unavailableTomorrow: unavailable(tomorrow),
      hasTomorrowColumn,
      hasYesterdayColumn: !!statuses.yesterday,
      active: true,
    }]]),
  };

  ctx.validateDailyMissionExclusivity_(shifts, errors);
  ctx.validateOverlaps_(shifts, errors);
  ctx.validateDailyHours_(shifts, roster, errors, warnings);
  ctx.validateAvailabilityAndMissingAssignments_(shifts, roster, errors, warnings);
  // "available but unassigned" is a different check entirely
  return errors.filter((e) => e.indexOf('בלי משימה') === -1);
}

const EXCLUSIVITY = 'משימה יומית במקביל למשימה נוספת';
const hasExclusivityError = (errors: string[]) => errors.some((e) => e.indexOf(EXCLUSIVITY) !== -1);

/* ============================================================
 * the rows the sheet actually holds
 * ============================================================ */

const STANDBY: Row = ['התקפי', 'התקפי', 'יומי'];              // the live spelling since 09/08
const STANDBY_RANGE: Row = ['התקפי', 'התקפי', '14:00-14:00']; // the same block, older spelling
const OLD_STANDBY: Row = ['כוננות', 'התקפי', 'יומי'];          // the original spelling
const ACTIVITY: Row = ['תגבצ ערב', 'התקפי', '17:00-22:00'];    // an התקפי activity
const STATIC: Row = ['שג', 'עמדות הגנה', '18:00-22:00'];
const TRACKER: Row = ['כונן גשש', 'גשש', 'יומי'];

const asTasks = ([position, type, timeText]: Row) => group(position, type, timeText);
const asTask = (row: Row) => seat(asTasks(row));

/* ============================================================
 * 1. the invariant, as a matrix over every flavour of daily mission
 * ============================================================ */

const DAILY_FLAVOURS: Array<{ label: string; row: Row }> = [
  { label: 'התקפי', row: STANDBY },
  { label: 'התקפי 14:00-14:00', row: STANDBY_RANGE },
  { label: 'כוננות התקפית (הכתיב הישן)', row: OLD_STANDBY },
  { label: 'תורן מטבח', row: ['תורן מטבח', 'תורנים', 'יומי'] },
  { label: 'קצין מוצב', row: ['קצין מוצב', 'קצין מוצב', 'יומי'] },
  { label: 'מגן + תגבצ', row: ['מגן + תגבצ', 'מגן השומרון', 'יומי'] },
  // a position nobody has written yet: the whole point of keying on time shape
  { label: 'עמדה שלא נראתה מעולם', row: ['עמדת בלבול', 'משהו חדש', 'יומי'] },
];

for (const flavour of DAILY_FLAVOURS) {
  test(`engine: holding a daily ${flavour.label} blocks a parallel shift the same op day`, () => {
    const staticGroup = group('שג', 'עמדות הגנה', '18:00-22:00');
    const reason = reject(seat(staticGroup), staticGroup, [asTask(flavour.row)]);
    assert.notEqual(reason, '', 'must be rejected: ' + flavour.label);
    // the three wordings the exclusivity gates produce: the same-op-day gate,
    // the day-block gate, and — for the old כוננות spelling, which is engine
    // category 'carmel' — the v2.8 daily-konenut gate.
    assert.ok(
      ['כבר משובץ היום', 'כבר משובץ למשימה יומית', 'בכוננות התקפית היום']
        .some((wording) => reason.indexOf(wording) !== -1),
      'expected an exclusivity rejection, got: ' + reason,
    );
  });

  test(`validation: a daily ${flavour.label} plus a parallel shift is an explicit error`, () => {
    const errors = opsErrors([flavour.row, STATIC]);
    assert.ok(hasExclusivityError(errors), 'expected the exclusivity error, got: ' + JSON.stringify(errors));
  });
}

test('validation: two ordinary shifts are not an exclusivity error', () => {
  assert.equal(hasExclusivityError(opsErrors([STATIC, ['בונקר', 'עמדות הגנה', '02:00-06:00']])), false);
});

/* ============================================================
 * 2. the standby ↔ activity pair — the one approved exception
 * ============================================================ */

test('the standby is recognised by its time shape, in both live spellings', () => {
  assert.equal(ctx.isDailyAttackAssignment_(asTask(STANDBY)), true);
  assert.equal(ctx.isDailyAttackAssignment_(asTask(STANDBY_RANGE)), true);
  // an activity with real hours is not the standby
  assert.equal(ctx.isDailyAttackAssignment_(asTask(ACTIVITY)), false);
  // and neither is a daily mission of another kind
  assert.equal(ctx.isDailyAttackAssignment_(asTask(['קצין מוצב', 'קצין מוצב', 'יומי'])), false);
});

test('the original כוננות spelling keeps its own, older route to the same behaviour', () => {
  // 'כוננות' is matched before 'התקפי' in getTaskCategory_, so that row is
  // category 'carmel' and travels the v2.8 konenut rules — which is why the
  // rename to 'התקפי | התקפי' switched everything off in the first place.
  const old = asTask(OLD_STANDBY);
  assert.equal(old.category, 'carmel');
  assert.equal(old.isDailyKonenut, true);
  assert.equal(ctx.isDailyAttackAssignment_(old), false);
});

test('engine: the standby team may take an התקפי activity — both directions, both spellings', () => {
  for (const standbyRow of [STANDBY, STANDBY_RANGE]) {
    const activityGroup = asTasks(ACTIVITY);
    assert.equal(
      reject(seat(activityGroup), activityGroup, [asTask(standbyRow)]), '',
      'holding the standby must not block the activity (' + standbyRow[2] + ')',
    );

    const standbyGroup = asTasks(standbyRow);
    assert.equal(
      reject(seat(standbyGroup), standbyGroup, [asTask(ACTIVITY)]), '',
      'holding the activity must not block the standby (' + standbyRow[2] + ')',
    );
  }
});

test('engine: the standby still blocks ordinary positions, both directions', () => {
  for (const other of [group('שג', 'עמדות הגנה', '18:00-22:00'), group('סיור', 'סיור', '22:00')]) {
    assert.notEqual(
      reject(seat(other), other, [asTask(STANDBY)]), '',
      'holding the standby must block ' + other[0].position,
    );
    const standbyGroup = asTasks(STANDBY);
    assert.notEqual(
      reject(seat(standbyGroup), standbyGroup, [seat(other)]), '',
      'holding ' + other[0].position + ' must block the standby',
    );
  }
});

test('engine: two התקפי activities that overlap in time still collide', () => {
  // the exemption is standby ↔ activity, never activity ↔ activity
  const later = group('פטרול', 'התקפי', '18:00-20:00');
  assert.match(reject(seat(later), later, [asTask(ACTIVITY)]), /חפיפה/);
});

test('validation: the standby plus an התקפי activity is clean — no exclusivity, no hours error', () => {
  for (const standbyRow of [STANDBY, STANDBY_RANGE, OLD_STANDBY]) {
    const errors = opsErrors([standbyRow, ACTIVITY]);
    assert.deepEqual(errors, [], 'unexpected errors for ' + standbyRow[2] + ': ' + JSON.stringify(errors));
  }
});

test('validation: the standby is worth 0 working hours in the modern spelling too', () => {
  // this is what used to produce "יותר מ־8 שעות ביום: … 13 שעות" on standby+activity
  const rows = [STANDBY, ACTIVITY].map(([position, type, timeText], i) => ({
    rowNumber: i + 2, date: BASE, position, type, timeText, soldier: 'דני',
  }));
  const shifts = ctx.buildParsedShifts_(rows, [], [], 'test');
  assert.equal(shifts[0].hoursForDailyTotal, 0);
  assert.equal(shifts[1].hoursForDailyTotal, 5);
});

test('validation: the exemption list is exactly these three, and the attack pair is asymmetric', () => {
  const shift = (over: Record<string, unknown>) => Object.assign(
    { isDaily: true, isTracker: false, isCarmel: false, isAttackGroup: false }, over);

  // the standby + an attack activity
  assert.equal(ctx.isExemptFromDailyExclusivity_(
    shift({ isAttackGroup: true }), shift({ isDaily: false, isAttackGroup: true })), true);
  // a daily mission that is NOT attack-group gets no pass from an attack activity
  assert.equal(ctx.isExemptFromDailyExclusivity_(
    shift({}), shift({ isDaily: false, isAttackGroup: true })), false);
  // the tracker and כרמל, from either side
  assert.equal(ctx.isExemptFromDailyExclusivity_(shift({}), shift({ isDaily: false, isTracker: true })), true);
  assert.equal(ctx.isExemptFromDailyExclusivity_(shift({ isTracker: true }), shift({ isDaily: false })), true);
  assert.equal(ctx.isExemptFromDailyExclusivity_(shift({}), shift({ isDaily: false, isCarmel: true })), true);
  // and nothing else
  assert.equal(ctx.isExemptFromDailyExclusivity_(shift({}), shift({ isDaily: false })), false);
});

test('validation: a כונן גשש written יומי blocks only its own shift', () => {
  assert.equal(hasExclusivityError(opsErrors([TRACKER, STATIC])), false);
});

/* ============================================================
 * 3. absence on the OTHER half of the operational day
 * ============================================================ */

test('engine: tomorrow-חופש blocks a daily mission — he leaves at the 06:00 changeover', () => {
  for (const row of [STANDBY, STANDBY_RANGE, ['קצין מוצב', 'קצין מוצב', 'יומי'] as Row]) {
    const g = asTasks(row);
    // קצין מוצב is a commander seat; give him the rank so the reason under test
    // is the absence and not the seat rule
    const s = Object.assign(soldier('נוכח', 'נוכח', 'חופש'), { isCommander: true, isSeniorCommander: true });
    assert.match(reject(seat(g), g, [], s), /יוצא לחופש ב־06:00/, 'flavour: ' + row[0] + ' ' + row[2]);
  }
});

test('engine: tomorrow-לא מגויס blocks it too — no changeover window, he is simply gone', () => {
  const g = asTasks(STANDBY);
  assert.match(reject(seat(g), g, [], soldier('נוכח', 'נוכח', 'לא מגויס')), /לא מגויס/);
});

test('engine: a shift that ends before the changeover is still recommendable', () => {
  // the whole reason this is an interval intersection and not a day flag
  const g = group('סיור', 'סיור', '14:00-22:00');
  assert.equal(reject(seat(g), g, [], soldier('נוכח', 'נוכח', 'חופש')), '');
});

test('engine: a soldier returning from חופש today may take the 14:00 standby', () => {
  const g = asTasks(STANDBY);
  assert.equal(reject(seat(g), g, [], soldier('חופש', 'נוכח', 'נוכח')), '');
});

test('engine: mid-vacation and approved exits are unchanged by all this', () => {
  const g = asTasks(STANDBY);
  assert.match(reject(seat(g), g, [], soldier('חופש', 'חופש', 'חופש')), /סטטוס לא זמין/);
  assert.match(reject(seat(g), g, [], soldier('נוכח', 'יציאה מ18', 'נוכח')), /ביציאה מאושרת/);
  assert.match(reject(seat(g), g, [], soldier('נוכח', 'נוכח', 'יציאה עד 10')), /ביציאה מאושרת/);
});

test('validation: a daily row is checked against the tomorrow column as well', () => {
  const errors = opsErrors([STANDBY], { yesterday: 'נוכח', today: 'נוכח', tomorrow: 'חופש' });
  assert.equal(errors.length, 1, JSON.stringify(errors));
  assert.match(errors[0], /"חופש" \(מחר\)/);

  const notMobilised = opsErrors([STANDBY], { yesterday: 'נוכח', today: 'נוכח', tomorrow: 'לא מגויס' });
  assert.equal(notMobilised.length, 1, JSON.stringify(notMobilised));
  assert.match(notMobilised[0], /"לא מגויס" \(מחר\)/);
});

test('validation: חופש today under a daily row is reported once, not twice', () => {
  const errors = opsErrors([STANDBY], { yesterday: 'חופש', today: 'חופש', tomorrow: 'חופש' });
  assert.equal(errors.length, 1, JSON.stringify(errors));
  assert.match(errors[0], /\(היום\)/);
});

test('validation: without a tomorrow column the two halves are one, and nothing is doubled', () => {
  const errors = opsErrors(
    [STANDBY], { yesterday: 'נוכח', today: 'חופש', tomorrow: 'חופש' }, { hasTomorrowColumn: false });
  assert.equal(errors.length, 1, JSON.stringify(errors));
});

test('validation: an approved exit still collides with a daily row', () => {
  const errors = opsErrors([STANDBY], { yesterday: 'נוכח', today: 'יציאה מ10 עד 22', tomorrow: 'נוכח' });
  assert.equal(errors.length, 1, JSON.stringify(errors));
  assert.match(errors[0], /יציאה מאושרת/);
});

test('validation: a fully present soldier on the standby raises nothing', () => {
  assert.deepEqual(opsErrors([STANDBY]), []);
});
