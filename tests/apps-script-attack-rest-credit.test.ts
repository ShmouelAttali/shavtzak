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

/** history = the given assignments; the slot under test is today's 14:00 */
function evaluate(slot: any, history: any[], group: any[] = [slot]) {
  const s = soldier();
  const assignmentsBySoldier: Record<string, any[]> = {};
  assignmentsBySoldier[s.nameKey] = history.map((t) => {
    const a = ctx.taskToAssignment_(t, REC);
    a.source = 'history';
    a.soldierName = s.name;
    a.soldierKey = s.nameKey;
    return a;
  });

  const soldiersByName: Record<string, any> = {};
  soldiersByName[s.nameKey] = s;

  return ctx.evaluateCandidateForTask_(s, slot, {
    config: REC,
    baseDate: TODAY,
    availabilityCache: {},
    statsCache: {},
    assignmentsBySoldier,
    currentBySoldier: {},
    currentTasks: [slot],
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
  assert.equal(ev.restBeforeHours, REC.rest.attackRestCreditHours);
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

test('without the credit an ordinary 14:00-14:00 mission still blocks a static slot', () => {
  // קצין מוצב is the same 14:00-14:00 window but a real full-day job
  const ev = evaluate(staticSlot(), [task('קצין מוצב', 'קצין מוצב', 'יומי', YESTERDAY)]);
  assert.equal(ev.restBeforeHours, 0);
  assert.equal(ev.fallback, true);
});
