import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';

/**
 * v3.11: קצין מוצב used to demand isSeniorCommander (סמל / מ״מ), which rejected
 * מ״כ and מ״ח even though they command סיור and התקפי. The bar is now the same
 * one for every commanding task — soldierCanCommandTask_ → isCommander.
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
const TODAY = new Date(2026, 7, 11);

function task(position: string, type: string, timeValue: string) {
  return ctx.buildTaskFromFields_({
    rowNumber: 40,
    position,
    type,
    timeValue,
    assigned: '',
    baseDate: TODAY,
    explicitDate: true,
    config: REC,
  });
}

function soldier(name: string, role: string) {
  return {
    name,
    nameKey: ctx.normalizeNameKey_(name),
    role,
    platoon: '2',
    statusYesterday: 'נוכח',
    statusToday: 'נוכח',
    statusTomorrow: 'נוכח',
    isCommander: ctx.containsAny_(role, REC.roles.commanderKeywords),
    isSeniorCommander: ctx.containsAny_(role, REC.roles.seniorCommanderKeywords),
    isStaticCommander: ctx.containsAny_(role, REC.roles.staticCommanderKeywords),
    isDudDriver: false,
    isTigerDriver: false,
  };
}

function evaluate(s: any, slot: any) {
  const soldiersByName: Record<string, any> = {};
  soldiersByName[s.nameKey] = s;
  return ctx.evaluateCandidateForTask_(s, slot, {
    config: REC,
    baseDate: TODAY,
    availabilityCache: {},
    statsCache: {},
    assignmentsBySoldier: {},
    currentBySoldier: {},
    currentTasks: [slot],
    soldiersByName,
    group: { tasks: [slot] },
    ignoreSameRow: false,
    excludeAssignedSameOperationalDay: false,
  });
}

const postOfficer = () => task('קצין מוצב', 'קצין מוצב', 'יומי');
const tour = () => task('סיור', 'סיור', '14:00');

const RANKS = [
  { role: 'מ"מ', canCommand: true },
  { role: 'סמל', canCommand: true },
  { role: 'מ"כ', canCommand: true },
  { role: 'מ"ח', canCommand: true },
  { role: 'לוחם', canCommand: false },
  { role: 'חובש', canCommand: false },
  { role: 'נהג דוד', canCommand: false },
];

test('קצין מוצב is open to exactly the ranks that can command a סיור', () => {
  for (const { role, canCommand } of RANKS) {
    const s = soldier('חייל ' + role, role);
    assert.equal(
      ctx.soldierCanCommandTask_(s, postOfficer()),
      canCommand,
      role + ' — קצין מוצב',
    );
    assert.equal(
      ctx.soldierCanCommandTask_(s, tour()),
      ctx.soldierCanCommandTask_(s, postOfficer()),
      role + ' — the two bars must be identical',
    );
  }
});

test('a מ״כ is no longer rejected from קצין מוצב', () => {
  const ev = evaluate(soldier('עדו פרץ', 'מ"כ'), postOfficer());
  assert.equal(ev.rejected, false, ev.rejectReason);
});

test('a מ״מ still qualifies', () => {
  const ev = evaluate(soldier('אסף פרץ', 'מ"מ'), postOfficer());
  assert.equal(ev.rejected, false, ev.rejectReason);
});

test('a לוחם is still rejected from קצין מוצב', () => {
  const ev = evaluate(soldier('אילן הרמן', 'לוחם'), postOfficer());
  assert.equal(ev.rejected, true);
  assert.equal(ev.rejectReason, 'קצין מוצב יכול להיות רק מפקד');
});

test('the group warning follows the same bar', () => {
  const mak = soldier('עדו פרץ', 'מ"כ');
  const slot = postOfficer();
  slot.assigned = mak.name;
  const soldiersByName: Record<string, any> = {};
  soldiersByName[mak.nameKey] = mak;

  const warnings = ctx.formatTaskSoftWarnings_(slot, { tasks: [slot] }, soldiersByName, REC);
  assert.equal(warnings.indexOf('צריך מפקד'), -1, 'a מ״כ must satisfy the קצין מוצב warning: ' + warnings);
});
