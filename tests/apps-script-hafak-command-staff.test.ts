import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';

/**
 * v3.20: the first חפק seat belongs to the מפל"ג, and to nobody else.
 *
 * The bug this fixes was silent in the worst way: the סמ"פ sits in that seat
 * every single day, and because מפל"ג was filtered out of the candidate pool at
 * read time the engine could not find him in its roster at all — so a perfectly
 * correct assignment was reported as ⚠ "החייל לא נמצא במצבת החיילים".
 *
 * The rule runs in both directions, and the checks that follow pin both: מפל"ג
 * only there, and only מפל"ג there.
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

function task(position: string, type: string, timeValue: string, rowNumber: number) {
  return ctx.buildTaskFromFields_({
    rowNumber, position, type, timeValue, assigned: '',
    baseDate: TODAY, explicitDate: true, config: REC,
  });
}

function soldier(name: string, platoon: string, role = 'לוחם') {
  return {
    name,
    nameKey: ctx.normalizeNameKey_(name),
    role,
    platoon,
    statusYesterday: 'נוכח',
    statusToday: 'נוכח',
    statusTomorrow: 'נוכח',
    isCommandStaff: ctx.containsAny_(platoon, REC.commandStaffPlatoonKeywords),
    isCommander: false,
    isSeniorCommander: false,
    isStaticCommander: false,
    isDudDriver: false,
    isTigerDriver: false,
  };
}

/** the four daily חפק seats as they sit in the sheet */
const hafakSeats = () => [63, 64, 65, 66].map((row) => task('חפק', 'חפק', 'יומי', row));

function rejectReason(s: any, slot: any, group: any[]) {
  const res = ctx.evaluateCandidateForTask_(s, slot, {
    config: REC,
    baseDate: TODAY,
    availabilityCache: {},
    statsCache: {},
    assignmentsBySoldier: {},
    currentBySoldier: {},
    currentTasks: group,
    soldiersByName: { [s.nameKey]: s },
    group: { tasks: group },
    ignoreSameRow: false,
    excludeAssignedSameOperationalDay: false,
  });
  return res.rejected ? res.rejectReason : '';
}

const samap = () => soldier('שמואלי גרינברג', 'מפל"ג', 'סמ"פ');
const fighter = () => soldier('אמיתי שמעון', '3');

/* ---------------- the spelling trap ---------------- */

test('the sheet spelling מפל"ג matches the keyword, in both quote forms', () => {
  // the keyword is written 'מפלג'; normalizeForSearch_ strips " and ״, which is
  // the only reason it matches. A keyword with the quotes baked in would not.
  assert.equal(ctx.isCommandStaffSoldier_({ platoon: 'מפל"ג' }, REC), true);
  assert.equal(ctx.isCommandStaffSoldier_({ platoon: 'מפל״ג' }, REC), true);
  assert.equal(ctx.isCommandStaffSoldier_({ platoon: 'מפלג' }, REC), true);
  assert.equal(ctx.isCommandStaffSoldier_({ platoon: '3' }, REC), false);
});

test('a חפק row is recognised by position and by type', () => {
  assert.equal(ctx.isHafakTask_(task('חפק', 'חפק', 'יומי', 63), REC), true);
  assert.equal(ctx.isHafakTask_(task('סיור', 'סיור', '14:00', 7), REC), false);
});

/* ---------------- the seat ---------------- */

test('only the first of the four חפק rows is the reserved seat', () => {
  const seats = hafakSeats();
  const group = { tasks: seats };
  assert.equal(ctx.isCommandStaffSeat_(seats[0], group, REC), true);
  assert.equal(ctx.isCommandStaffSeat_(seats[1], group, REC), false);
  assert.equal(ctx.isCommandStaffSeat_(seats[3], group, REC), false);
});

test('the seat is the first by sheet row, not by array order', () => {
  const seats = hafakSeats();
  const shuffled = { tasks: [seats[2], seats[0], seats[3], seats[1]] };
  assert.equal(ctx.isCommandStaffSeat_(seats[0], shuffled, REC), true);
  assert.equal(ctx.isCommandStaffSeat_(seats[2], shuffled, REC), false);
});

