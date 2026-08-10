import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';

/**
 * v3.9: a daily התקפי occupies 14:00-14:00 but is mostly standby — the
 * validator already counts it as 8 working hours, not 24. So when it ends at
 * 14:00 the soldier is credited rest.attackRestCreditHours (4), which makes him
 * eligible for a 4-hour static position starting that same 14:00 (minimum rest
 * is 4) while an 8-hour סיור still needs the full 8 and stays rejected.
 *
 * These drive evaluateCandidateForTask_ end to end, because the point of the
 * change is the verdict, not the arithmetic.
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

const YESTERDAY = new Date(2026, 7, 10); // 10/08/2026, the התקפי's operational day
const TODAY = new Date(2026, 7, 11);     // 11/08/2026 14:00 — the next slot

function task(position: string, type: string, timeValue: string, baseDate: Date, rowNumber = 40) {
  return ctx.buildTaskFromFields_({
    rowNumber,
    position,
    type,
    timeValue,
    assigned: '',
    baseDate,
    explicitDate: true,
    config: REC,
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

/** history = the given assignments; the slot under test is today's 14:00.
 *  `current` = rows already filled on the sheet being scheduled, which is how
 *  the "what comes after this slot" side of the rest check is fed. */
function evaluate(slot: any, history: any[], group: any[] = [slot], current: any[] = [], config: any = REC) {
  const s = soldier();
  const attach = (source: string) => (t: any) => {
    const a = ctx.taskToAssignment_(t, REC);
    a.source = source;
    a.soldierName = s.name;
    a.soldierKey = s.nameKey;
    return a;
  };

  const assignmentsBySoldier: Record<string, any[]> = {};
  assignmentsBySoldier[s.nameKey] = history.map(attach('history'));

  const currentBySoldier: Record<string, any[]> = {};
  if (current.length) currentBySoldier[s.nameKey] = current.map(attach('current'));

  const soldiersByName: Record<string, any> = {};
  soldiersByName[s.nameKey] = s;

  return ctx.evaluateCandidateForTask_(s, slot, {
    config,
    baseDate: TODAY,
    availabilityCache: {},
    statsCache: {},
    assignmentsBySoldier,
    currentBySoldier,
    currentTasks: [slot].concat(current),
    soldiersByName,
    group: { tasks: group },
    ignoreSameRow: false,
    excludeAssignedSameOperationalDay: false,
  });
}

const dailyAttack = () => task('התקפי', 'התקפי', 'יומי', YESTERDAY);
const staticSlot = () => task('עמדות הגנה', 'מזרחית', '14:00', TODAY);
/** a 14:00 סיור of three seats; seat 1 is the commander's and the last the נהג דוד's,
 *  so an ordinary לוחם is judged on the middle one. */
const tourGroup = () => [40, 41, 42].map((row) => task('סיור', 'סיור', '14:00', TODAY, row));

test('a daily התקפי really does run to the next 14:00', () => {
  const t = dailyAttack();
  assert.equal(t.category, 'attack');
  assert.equal(t.isFullDayByTime, true);
  assert.equal(t.durationHours, 24);
  assert.equal(t.end.getTime(), new Date(2026, 7, 11, 14, 0).getTime());
});

test('the credit applies to a daily התקפי only', () => {
  assert.equal(ctx.restCreditAfter_(dailyAttack(), REC), REC.rest.attackRestCreditHours);
  // an התקפי written with a real time range is an ordinary shift
  assert.equal(ctx.restCreditAfter_(task('התקפי', 'התקפי', '20:00-24:00', YESTERDAY), REC), 0);
  assert.equal(ctx.restCreditAfter_(task('סיור', 'סיור', 'יומי', YESTERDAY), REC), 0);
});

test('off a daily התקפי at 14:00, a static position is allowed', () => {
  const ev = evaluate(staticSlot(), [dailyAttack()]);
  assert.equal(ev.rejected, false);
  assert.equal(ev.fallback, undefined);
  // v3.14: the column shows the real gap (0h — the standby ended at 14:00 and the
  // slot starts at 14:00); the credit is what made the verdict clean, and it is
  // explained in the reasons rather than folded into the number.
  assert.equal(ev.restBeforeHours, 0);
  assert.ok(
    ev.reasons.some((r: string) => r.indexOf('ירד מכוננות התקפית') === 0),
    'the credit must be visible in the reasons: ' + JSON.stringify(ev.reasons),
  );
});

test('off a daily התקפי at 14:00, an 8-hour סיור still fails on rest', () => {
  const group = tourGroup();
  const ev = evaluate(group[1], [dailyAttack()], group);
  assert.equal(ev.fallback, true);
  assert.ok(
    (ev.warnings || []).concat(ev.rejectReason || '').join(' ').indexOf('8 שעות מנוחה') !== -1,
    'expected the 8-hour rest rule to bite: ' + JSON.stringify(ev),
  );
});

