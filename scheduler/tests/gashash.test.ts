// R3 כונן גשש: (1) a גשש night window counts as gashash_effective_hours of
// effective work in rest checks; (2) night-window chain selection prefers
// crew members who slept the previous night, then lowest tracker hours.
import './env.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshSchema, seedSoldiers, soldierId, closePool, query } from './helpers.js';
import { trackerPickOrder } from '../src/generate.js';
import { validateDay } from '../src/validate.js';

const D = '2026-09-01';

before(async () => {
  await freshSchema();
  await seedSoldiers();
  await query(`insert into schedule_days (day) values ($1)`, [D]);
});
after(closePool);

async function gashashNight(name: string) {
  const sid = await soldierId(name);
  // seat_index auto-increments — the tests plant the SAME night window for
  // several soldiers, and the seat uniqueness index rejects a shared seat
  await query(`
    insert into shift_assignments (day, position_id, soldier_id, period, source, blocks_overlap, seat_index)
    select $1, p.id, $2,
           tsrange('2026-09-01 22:00'::timestamp, '2026-09-02 07:00'::timestamp), 'manual', false,
           coalesce((select max(sa.seat_index) + 1 from shift_assignments sa
                     where sa.day = $1 and sa.position_id = p.id
                       and sa.period = tsrange('2026-09-01 22:00'::timestamp, '2026-09-02 07:00'::timestamp)), 1)
    from positions p where p.name = 'כונן גשש'`,
    [D, sid]);
  return sid;
}

test('R3: task at 07:00 after a גשש night → short-rest warning (gap from 23:30)', async () => {
  const sid = await gashashNight('חייל 30');
  await query(`
    insert into shift_assignments (day, position_id, soldier_id, period, source)
    values ($1, (select id from positions where name = 'עמדות הגנה'), $2,
            tsrange('2026-09-02 07:00'::timestamp, '2026-09-02 11:00'::timestamp), 'manual')`, [D, sid]);
  const f = await validateDay(D);
  assert.ok(f.some((x) => x.rule === 'rest' && x.severity === 'warning'
    && x.message.includes('חייל 30')), JSON.stringify(f.filter((x) => x.rule === 'rest')));
});

test('R3 negative: task at 08:00 after a גשש night → 8.5h effective rest, no finding', async () => {
  const sid = await gashashNight('חייל 31');
  await query(`
    insert into shift_assignments (day, position_id, soldier_id, period, source)
    values ($1, (select id from positions where name = 'עמדות הגנה'), $2,
            tsrange('2026-09-02 08:00'::timestamp, '2026-09-02 12:00'::timestamp), 'manual')`, [D, sid]);
  const f = await validateDay(D);
  assert.ok(!f.some((x) => x.rule === 'rest' && x.message.includes('חייל 31')),
    JSON.stringify(f.filter((x) => x.rule === 'rest')));
});

test('R3: non-night גשש windows stay fully rest-transparent (R2)', async () => {
  const sid = await gashashNight('חייל 32');
  // replace with the 14:00-22:00 window (no night overlap) + a task 1h later
  await query(`update shift_assignments
               set period = tsrange('2026-09-01 14:00'::timestamp, '2026-09-01 22:00'::timestamp)
               where soldier_id = $1`, [sid]);
  await query(`
    insert into shift_assignments (day, position_id, soldier_id, period, source)
    values ($1, (select id from positions where name = 'עמדות הגנה'), $2,
            tsrange('2026-09-01 23:00'::timestamp, '2026-09-02 03:00'::timestamp), 'manual')`, [D, sid]);
  const f = await validateDay(D);
  assert.ok(!f.some((x) => x.rule === 'rest' && x.message.includes('חייל 32')),
    JSON.stringify(f.filter((x) => x.rule === 'rest')));
});

// ── T4c pick ordering (pure) ─────────────────────────────────────────────────
type C = { name: string; slept: boolean; trackerH: number; fair: number };
const order = (pool: C[], nightWindow: boolean) => trackerPickOrder(pool, {
  nightWindow, slept: (c) => c.slept, trackerH: (c) => c.trackerH, fairIndex: (c) => c.fair,
}).map((c) => c.name);

test('T4c night window: a member who slept beats a lower-tracker member who did not', () => {
  const pool: C[] = [
    { name: 'up-all-night', slept: false, trackerH: 0, fair: 0 },
    { name: 'slept', slept: true, trackerH: 9, fair: 1 },
  ];
  assert.deepEqual(order(pool, true)[0], 'slept');
});

test('T4c night window: among slept members, lowest tracker hours wins; fairness breaks ties', () => {
  const pool: C[] = [
    { name: 'c', slept: true, trackerH: 9, fair: 0 },
    { name: 'a', slept: true, trackerH: 2, fair: 1 },
    { name: 'b', slept: true, trackerH: 2, fair: 0 },
  ];
  assert.deepEqual(order(pool, true), ['b', 'a', 'c']);
});

test('T4c day windows ignore the slept key (tracker hours decide)', () => {
  const pool: C[] = [
    { name: 'slept-high-tracker', slept: true, trackerH: 9, fair: 0 },
    { name: 'tired-low-tracker', slept: false, trackerH: 0, fair: 1 },
  ];
  assert.deepEqual(order(pool, false)[0], 'tired-low-tracker');
});
