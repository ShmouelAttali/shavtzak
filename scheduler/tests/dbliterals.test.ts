// litDate(): the point-of-use guard on every date interpolated into a
// multiQuery batch (the simple query protocol takes no bind parameters).
import './env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { litDate } from '../src/db.js';

test('litDate quotes a plain ISO date', () => {
  assert.equal(litDate('2026-07-26'), `'2026-07-26'`);
});

test('litDate throws on anything that is not exactly YYYY-MM-DD', () => {
  for (const bad of [
    `2026-07-26'; drop table soldiers; --`,
    '2026-7-6', '2026-07-26 14:00', ' 2026-07-26', '2026-07-26\n', '', 'today',
  ]) {
    assert.throws(() => litDate(bad), /bad date literal/, `accepted ${JSON.stringify(bad)}`);
  }
});