/**
 * v3.14: the same credit before the standby. Its first hours are waiting too, so
 * it "really starts" at 18:00 — a soldier who came off a static position at 10:00
 * has rested 8 hours by then, not 4, and is an ordinary candidate rather than a
 * בדוחק one. Both directions matter: without the second, the same pairing would
 * be rejected from the static slot instead.
 */
const staticEndingAt10 = () => task('עמדות הגנה', 'מזרחית', '06:00', TODAY, 30);
/** the standby's first seat is the commander's, so an ordinary לוחם is judged on a later one */
const attackGroup = () => [40, 41, 42].map((row) => task('התקפי', 'התקפי', 'יומי', TODAY, row));
const inAttackGroup = (history: any[]) => {
  const group = attackGroup();
  return evaluate(group[1], history, group);
};

test('the before-credit applies to a daily התקפי only', () => {
  assert.equal(ctx.restCreditBefore_(attackGroup()[1], REC), REC.rest.attackRestCreditBeforeHours);
  assert.equal(ctx.restCreditBefore_(task('התקפי', 'התקפי', '20:00-24:00', TODAY), REC), 0);
  assert.equal(ctx.restCreditBefore_(staticEndingAt10(), REC), 0);
});

test('off a static position at 10:00, the 14:00 daily התקפי counts 8 hours rest', () => {
  const prev = staticEndingAt10();
  assert.equal(prev.end.getTime(), new Date(2026, 7, 11, 10, 0).getTime());

  const ev = inAttackGroup([prev]);
  assert.equal(ev.rejected, false);
  assert.equal(ev.fallback, undefined, 'must be an ordinary candidate: ' + JSON.stringify(ev.warnings));
  // the verdict used 4 real + 4 credited = 8; the column keeps showing the real 4
  assert.equal(ev.restBeforeHours, 4);
  assert.ok(
    ev.reasons.some((r: string) => r.indexOf('נח 4ש׳') !== -1),
    'the "נח" reason must state the real gap: ' + JSON.stringify(ev.reasons),
  );
  assert.ok(
    ev.reasons.some((r: string) => r.indexOf('מתחילה בפועל מאוחר יותר') !== -1),
    'the credit must be visible in the reasons: ' + JSON.stringify(ev.reasons),
  );
});

test('the same pairing was a בדוחק candidate before the credit', () => {
  const noCredit = Object.assign({}, REC, {
    rest: Object.assign({}, REC.rest, { attackRestCreditBeforeHours: 0 }),
  });
  const group = attackGroup();
  const ev = evaluate(group[1], [staticEndingAt10()], group, [], noCredit);
  assert.equal(ev.fallback, true);
  assert.ok(
    (ev.warnings || []).join(' ').indexOf('8 שעות מנוחה') !== -1,
    'expected the 8-hour rule to bite without the credit: ' + JSON.stringify(ev.warnings),
  );
});

test('the credit does not paper over a genuinely short rest', () => {
  // static 08:00-12:00 -> only 2 real hours before the standby; 2+4 < 8
  const ev = inAttackGroup([task('עמדות הגנה', 'מזרחית', '08:00', TODAY, 30)]);
  assert.equal(ev.restBeforeHours, 2);
  assert.equal(ev.fallback, true);
});

test('two adjoining daily התקפי standbys do not stack their credits', () => {
  // 0 real hours + max(4,4) = 4, short of the 8 a 24-hour mission needs.
  // Were the two credits summed it would reach 8 and pass unnoticed.
  const ev = inAttackGroup([dailyAttack()]);
  assert.equal(ev.restBeforeHours, 0);
  assert.equal(ev.fallback, true);
});

/**
 * The "after" side needs no matching credit: a soldier already on the daily
 * standby is rejected outright for anything else, so it never reaches the rest
 * check as the *next* assignment. This pins that reason, which is what the
 * v3.14 comment relies on.
 */
test('a soldier already on the daily התקפי is not recommended elsewhere at all', () => {
  const ev = evaluate(staticEndingAt10(), [], [staticEndingAt10()], attackGroup().slice(0, 1));
  assert.equal(ev.rejected, true);
  assert.ok(
    ev.rejectReason.indexOf('כבר משובץ למשימה יומית') !== -1,
    'unexpected reason: ' + ev.rejectReason,
  );
});

test('without the credit an ordinary 14:00-14:00 mission still blocks a static slot', () => {
  // קצין מוצב is the same 14:00-14:00 window but a real full-day job
  const ev = evaluate(staticSlot(), [task('קצין מוצב', 'קצין מוצב', 'יומי', YESTERDAY)]);
  assert.equal(ev.restBeforeHours, 0);
  assert.equal(ev.fallback, true);
});
