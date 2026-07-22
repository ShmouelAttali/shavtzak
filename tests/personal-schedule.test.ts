// Regression test: findMissions used to sort a soldier's missions within a
// single day using a "h < 6 -> h + 24" offset, on the same wrong premise as
// the Shavtzak-tab bug (see tests/shavtzak-display.test.ts) — treating an
// early morning hour as if it belonged to a later, separate slot. The שבצק
// sheet's own date is always literal, so an early-morning mission is
// exactly that: earlier in the SAME day, sorting first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findMissions } from '../src/components/PersonalSchedule';
import type { ShavtzakData } from '../api/shavtzak';

function shavtzak(groups: ShavtzakData['groups']): ShavtzakData {
  return { date: '21/07/2026', groups };
}

test('findMissions sorts a soldier\'s missions within one day by literal hour, early morning first', () => {
  const day = shavtzak([
    { name: 'סיור', subTypes: [{ sug: 'סיור', times: [
      { time: '22:00', soldiers: ['דני'] },
      { time: '06:00', soldiers: ['דני'] },
      { time: '14:00', soldiers: ['דני'] },
    ] }] },
  ]);

  const missions = findMissions('דני', day);
  assert.deepEqual(missions.map(m => m.time), ['06:00', '14:00', '22:00']);
});
