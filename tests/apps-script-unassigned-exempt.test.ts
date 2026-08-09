import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';

/**
 * v3.13: "חייל מסומן כזמין אבל בלי משימה" skips the מפל"ג.
 *
 * Those soldiers (מ"פ, סמ"פ, רס"פ, סרס"פ, מנהלה) are never assigned in the
 * company שבצ"ק, so the alert was permanent noise — 6 of the 42 alerts on
 * the day this was measured.
 */
const OPS = path.join(process.cwd(), 'apps-script/plugat-gaash/ShabtzakOps.js');
const ctx: any = {
  console, Date, Math, JSON, String, Number, Boolean, Array, Object, Map, Set,
  isNaN, parseInt, parseFloat, RegExp, Error,
  SpreadsheetApp: {
    getUi: () => ({ createMenu: () => ({ addItem() { return this; }, addSeparator() { return this; }, addToUi() {} }) }),
  },
  HtmlService: {},
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(OPS, 'utf8') + '\n;globalThis.CONFIG = CONFIG;\n', ctx);

/* ------------------------- the exemption itself ------------------------- */

const exempt = (platoon: string, role = 'לוחם') =>
  ctx.isExemptFromUnassignedAlert_({ platoon, role });

test('מפל"ג is exempt, the fighting מחלקות are not', () => {
  assert.equal(exempt('מפל"ג', 'מ"פ'), true);
  for (const platoon of ['1', '2', '3']) {
    assert.equal(exempt(platoon), false, platoon);
  }
});

test('the exemption survives however the גרשיים are typed', () => {
  // ASCII double quote, Hebrew gershayim, and no quote at all
  for (const spelling of ['מפל"ג', 'מפל״ג', 'מפלג']) {
    assert.equal(exempt(spelling, 'רס"פ'), true, spelling);
  }
});

test('חמ"ל is NOT exempt — only the מפל"ג was asked for', () => {
  assert.equal(exempt('חמ"ל', 'חמל'), false);
});

test('a soldier with no מחלקה at all is not exempt', () => {
  assert.equal(ctx.isExemptFromUnassignedAlert_({ platoon: '', role: '' }), false);
  assert.equal(ctx.isExemptFromUnassignedAlert_(null), false);
});

/* --------------------- end to end through the validator --------------------- */

const TARGET = new Date(2026, 7, 12);

type Row = { name: string; role: string; platoon: string; status?: string };

function rosterSheet(rows: Row[], withUnitColumns = true) {
  const header = withUnitColumns
    ? ['שם מלא', 'תפקיד', 'מחלקה', '', '']
    : ['שם מלא', '', '', '', ''];
  const grid: any[][] = [
    ['', '', '', '12/08/26', '13/08/26'],
    ['', '', '', '', ''],
    header,
    ...rows.map(r => [r.name, r.role, r.platoon, r.status ?? 'נוכח', r.status ?? 'נוכח']),
  ];
  return {
    getName: () => 'מצבת החיילים',
    getDataRange: () => ({ getValues: () => grid }),
    getLastRow: () => grid.length,
    getLastColumn: () => grid[0].length,
  };
}

function unassignedAlerts(rows: Row[], assigned: string[] = [], withUnitColumns = true) {
  const errors: string[] = [];
  const warnings: string[] = [];
  const roster = ctx.readRoster_(rosterSheet(rows, withUnitColumns), TARGET, errors);

  // one shift per already-assigned soldier, so the rest count as unassigned
  const shifts = assigned.map((name, i) => ({
    rowNumber: i + 2,
    date: TARGET,
    position: 'שג',
    type: 'עמדות הגנה',
    soldier: name,
    timeText: '14:00-18:00',
    hasRealTimeRange: true,
    startMin: 14 * 60,
    endMin: 18 * 60,
    isDaily: false,
  }));

  ctx.validateAvailabilityAndMissingAssignments_(shifts, roster, errors, warnings);
  return errors.filter(e => e.includes('זמין אבל בלי משימה'));
}

test('an available, unassigned מפל"ג soldier raises no alert', () => {
  const alerts = unassignedAlerts([
    { name: 'כרמי בן יוסף', role: 'מ"פ', platoon: 'מפל"ג' },
    { name: 'עמוס מכלוף', role: 'רס"פ', platoon: 'מפל"ג' },
  ]);
  assert.deepEqual(alerts, []);
});

test('an available, unassigned fighter still raises the alert', () => {
  const alerts = unassignedAlerts([
    { name: 'אילן הרמן', role: 'לוחם', platoon: '3' },
    { name: 'כרמי בן יוסף', role: 'מ"פ', platoon: 'מפל"ג' },
  ]);
  assert.equal(alerts.length, 1);
  assert.match(alerts[0], /אילן הרמן/);
});

test('an assigned fighter raises nothing, as before', () => {
  const alerts = unassignedAlerts(
    [{ name: 'אילן הרמן', role: 'לוחם', platoon: '3' }],
    ['אילן הרמן'],
  );
  assert.deepEqual(alerts, []);
});

test('a מפל"ג soldier on חופש is filtered by availability, not by the exemption', () => {
  const alerts = unassignedAlerts([
    { name: 'עמוס מכלוף', role: 'רס"פ', platoon: 'מפל"ג', status: 'חופש' },
  ]);
  assert.deepEqual(alerts, []);
});

test('without a מחלקה column the validator still runs, exemption simply inactive', () => {
  const alerts = unassignedAlerts(
    [{ name: 'כרמי בן יוסף', role: 'מ"פ', platoon: 'מפל"ג' }],
    [],
    false,
  );
  assert.equal(alerts.length, 1, 'no crash; the soldier is reported as before');
});
