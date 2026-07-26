// Pure unit tests for the shared crew display-ordering helper — no DB.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { orderCrew, isCommanderRole, CrewMember } from '../src/crewOrder.js';

type M = CrewMember & { id: number };

const m = (id: number, name: string, role: string, platoon: string, seatIndex: number): M =>
  ({ id, name, role, platoon, seatIndex });

test('isCommanderRole matches the מ"מ/מ"פ/סמ"פ/סמל/מ"כ set, quote-insensitive', () => {
  assert.ok(isCommanderRole('מ"כ'));
  assert.ok(isCommanderRole('מכ')); // stripped-quote variant
  assert.ok(isCommanderRole('סמל'));
  assert.ok(isCommanderRole('מ"מ'));
  assert.ok(!isCommanderRole('רובאי'));
  assert.ok(!isCommanderRole(''));
  assert.ok(!isCommanderRole(undefined));
});

test('commander first, then remaining grouped by platoon', () => {
  // Seat order: 1 (plt A rifleman), 2 (commander), 3 (plt B rifleman), 4 (plt A rifleman)
  const crew = [
    m(1, 'א', 'רובאי', 'A', 0),
    m(2, 'ב', 'מ"כ', 'A', 1),
    m(3, 'ג', 'רובאי', 'B', 2),
    m(4, 'ד', 'רובאי', 'A', 3),
  ];
  const out = orderCrew(crew).map((s) => s.id);
  // commander (2) first; then platoon A members (1, 4) kept together before
  // platoon B's single member (3) — platoon A appeared first (seatIndex 0).
  assert.deepEqual(out, [2, 1, 4, 3]);
});

test('no commander: falls back to plain platoon grouping, seat-stable', () => {
  const crew = [
    m(1, 'א', 'רובאי', 'A', 0),
    m(2, 'ב', 'רובאי', 'B', 1),
    m(3, 'ג', 'רובאי', 'A', 2),
  ];
  const out = orderCrew(crew).map((s) => s.id);
  // Platoon A (seen first at seat 0) groups {1, 3}; then platoon B {2}.
  assert.deepEqual(out, [1, 3, 2]);
});

test('single uniform platoon, no commander: seatIndex order preserved exactly', () => {
  const crew = [
    m(1, 'ג', 'רובאי', 'A', 2),
    m(2, 'א', 'רובאי', 'A', 0),
    m(3, 'ב', 'רובאי', 'A', 1),
  ];
  const out = orderCrew(crew).map((s) => s.id);
  assert.deepEqual(out, [2, 3, 1]); // by seatIndex 0,1,2 regardless of input order
});

test('stability: equal seatIndex ties break by name (deterministic, not input order)', () => {
  const crew = [
    m(1, 'ב', 'רובאי', 'A', 0),
    m(2, 'א', 'רובאי', 'A', 0),
  ];
  const out = orderCrew(crew).map((s) => s.name);
  assert.deepEqual(out, ['א', 'ב']);
});

test('mixed platoons interleaved by seat: still grouped together in first-appearance order', () => {
  const crew = [
    m(1, 'א', 'רובאי', 'A', 0),
    m(2, 'ב', 'רובאי', 'B', 1),
    m(3, 'ג', 'רובאי', 'A', 2),
    m(4, 'ד', 'רובאי', 'C', 3),
    m(5, 'ה', 'רובאי', 'B', 4),
  ];
  const out = orderCrew(crew).map((s) => s.id);
  // groups in first-appearance order: A {1,3}, B {2,5}, C {4}
  assert.deepEqual(out, [1, 3, 2, 5, 4]);
});

test('multiple commanders: both lead, ordered by seatIndex, before any platoon group', () => {
  const crew = [
    m(1, 'א', 'רובאי', 'A', 0),
    m(2, 'ב', 'מ"כ', 'A', 1),
    m(3, 'ג', 'סמל', 'B', 2),
  ];
  const out = orderCrew(crew).map((s) => s.id);
  assert.deepEqual(out, [2, 3, 1]);
});

test('custom commanderRoles option overrides the default set', () => {
  const crew = [
    m(1, 'א', 'נהג', 'A', 0),
    m(2, 'ב', 'רובאי', 'A', 1),
  ];
  const out = orderCrew(crew, { commanderRoles: ['נהג'] }).map((s) => s.id);
  assert.deepEqual(out, [1, 2]); // נהג treated as "commander" for this call only
});

test('extra fields on T pass through untouched (generic wrapper use, e.g. report.ts)', () => {
  const wrapped = [
    { a: { tag: 'x' }, role: 'מ"כ', platoon: 'A', seatIndex: 0, name: 'א' },
    { a: { tag: 'y' }, role: 'רובאי', platoon: 'A', seatIndex: 1, name: 'ב' },
  ];
  const out = orderCrew(wrapped);
  assert.deepEqual(out.map((w) => w.a.tag), ['x', 'y']);
});

test('empty crew returns empty', () => {
  assert.deepEqual(orderCrew([]), []);
});
