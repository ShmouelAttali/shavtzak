import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';

/**
 * v3.8: התקפי goes out as two four-man teams inside one group — slots 1-4 and
 * 5-8 — each led by the soldier in its own first slot. The "same מחלקה as the
 * commander" preference is measured against the team's commander, so slots 6-8
 * follow slot 5 rather than slot 1.
 *
 * These exercise getAssignedGroupCommander_ directly: it is the single place
 * the anchor is chosen, and driving it takes a group plus a soldier map rather
 * than a whole spreadsheet.
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

type Person = { name: string; role: string; platoon: string };

// mirrors the live 11/08 התקפי: סמל מחלקה 3 over slots 1-4, מ"כ מחלקה 1 over 5-8
const PEOPLE: Person[] = [
  { name: 'אסף פרץ', role: 'סמל', platoon: '3' },
  { name: 'אילן הרמן', role: 'לוחם', platoon: '3' },
  { name: 'שלו גילבר', role: 'לוחם', platoon: '3' },
  { name: 'שמואל גרוס', role: 'חובש', platoon: '3' },
  { name: 'עדו פרץ', role: 'מ"כ', platoon: '1' },
  { name: 'יהודה ונדרמן', role: 'לוחם', platoon: '3' },
  { name: 'אסף גנץ', role: 'לוחם', platoon: '1' },
  { name: 'נעם שטראוס', role: 'נהג טיגריס', platoon: '1' },
];

function soldier(p: Person) {
  return {
    name: p.name,
    nameKey: ctx.normalizeNameKey_(p.name),
    role: p.role,
    platoon: p.platoon,
    isCommander: ctx.containsAny_(p.role, REC.roles.commanderKeywords),
    isSeniorCommander: ctx.containsAny_(p.role, REC.roles.seniorCommanderKeywords),
  };
}

const soldiersByName: Record<string, any> = {};
for (const p of PEOPLE) soldiersByName[ctx.normalizeNameKey_(p.name)] = soldier(p);

/** an התקפי group whose slots hold the given names ('' = empty slot) */
function attackGroup(names: string[]) {
  const tasks = names.map((assigned, i) => ({
    rowNumber: 55 + i,
    category: 'attack',
    position: 'התקפי',
    type: 'התקפי',
    assigned,
  }));
  return { key: 'attack|1', tasks };
}

const commanderFor = (group: any, slot: number) =>
  ctx.getAssignedGroupCommander_(group.tasks[slot - 1], group, soldiersByName, REC);

test('slots 1-4 follow the commander in slot 1', () => {
  const group = attackGroup(PEOPLE.map(p => p.name));
  for (const slot of [1, 2, 3, 4]) {
    assert.equal(commanderFor(group, slot)?.name, 'אסף פרץ', `slot ${slot}`);
  }
});

test('slots 5-8 follow the commander in slot 5, not slot 1', () => {
  const group = attackGroup(PEOPLE.map(p => p.name));
  for (const slot of [5, 6, 7, 8]) {
    assert.equal(commanderFor(group, slot)?.name, 'עדו פרץ', `slot ${slot}`);
  }
});

test('a team with no commander of its own falls back to the group commander', () => {
  // slot 5 holds a rifleman and no one in 5-8 can command
  const names = PEOPLE.map(p => p.name);
  names[4] = 'אילן הרמן';
  const group = attackGroup(names);

  assert.equal(commanderFor(group, 1)?.name, 'אסף פרץ', 'team A is unaffected');
  // slots 6-8 still get a מחלקה preference, now pointing at מחלקה 3
  for (const slot of [6, 7, 8]) {
    assert.equal(commanderFor(group, slot)?.name, 'אסף פרץ', `slot ${slot}`);
  }
});

test('the fallback label says "המפקד", the team anchor says "מפקד הצוות"', () => {
  const withTeamCommander = attackGroup(PEOPLE.map(p => p.name));
  const names = PEOPLE.map(p => p.name);
  names[4] = 'אילן הרמן';
  const withoutTeamCommander = attackGroup(names);

  const resolve = (group: any, slot: number) =>
    ctx.resolveCommanderForTask_(group.tasks[slot - 1], group, soldiersByName, REC);

  assert.equal(resolve(withTeamCommander, 6).fromTeam, true);
  assert.equal(resolve(withoutTeamCommander, 6).fromTeam, false);
  // team A always reads as its own team's commander in a split group
  assert.equal(resolve(withTeamCommander, 2).fromTeam, true);
});

test('an empty second team still follows the group commander', () => {
  // slots 5-8 all unassigned — nothing to anchor on inside the team
  const names = [...PEOPLE.slice(0, 4).map(p => p.name), '', '', '', ''];
  const group = attackGroup(names);

  assert.equal(commanderFor(group, 6)?.name, 'אסף פרץ');
});

test('a commander anywhere in the team anchors it when slot 5 is empty', () => {
  const names = PEOPLE.map(p => p.name);
  names[4] = '';          // slot 5 empty
  names[6] = 'עדו פרץ';   // the מ"כ sits in slot 7 instead
  const group = attackGroup(names);

  assert.equal(commanderFor(group, 6)?.name, 'עדו פרץ');
});

test('an התקפי smaller than a team is one team, as before', () => {
  const group = attackGroup(['אסף פרץ', 'אילן הרמן', 'שלו גילבר']);
  for (const slot of [1, 2, 3]) {
    assert.equal(commanderFor(group, slot)?.name, 'אסף פרץ', `slot ${slot}`);
  }
});

test('other categories are never split into teams', () => {
  // a 12-slot מגן group: every slot still answers to the one group commander
  const names = ['אסף פרץ', ...Array(11).fill('אילן הרמן')];
  const group = {
    key: 'magen|1',
    tasks: names.map((assigned, i) => ({
      rowNumber: 100 + i, category: 'magen', position: 'מגן + תגבצ', type: 'מגן השומרון', assigned,
    })),
  };

  for (const slot of [1, 5, 9, 12]) {
    assert.equal(
      ctx.getAssignedGroupCommander_(group.tasks[slot - 1], group, soldiersByName, REC)?.name,
      'אסף פרץ',
      `slot ${slot}`,
    );
  }
});

test('attackTeamSize: 0 turns the split off', () => {
  const group = attackGroup(PEOPLE.map(p => p.name));
  const noSplit = Object.assign({}, REC, { attackTeamSize: 0 });
  assert.equal(
    ctx.getAssignedGroupCommander_(group.tasks[5], group, soldiersByName, noSplit)?.name,
    'אסף פרץ',
  );
});

test('the split changes which מחלקה the preference points at', () => {
  const group = attackGroup(PEOPLE.map(p => p.name));

  // slot 6 is מחלקה 3 — matched team A's commander before, matches nobody now
  assert.equal(commanderFor(group, 6)?.platoon, '1');
  assert.equal(soldiersByName[ctx.normalizeNameKey_('יהודה ונדרמן')].platoon, '3');

  // slot 7 is מחלקה 1 — did not match before, matches its team commander now
  assert.equal(soldiersByName[ctx.normalizeNameKey_('אסף גנץ')].platoon, '1');
  assert.equal(commanderFor(group, 7)?.name, 'עדו פרץ');
});
