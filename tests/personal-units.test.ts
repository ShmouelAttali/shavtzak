// לוז אישי's מחלקה filter: the default is כלל הפלוגה (ALL_UNITS) — the tab
// used to show NO soldiers until a מחלקה was picked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALL_UNITS, soldiersForUnit } from '../src/components/PersonalSchedule';

const soldiers = [
  { fullName: 'דני', unit: '2' },
  { fullName: 'אבי', unit: '1' },
  { fullName: 'גדי', unit: '1' },
];

test('כלל הפלוגה lists every soldier, sorted by name', () => {
  assert.deepEqual(
    soldiersForUnit(soldiers, ALL_UNITS).map((s) => s.fullName),
    ['אבי', 'גדי', 'דני'],
  );
});

test('a chosen מחלקה lists only its soldiers', () => {
  assert.deepEqual(
    soldiersForUnit(soldiers, '1').map((s) => s.fullName),
    ['אבי', 'גדי'],
  );
});

test('a legacy empty stored מחלקה falls back to the whole company', () => {
  assert.equal(soldiersForUnit(soldiers, '').length, 3);
});

test('the input array is not mutated', () => {
  soldiersForUnit(soldiers, ALL_UNITS);
  assert.deepEqual(soldiers.map((s) => s.fullName), ['דני', 'אבי', 'גדי']);
});
