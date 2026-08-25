// Unit tests for the יציאות לזמן קצר helpers (src/lib/shortExits.ts): the
// always-show-the-date formatting with its אתמול/היום/מחר note, and the
// planned/out/late state that drives both the late highlight and the
// "כרגע ביציאה קצרה" counter.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseSheetDateTime, relativeDayLabel, fmtExitDateTime, exitState, countCurrentlyOut,
} from '../src/lib/shortExits';

const NOW = new Date(2026, 7, 19, 12, 0); // 19/08/26 12:00

test('parseSheetDateTime reads the sheet format, two- or four-digit year', () => {
  assert.deepEqual(parseSheetDateTime('18/08/26 22:00'), new Date(2026, 7, 18, 22, 0));
  assert.deepEqual(parseSheetDateTime('1/8/2026 9:05'), new Date(2026, 7, 1, 9, 5));
  assert.equal(parseSheetDateTime(''), null);
  assert.equal(parseSheetDateTime('18/08/26'), null);
});

test('relativeDayLabel covers only the three adjacent days', () => {
  assert.equal(relativeDayLabel(new Date(2026, 7, 19, 0, 30), NOW), 'היום');
  assert.equal(relativeDayLabel(new Date(2026, 7, 18, 23, 59), NOW), 'אתמול');
  assert.equal(relativeDayLabel(new Date(2026, 7, 20, 6, 0), NOW), 'מחר');
  assert.equal(relativeDayLabel(new Date(2026, 7, 21, 6, 0), NOW), null);
  assert.equal(relativeDayLabel(new Date(2026, 7, 17, 6, 0), NOW), null);
});

test('fmtExitDateTime always shows the date, today included', () => {
  assert.equal(fmtExitDateTime('19/08/26 14:30', NOW), '14:30 • 19/08 (היום)');
  assert.equal(fmtExitDateTime('18/08/26 22:00', NOW), '22:00 • 18/08 (אתמול)');
  assert.equal(fmtExitDateTime('20/08/26 13:30', NOW), '13:30 • 20/08 (מחר)');
  assert.equal(fmtExitDateTime('25/08/26 08:00', NOW), '08:00 • 25/08');
});

test('fmtExitDateTime passes through what it cannot parse', () => {
  assert.equal(fmtExitDateTime('', NOW), '—');
  assert.equal(fmtExitDateTime('אחרי הצהריים', NOW), 'אחרי הצהריים');
});

test('exitState distinguishes planned, out and overdue', () => {
  const at = (exitTime: string, returnTime: string) => exitState({ exitTime, returnTime }, NOW);
  assert.equal(at('19/08/26 18:00', '19/08/26 22:00'), 'planned');
  assert.equal(at('19/08/26 10:00', '19/08/26 16:00'), 'out');
  assert.equal(at('18/08/26 22:00', '19/08/26 09:00'), 'late');
  // Due exactly now is not yet late
  assert.equal(at('19/08/26 08:00', '19/08/26 12:00'), 'out');
});

test('exitState treats a missing זמן חזרה as open-ended and a missing יציאה as already out', () => {
  assert.equal(exitState({ exitTime: '18/08/26 22:00', returnTime: '' }, NOW), 'out');
  assert.equal(exitState({ exitTime: '', returnTime: '' }, NOW), 'out');
  assert.equal(exitState({ exitTime: '', returnTime: '19/08/26 09:00' }, NOW), 'late');
});

test('countCurrentlyOut skips planned exits and keeps overdue ones', () => {
  const exits = [
    { exitTime: '19/08/26 18:00', returnTime: '19/08/26 22:00' }, // planned
    { exitTime: '19/08/26 10:00', returnTime: '19/08/26 16:00' }, // out
    { exitTime: '18/08/26 22:00', returnTime: '19/08/26 09:00' }, // late
  ];
  assert.equal(countCurrentlyOut(exits, NOW), 2);
  assert.equal(countCurrentlyOut([], NOW), 0);
});