test('a lone חפק row is itself the reserved seat', () => {
  const only = task('חפק', 'חפק', 'יומי', 63);
  assert.equal(ctx.isCommandStaffSeat_(only, { tasks: [only] }, REC), true);
});

/* ---------------- both directions of the rule ---------------- */

test('the סמ"פ is a legal candidate for the first חפק seat', () => {
  const seats = hafakSeats();
  assert.equal(rejectReason(samap(), seats[0], seats), '');
});

test('the סמ"פ is rejected from every other חפק seat', () => {
  const seats = hafakSeats();
  assert.match(rejectReason(samap(), seats[1], seats), /רק למשבצת החפ״ק הראשונה/);
  assert.match(rejectReason(samap(), seats[3], seats), /רק למשבצת החפ״ק הראשונה/);
});

test('the מפל"ג is still kept out of ordinary positions', () => {
  // this is what excludedPlatoonOrRoleKeywords used to do bluntly; losing it
  // there must not mean losing it everywhere
  const tour = [task('סיור', 'סיור', '14:00', 7), task('סיור', 'סיור', '14:00', 8)];
  assert.match(rejectReason(samap(), tour[1], tour), /רק למשבצת החפ״ק הראשונה/);
  const staticSlot = task('עמדות הגנה', 'מזרחית', '14:00', 31);
  assert.match(rejectReason(samap(), staticSlot, [staticSlot]), /רק למשבצת החפ״ק הראשונה/);
});

test('an ordinary soldier is rejected from the first חפק seat', () => {
  const seats = hafakSeats();
  assert.match(rejectReason(fighter(), seats[0], seats), /שמורה למפל״ג/);
});

test('an ordinary soldier keeps the other three חפק seats', () => {
  const seats = hafakSeats();
  assert.equal(rejectReason(fighter(), seats[1], seats), '');
  assert.equal(rejectReason(fighter(), seats[3], seats), '');
});

test('hafakCommandStaffSeats: 0 turns the whole rule off', () => {
  const off = JSON.parse(JSON.stringify(REC));
  off.hafakCommandStaffSeats = 0;
  const seats = hafakSeats();
  assert.equal(ctx.isCommandStaffSeat_(seats[0], { tasks: seats }, off), false);
});

/* ---------------- the roster read ---------------- */

test('the מפל"ג is read into the roster the engine knows, flagged', () => {
  // the crux of the false ⚠: with includePlatoons ['1','2','3'] alone he was
  // never read at all, so an assignment naming him looked like a typo.
  const d = (y: number, m: number, day: number) => new Date(y, m - 1, day);
  const values = [
    ['', '', '', '', d(2026, 8, 10), d(2026, 8, 11), d(2026, 8, 12)],
    ['שם מלא', 'תפקיד', 'מחלקה', '', '', '', ''],
    ['אמיתי שמעון', 'לוחם', '3', '', 'נוכח', 'נוכח', 'נוכח'],
    ['שמואלי גרינברג', 'סמ"פ', 'מפל"ג', '', 'נוכח', 'נוכח', 'נוכח'],
    ['דני חמל', 'חמל', 'חמ"ל', '', 'נוכח', 'נוכח', 'נוכח'],
  ];
  const ss = {
    getSheetByName: (n: string) =>
      n === REC.sheets.roster ? { getDataRange: () => ({ getValues: () => values }) } : null,
  };

  const read = ctx.readRosterSoldiers_(ss, TODAY, REC);
  const byName: Record<string, any> = {};
  read.soldiers.forEach((s: any) => { byName[s.name] = s; });

  assert.ok(byName['שמואלי גרינברג'], 'the מפל"ג must be in the roster the engine reads');
  assert.equal(byName['שמואלי גרינברג'].isCommandStaff, true);
  assert.equal(byName['אמיתי שמעון'].isCommandStaff, false);
  // חמ"ל manages its own tab and stays out of the pool entirely
  assert.equal(byName['דני חמל'], undefined);
});

test('the חמ"ל is still blocked outright, by status not by seat', () => {
  const hamal = soldier('דני חמל', 'חמ"ל', 'חמל');
  const seats = hafakSeats();
  assert.match(rejectReason(hamal, seats[0], seats), /חמ״ל/);
});
