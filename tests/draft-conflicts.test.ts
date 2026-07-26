// Unit tests for the draft tab's client-side double-booking detection
// (src/lib/draftConflicts.ts): which slot labels overlap inside the 14:00→14:00
// schedule day, and which of a candidate's existing seats therefore block
// assigning him — the popup asks to vacate exactly those.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  conflictLabel, conflictNotes, findSlotConflicts, parseSlotSpan, pendingSeatKeys, spansOverlap,
} from '../src/lib/draftConflicts';
import { seatKey, seatsForDay } from '../src/hooks/useDraft';
import type { DraftAssignmentMeta, DraftDay } from '../api/draft';

const span = (label: string) => {
  const s = parseSlotSpan(label);
  assert.ok(s, `unparsed label ${label}`);
  return s!;
};

test('labels parse to minutes from the 14:00 anchor; pre-14:00 hours are the tail', () => {
  assert.deepEqual(span('14:00-22:00'), { start: 0, end: 480 });
  assert.deepEqual(span('22:00-06:00'), { start: 480, end: 960 });      // wraps midnight
  assert.deepEqual(span('06:00-14:00'), { start: 960, end: 1440 });     // tomorrow morning
  assert.deepEqual(span('10:00-18:00 (למחרת)'), { start: 1200, end: 1680 });
  assert.deepEqual(span('יומי'), { start: 0, end: 1440 });              // daily duty = whole day
  assert.equal(parseSlotSpan('בוקר'), null);
});

test('overlap is half-open: touching windows do not overlap', () => {
  assert.equal(spansOverlap(span('14:00-22:00'), span('22:00-06:00')), false);
  assert.equal(spansOverlap(span('18:00-02:00'), span('22:00-06:00')), true);
  assert.equal(spansOverlap(span('יומי'), span('22:00-06:00')), true);
  assert.equal(spansOverlap(span('14:00-22:00'), span('06:00-14:00')), false);
});

// ── Fixture: one day, four seats ────────────────────────────────────────────
const meta = (over: Partial<DraftAssignmentMeta> = {}): DraftAssignmentMeta =>
  ({ source: 'auto', locked: false, blocksOverlap: true, violations: [], rationale: [], ...over });

const DAY: DraftDay = {
  day: '2026-07-20', status: 'generated', generatedAt: null, publishedAt: null,
  approvedBy: null, hasReport: false, validation: [],
  groups: [
    { name: 'סיור', subTypes: [{ sug: 'סיור', times: [
      { time: '18:00-02:00', soldiers: ['אבי', 'בני'] },
      { time: '02:00-10:00', soldiers: ['גדי'] },
    ] }] },
    { name: 'עמדות הגנה', subTypes: [
      { sug: 'שג', times: [{ time: '22:00-06:00', soldiers: ['דני'] }] },
      { sug: 'בונקר', times: [{ time: '18:00-02:00', soldiers: ['הרן'] }] },
    ] },
    { name: 'מגן', subTypes: [{ sug: 'מגן', times: [{ time: 'יומי', soldiers: ['ורד'] }] }] },
    { name: 'כרמל חטיבה', subTypes: [{ sug: 'כרמל חטיבה', times: [
      { time: '22:00-06:00', soldiers: ['זיו'] },
    ] }] },
  ],
  meta: {
    'אבי|18:00-02:00': meta(), 'בני|18:00-02:00': meta(), 'גדי|02:00-10:00': meta(),
    'דני|22:00-06:00': meta(), 'הרן|18:00-02:00': meta(), 'ורד|יומי': meta(),
    // readiness overlay — legally shares its hours (blocks_overlap=false)
    'זיו|22:00-06:00': meta({ blocksOverlap: false }),
  },
  dayAssignments: {},
};

const target = { time: '18:00-02:00', outgoing: 'אבי' };

