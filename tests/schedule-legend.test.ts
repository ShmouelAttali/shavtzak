// The legend used to be a hardcoded 5-status list, so a status the sheet
// actually uses (e.g. a free-text יציאה like "יציאה מ14 עד 18") either didn't
// show at all or showed with a color unrelated to other יציאה statuses. The
// legend must now be built from what's actually in view, with every יציאה
// variant sharing one collapsed entry.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLegendItems } from '../src/components/ScheduleLegend';

function soldier(schedule: Record<string, string>) {
  return { schedule };
}

test('collapses every יציאה variant into one legend entry', () => {
  const soldiers = [
    soldier({ '01/07/26': 'יציאה מ14 עד 18' }),
    soldier({ '01/07/26': 'יציאה בערב' }),
  ];
  const items = buildLegendItems(soldiers, ['01/07/26']);
  const exitItems = items.filter((i) => i.label === 'יציאה');
  assert.equal(exitItems.length, 1);
});

test('non-יציאה statuses each keep their own exact-text entry', () => {
  const soldiers = [soldier({ '01/07/26': 'חופש', '02/07/26': 'שחרור' })];
  const items = buildLegendItems(soldiers, ['01/07/26', '02/07/26']);
  assert.deepEqual(
    items.map((i) => i.label).sort((a, b) => a.localeCompare(b, 'he')),
    ['חופש', 'שחרור'].sort((a, b) => a.localeCompare(b, 'he')),
  );
});

test('only reflects the dates/soldiers actually passed in, not every status ever seen', () => {
  const soldiers = [soldier({ '01/07/26': 'חופש', '02/07/26': 'לא מגיע' })];
  const items = buildLegendItems(soldiers, ['01/07/26']);
  assert.deepEqual(items.map((i) => i.label), ['חופש']);
});

test('a blank/present cell contributes nothing', () => {
  const soldiers = [soldier({})];
  const items = buildLegendItems(soldiers, ['01/07/26']);
  assert.deepEqual(items, []);
});

test('a free-text status not otherwise recognized still gets its own entry', () => {
  const soldiers = [soldier({ '01/07/26': 'קורס קצינים' })];
  const items = buildLegendItems(soldiers, ['01/07/26']);
  assert.deepEqual(items.map((i) => i.label), ['קורס קצינים']);
});
