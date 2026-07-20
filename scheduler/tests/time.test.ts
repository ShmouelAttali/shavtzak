import './env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  toMin, minToIso, minToDate, parseRange, addDays, dayStart, dayEnd,
  nightRange, slotStart, scheduleDayStart, overlaps, hours, fmtHM,
} from '../src/time.js';

test('scheduleDayStart: 14:00-anchored floor of the containing schedule day', () => {
  assert.equal(minToIso(scheduleDayStart(toMin('2026-07-15', '14:00'))), '2026-07-15 14:00:00');
  assert.equal(minToIso(scheduleDayStart(toMin('2026-07-15', '22:00'))), '2026-07-15 14:00:00');
  assert.equal(minToIso(scheduleDayStart(toMin('2026-07-16', '06:00'))), '2026-07-15 14:00:00');
  assert.equal(minToIso(scheduleDayStart(toMin('2026-07-16', '13:59'))), '2026-07-15 14:00:00');
  assert.equal(minToIso(scheduleDayStart(toMin('2026-07-16', '14:00'))), '2026-07-16 14:00:00');
});

test('toMin/minToIso round trip', () => {
  const m = toMin('2026-07-15', '14:30');
  assert.equal(minToIso(m), '2026-07-15 14:30:00');
  assert.equal(minToDate(m), '2026-07-15');
});

test('parseRange parses postgres tsrange text', () => {
  const [s, e] = parseRange('["2026-07-15 22:00:00","2026-07-16 06:00:00")');
  assert.equal(minToIso(s), '2026-07-15 22:00:00');
  assert.equal(minToIso(e), '2026-07-16 06:00:00');
});

test('schedule day anchored at 14:00', () => {
  assert.equal(minToIso(dayStart('2026-07-15')), '2026-07-15 14:00:00');
  assert.equal(minToIso(dayEnd('2026-07-15')), '2026-07-16 14:00:00');
});

test('night window is 00:00-06:00 of the following morning', () => {
  const [s, e] = nightRange('2026-07-15');
  assert.equal(minToIso(s), '2026-07-16 00:00:00');
  assert.equal(minToIso(e), '2026-07-16 06:00:00');
});

test('slotStart: times before 14:00 land on the next calendar morning', () => {
  assert.equal(minToIso(slotStart('2026-07-15', '22:00')), '2026-07-15 22:00:00');
  assert.equal(minToIso(slotStart('2026-07-15', '02:00')), '2026-07-16 02:00:00');
  assert.equal(minToIso(slotStart('2026-07-15', '06:00')), '2026-07-16 06:00:00');
  assert.equal(minToIso(slotStart('2026-07-15', '14:00')), '2026-07-15 14:00:00');
});

test('addDays crosses months', () => {
  assert.equal(addDays('2026-07-31', 1), '2026-08-01');
  assert.equal(addDays('2026-08-01', -1), '2026-07-31');
});

test('overlaps and hours', () => {
  const a: [number, number] = [toMin('2026-07-15', '06:00'), toMin('2026-07-15', '10:00')];
  const b: [number, number] = [toMin('2026-07-15', '10:00'), toMin('2026-07-15', '14:00')];
  assert.equal(overlaps(a, b), false);           // touching ranges don't overlap
  assert.equal(overlaps(a, [a[0] + 60, a[1] + 60]), true);
  assert.equal(hours(a), 4);
});

test('fmtHM wraps past midnight', () => {
  assert.equal(fmtHM(toMin('2026-07-16', '02:30')), '02:30');
});
