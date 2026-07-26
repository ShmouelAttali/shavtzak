// Unit tests for the draft tab's replacement popup logic
// (src/components/ReplaceSoldierPopup.tsx): which seat counts as a
// driver/commander seat — read off the generator's own rationale, never a
// hardcoded position name — and how that narrows the candidate list.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { driverQual, isCommanderSlot, replacementOptions } from '../src/components/ReplaceSoldierPopup';
import type { DraftAssignmentMeta, DraftRosterEntry } from '../api/draft';

const meta = (...rationale: DraftAssignmentMeta['rationale']): DraftAssignmentMeta =>
  ({ source: 'auto', locked: false, blocksOverlap: true, violations: [], rationale });

const soldier = (id: number, name: string, role: string, quals: string[] = []): DraftRosterEntry =>
  ({ id, name, role, platoon: '1', schedulable: true, quals });

const ROSTER = [
  soldier(1, 'דוד לוי', 'לוחם'),
  soldier(2, 'נהג דוידי', 'לוחם', ['נהג דוד']),
  soldier(3, 'נהג טיגריסי', 'לוחם', ['נהג טיגריס']),
  soldier(4, 'מפקד כיתה', 'מ"כ'),
  soldier(5, 'מפקד נהג', 'סמל', ['נהג דוד']),
];

test('driver seat detected from the rationale, with the required qualification', () => {
  assert.equal(driverQual(meta({ code: 'driver_seat', params: { qual: 'נהג דוד' } })), 'נהג דוד');
  assert.equal(driverQual(meta({ code: 'driver_quota', params: { qual: 'נהג טיגריס' } })), 'נהג טיגריס');
  assert.equal(driverQual(meta({ code: 'driver_seat' })), 'נהג');       // qual missing → generic
  assert.equal(driverQual(meta({ code: 'rest_ok' })), null);
  assert.equal(driverQual(undefined), null);
});

test('commander seat detected from any commander rationale code', () => {
  for (const code of ['commander_seat', 'commander_quota', 'chain_commander', 'magen_commander'] as const) {
    assert.equal(isCommanderSlot(meta({ code })), true, code);
  }
  assert.equal(isCommanderSlot(meta({ code: 'fairness_pick' })), false);
  assert.equal(isCommanderSlot(undefined), false);
});

test('the qualification filter keeps only holders of that exact qualification', () => {
  const names = replacementOptions(ROSTER, { qual: 'נהג דוד' }).map((s) => s.name);
  assert.deepEqual(names, ['נהג דוידי', 'מפקד נהג']);   // NOT the טיגריס driver
});

test('the commander filter keeps only commander roles; both filters compose', () => {
  assert.deepEqual(
    replacementOptions(ROSTER, { commanderOnly: true }).map((s) => s.name),
    ['מפקד כיתה', 'מפקד נהג']);
  assert.deepEqual(
    replacementOptions(ROSTER, { commanderOnly: true, qual: 'נהג דוד' }).map((s) => s.name),
    ['מפקד נהג']);
});

test('filters off → the whole roster, minus the soldier being replaced', () => {
  const all = replacementOptions(ROSTER, { excludeId: 2 });
  assert.equal(all.length, ROSTER.length - 1);
  assert.ok(!all.some((s) => s.id === 2));
});

test('the day bucket rides along as a per-candidate note', () => {
  const [first] = replacementOptions(ROSTER, { busyNote: { 'דוד לוי': 'מנוחה' } });
  assert.equal(first.note, 'מנוחה');
});

test('an overlapping seat rides along as the candidate\'s ⚠ warning', () => {
  const opts = replacementOptions(ROSTER, {
    busyNote: { 'דוד לוי': 'סיור' },
    conflictNote: { 'דוד לוי': 'סיור (18:00-02:00)' },
  });
  const clashing = opts.find((s) => s.name === 'דוד לוי')!;
  assert.equal(clashing.warn, 'סיור (18:00-02:00)');
  assert.equal(clashing.note, 'סיור');                  // the note is kept, warn wins in the UI
  assert.equal(opts.find((s) => s.name === 'מפקד כיתה')!.warn, undefined);
});
