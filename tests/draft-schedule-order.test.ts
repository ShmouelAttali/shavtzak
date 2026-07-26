// Unit tests for the draft tab's crew display ordering
// (src/components/DraftSchedule.tsx's orderStationGroups) — the one place
// the shared commander-first/platoon-grouping helper (scheduler/src/
// crewOrder.ts) is wired into the viewer. The live שבצק sheet tab
// (Shavtzak.tsx's buildSheetDisplayGroups) never calls this — see
// shavtzak-display.test.ts, whose "sheet: ..." cases exercise that path
// directly and are unaffected by anything here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { orderStationGroups } from '../src/components/DraftSchedule';
import type { SoldierInfo } from '../src/components/Shavtzak';
import type { StationGroup } from '../api/_handlers/shavtzak';

function group(name: string, sug: string, times: [string, string[]][]): StationGroup {
  return { name, subTypes: [{ sug, times: times.map(([time, soldiers]) => ({ time, soldiers })) }] };
}

function lookupOf(entries: Record<string, SoldierInfo>): Map<string, SoldierInfo> {
  return new Map(Object.entries(entries));
}

test('commander first, then platoon-grouped, within a single time slot', () => {
  const groups = [group('התקפי', 'התקפי', [['14:00', ['רובאי-א', 'מפקד', 'רובאי-ב', 'רובאי-ג']]])];
  const lookup = lookupOf({
    'רובאי-א': { unit: '1', role: 'רובאי', phone: '' },
    'מפקד': { unit: '1', role: 'מ"כ', phone: '' },
    'רובאי-ב': { unit: '2', role: 'רובאי', phone: '' },
    'רובאי-ג': { unit: '1', role: 'רובאי', phone: '' },
  });
  const [out] = orderStationGroups(groups, lookup);
  assert.deepEqual(out.subTypes[0].times[0].soldiers, ['מפקד', 'רובאי-א', 'רובאי-ג', 'רובאי-ב']);
});

test('no commander in the slot: soldiers stay grouped by platoon, seat-stable', () => {
  const groups = [group('סיור', 'סיור', [['22:00', ['א', 'ב', 'ג']]])];
  const lookup = lookupOf({
    'א': { unit: '1', role: 'רובאי', phone: '' },
    'ב': { unit: '2', role: 'רובאי', phone: '' },
    'ג': { unit: '1', role: 'רובאי', phone: '' },
  });
  const [out] = orderStationGroups(groups, lookup);
  assert.deepEqual(out.subTypes[0].times[0].soldiers, ['א', 'ג', 'ב']);
});

test('mixed platoons across a slot stay grouped in first-appearance order', () => {
  const groups = [group('מגן', 'מגן', [['14:00', ['א', 'ב', 'ג', 'ד']]])];
  const lookup = lookupOf({
    'א': { unit: '1', role: 'רובאי', phone: '' },
    'ב': { unit: '2', role: 'רובאי', phone: '' },
    'ג': { unit: '1', role: 'רובאי', phone: '' },
    'ד': { unit: '2', role: 'רובאי', phone: '' },
  });
  const [out] = orderStationGroups(groups, lookup);
  assert.deepEqual(out.subTypes[0].times[0].soldiers, ['א', 'ג', 'ב', 'ד']);
});

test('unknown names (e.g. "לא מאויש" placeholders, missing from the roster lookup) do not throw and stay last', () => {
  const groups = [group('סיור', 'סיור', [['22:00', ['א', 'לא מאויש']]])];
  const lookup = lookupOf({ 'א': { unit: '1', role: 'רובאי', phone: '' } });
  const [out] = orderStationGroups(groups, lookup);
  assert.deepEqual(out.subTypes[0].times[0].soldiers, ['א', 'לא מאויש']);
});

test('single-soldier and empty slots pass through unchanged', () => {
  const groups = [group('חפק', 'חפק', [['14:00', ['יחיד']], ['22:00', []]])];
  const [out] = orderStationGroups(groups, new Map());
  assert.deepEqual(out.subTypes[0].times[0].soldiers, ['יחיד']);
  assert.deepEqual(out.subTypes[0].times[1].soldiers, []);
});

test('does not mutate the input groups (pure, new arrays/objects)', () => {
  const groups = [group('התקפי', 'התקפי', [['14:00', ['ב', 'מפקד']]])];
  const original = JSON.parse(JSON.stringify(groups));
  orderStationGroups(groups, lookupOf({ 'מפקד': { unit: '1', role: 'מ"כ', phone: '' } }));
  assert.deepEqual(groups, original);
});
