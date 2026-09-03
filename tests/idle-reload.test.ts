// The pure decision behind the 15-minute idle reload (src/lib/idleReload.ts):
// only when the idle threshold has actually passed, only while the screen is
// being looked at, and never over unsaved edits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldIdleReload } from '../src/lib/idleReload';

const MIN = 60_000;
const T0 = 1_700_000_000_000;
const at = (minutesIdle: number, over: Partial<Parameters<typeof shouldIdleReload>[0]> = {}) =>
  shouldIdleReload({
    now: T0 + minutesIdle * MIN, lastActive: T0, idleMs: 15 * MIN,
    hidden: false, canReload: true, ...over,
  });

test('reloads only once the idle threshold has passed', () => {
  assert.equal(at(0), false);
  assert.equal(at(14.9), false);
  assert.equal(at(15), true);      // exactly at the threshold counts as idle
  assert.equal(at(60), true);
});

test('a hidden tab never reloads — it waits until it is looked at again', () => {
  assert.equal(at(60, { hidden: true }), false);
  assert.equal(at(60, { hidden: false }), true);
});

test('unsaved edits veto the reload, at any idle length', () => {
  assert.equal(at(15, { canReload: false }), false);
  assert.equal(at(600, { canReload: false }), false);
});

test('the veto does not consume the idle state — the next check still reloads', () => {
  // same lastActive: a vetoed check must not look like activity
  assert.equal(at(20, { canReload: false }), false);
  assert.equal(at(20.5, { canReload: true }), true);
});

test('activity resets the clock: idle is measured from lastActive, not from load', () => {
  const now = T0 + 100 * MIN;
  assert.equal(shouldIdleReload({ now, lastActive: now - 14 * MIN, idleMs: 15 * MIN, hidden: false, canReload: true }), false);
  assert.equal(shouldIdleReload({ now, lastActive: now - 16 * MIN, idleMs: 15 * MIN, hidden: false, canReload: true }), true);
});

test('a device that slept past the threshold reloads on the first check after waking', () => {
  // the poll never ran for an hour; the timestamp comparison still says idle
  assert.equal(shouldIdleReload({ now: T0 + 120 * MIN, lastActive: T0, idleMs: 15 * MIN, hidden: false, canReload: true }), true);
});

test('a clock that jumps backwards does not reload', () => {
  assert.equal(shouldIdleReload({ now: T0 - 5 * MIN, lastActive: T0, idleMs: 15 * MIN, hidden: false, canReload: true }), false);
});