test('a candidate holding an overlapping blocking seat conflicts, named', () => {
  const c = findSlotConflicts(DAY, 'דני', target);
  assert.deepEqual(c, [{ position: 'עמדות הגנה', sub: 'שג', time: '22:00-06:00' }]);
  assert.equal(conflictLabel(c[0]), 'עמדות הגנה — שג (22:00-06:00)');
});

test('a daily duty conflicts with any shift of that day', () => {
  assert.deepEqual(findSlotConflicts(DAY, 'ורד', target),
    [{ position: 'מגן', sub: 'מגן', time: 'יומי' }]);
});

test('non-overlapping hours are no conflict', () => {
  assert.deepEqual(findSlotConflicts(DAY, 'גדי', target), []);   // 02:00-10:00 starts as it ends
});

test('a readiness overlay of his does not conflict (blocks_overlap=false)', () => {
  assert.deepEqual(findSlotConflicts(DAY, 'זיו', target), []);
});

test('the clicked slot itself is not a conflict — that is "already in this shift"', () => {
  assert.deepEqual(findSlotConflicts(DAY, 'בני', target), []);
});

test('a same-label seat in ANOTHER position IS a conflict', () => {
  assert.deepEqual(findSlotConflicts(DAY, 'הרן', target),
    [{ position: 'עמדות הגנה', sub: 'בונקר', time: '18:00-02:00' }]);
});

test('a non-blocking target cannot conflict with anything', () => {
  assert.deepEqual(findSlotConflicts(DAY, 'דני', { ...target, blocks: false }), []);
});

test('conflictNotes covers every candidate, skipping the outgoing soldier', () => {
  const notes = conflictNotes(DAY, target);
  assert.deepEqual(Object.keys(notes).sort(), ['הרן', 'ורד', 'דני'].sort());
  assert.equal(notes['דני'], 'עמדות הגנה — שג (22:00-06:00)');
  assert.equal(notes['ורד'], 'מגן (יומי)');       // sub == position → not repeated
  assert.ok(!('אבי' in notes), 'the soldier being replaced is not a candidate');
  assert.ok(!('זיו' in notes), 'readiness overlay holder is free to join');
});

// ── Seats locked while a replacement is in flight ───────────────────────────
// The popup closes on the pick, so the round trip is shown on the grid: the
// clicked seat AND every seat the incoming soldier is evicted from get a
// spinner and swallow clicks (no colliding second edit on a row being moved).
test('pendingSeatKeys locks the clicked seat', () => {
  assert.deepEqual(pendingSeatKeys(target, 'דני', []), ['אבי|18:00-02:00']);
});

test('pendingSeatKeys also locks each seat the incoming soldier is evicted from', () => {
  const conflicts = findSlotConflicts(DAY, 'דני', target);
  assert.deepEqual(pendingSeatKeys(target, 'דני', conflicts),
    ['אבי|18:00-02:00', 'דני|22:00-06:00']);
});

test('pendingSeatKeys dedupes two evictions sharing one label', () => {
  const conflicts = [
    { position: 'עמדות הגנה', sub: 'שג', time: '22:00-06:00' },
    { position: 'כרמל חטיבה', sub: 'כרמל חטיבה', time: '22:00-06:00' },
  ];
  assert.deepEqual(pendingSeatKeys(target, 'דני', conflicts),
    ['אבי|18:00-02:00', 'דני|22:00-06:00']);
});

// ── The flat pending set is per-day-sliced for the grid ─────────────────────
test('seatsForDay slices the pending set by day, keeping the name|time key', () => {
  const pending = new Set([
    seatKey('2026-07-20', 'אבי|18:00-02:00'),
    seatKey('2026-07-20', 'דני|22:00-06:00'),
    seatKey('2026-07-21', 'אבי|18:00-02:00'),
  ]);
  assert.deepEqual(seatsForDay(pending, '2026-07-20'),
    new Set(['אבי|18:00-02:00', 'דני|22:00-06:00']));
  assert.deepEqual(seatsForDay(pending, '2026-07-21'), new Set(['אבי|18:00-02:00']));
  assert.deepEqual(seatsForDay(pending, '2026-07-22'), new Set());
});
