// seat_overrides time scoping (2026-07-19): valid_to is an EXCLUSIVE end
// compared against the slot's concrete period START; start_time targets one
// template shift (null = position-wide); seats = 0 CANCELS the matched slots
// (day_slots omits them, so the generator redistributes and the validator
// raises no coverage gap); resolution = start_time match > latest valid_from
// > highest id; unique nulls not distinct (position_id, valid_from, start_time).
//
// סיור fixture (seed.sql): 3 shifts × 8h × 4 seats at 06:00 / 14:00 / 22:00 —
// within schedule day D (14:00→14:00) they start at D 14:00, D 22:00 and
// D+1 06:00 (the 06:00 shift lands on the next calendar morning).
import './env.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshSchema, seedSoldiers, closePool, query } from './helpers.js';
import { generate, persist } from '../src/generate.js';
import { validateDay } from '../src/validate.js';

const D1 = '2026-10-05', D2 = '2026-10-06', D3 = '2026-10-07'; // pure-SQL days
const W = '2026-10-09', G = '2026-10-10';                       // generator days

const patrol = `(select id from positions where name = 'סיור')`;

async function addOverride(o: {
  from: string; to?: string | null; start?: string | null; seats: number;
}): Promise<void> {
  await query(`
    insert into seat_overrides (position_id, valid_from, valid_to, start_time, seats, note)
    values (${patrol}, $1, $2, $3, $4, 'test')`,
    [o.from, o.to ?? null, o.start ?? null, o.seats]);
}

async function clearOverrides(): Promise<void> {
  await query(`delete from seat_overrides where note = 'test'`);
}

/** סיור slots of one schedule day, ordered by concrete start. */
async function patrolSlots(day: string): Promise<{ lo: string; seats: number }[]> {
  return query<{ lo: string; seats: number }>(`
    select lower(ds.period)::text lo, ds.seats from day_slots ds
    where ds.position_id = ${patrol} and ds.day = $1
    order by lower(ds.period)`, [day]);
}

before(async () => {
  await freshSchema();
  await seedSoldiers();
  // seed.sql's חפק seat rules name real soldiers — remap to synthetic ones so
  // generated days are fully staffable (mirrors generator.test.ts)
  await query(`update soldiers set role = 'מ"פ' where full_name = 'חייל 55'`);
  await query(`update positions set config = config || $1::jsonb where name = 'חפק'`, [JSON.stringify({
    seat_rules: [
      { sub: 'מפקד', roles: ['מ"פ'], commander: true },
      { sub: 'קשר', soldiers: ['חייל 20', 'חייל 21'], ordered: true, release_unpicked: true },
      { sub: 'חובש', soldiers: ['חייל 23', 'חייל 24'] },
      { sub: 'נהג', soldiers: ['חייל 25', 'חייל 26'] },
    ],
  })]);
  // pure-SQL day_slots tests need the schedule days to exist (no generation)
  await query(`insert into schedule_days (day) values ($1), ($2), ($3) on conflict do nothing`,
    [D1, D2, D3]);
});
after(closePool);

// ── 1: day_slots pure-SQL semantics ─────────────────────────────────────────

test('start_time-specific seats=0 bounded to one day cancels only that slot on that day', async () => {
  // schedule day D1 only: valid_to = day_start(D1+1) = D2 14:00 (exclusive)
  await addOverride({ from: D1, to: `${D2} 14:00`, start: '22:00', seats: 0 });

  const d1 = await patrolSlots(D1);
  assert.equal(d1.length, 2, `22:00 slot must be omitted: ${JSON.stringify(d1)}`);
  assert.ok(d1[0].lo.includes('2026-10-05 14:00'), d1[0].lo);
  assert.ok(d1[1].lo.includes('2026-10-06 06:00'), d1[1].lo);   // next-morning slot untouched
  for (const s of d1) assert.equal(Number(s.seats), 4, 'sibling slots keep template seats');

  // the day after: 22:00 slot starts D2 22:00 >= valid_to → back with normal seats
  const d2 = await patrolSlots(D2);
  assert.equal(d2.length, 3, JSON.stringify(d2));
  const night = d2.find((s) => s.lo.includes('2026-10-06 22:00'));
  assert.ok(night, `22:00 slot must return on ${D2}: ${JSON.stringify(d2)}`);
  assert.equal(Number(night!.seats), 4);

  await clearOverrides();
});

test('position-wide seats=0 bounded to one schedule day cancels all its slots incl. the next-morning 06:00', async () => {
  // the 06:00 slot of D1 starts D2 06:00 — still < valid_to (D2 14:00), so a
  // day-bounded position-wide cancellation must catch it too
  await addOverride({ from: D1, to: `${D2} 14:00`, seats: 0 });
  assert.deepEqual(await patrolSlots(D1), []);
  const d2 = await patrolSlots(D2);
  assert.equal(d2.length, 3, JSON.stringify(d2));
  for (const s of d2) assert.equal(Number(s.seats), 4);
  await clearOverrides();
});

// ── 2: specificity ───────────────────────────────────────────────────────────

test('start_time-specific override beats a position-wide one active on the same day', async () => {
  await addOverride({ from: D1, seats: 2 });                    // position-wide
  await addOverride({ from: D1, start: '14:00', seats: 5 });    // specific
  const d1 = await patrolSlots(D1);
  assert.equal(d1.length, 3, JSON.stringify(d1));
  const bySlot = new Map(d1.map((s) => [s.lo.slice(11, 16), Number(s.seats)]));
  assert.equal(bySlot.get('14:00'), 5, 'specific override wins its slot');
  assert.equal(bySlot.get('22:00'), 2, 'position-wide applies to the rest');
  assert.equal(bySlot.get('06:00'), 2, 'position-wide applies to the rest');
  await clearOverrides();
});

test('same specificity: the latest valid_from wins', async () => {
  await addOverride({ from: D1, seats: 2 });
  await addOverride({ from: D2, seats: 3 });
  for (const s of await patrolSlots(D1)) assert.equal(Number(s.seats), 2);
  for (const s of await patrolSlots(D2)) assert.equal(Number(s.seats), 3);
  await clearOverrides();
});

// ── 3: legacy behavior unchanged ────────────────────────────────────────────

test('legacy row (position_id, valid_from, seats) applies to all slots from that day onward', async () => {
  await addOverride({ from: D2, seats: 3 });
  const before = await patrolSlots(D1);
  assert.equal(before.length, 3);
  for (const s of before) assert.equal(Number(s.seats), 4, 'day before valid_from unaffected');
  for (const day of [D2, D3]) {
    const slots = await patrolSlots(day);
    assert.equal(slots.length, 3, `${day}: ${JSON.stringify(slots)}`);
    for (const s of slots) assert.equal(Number(s.seats), 3, `${day}: open-ended override applies`);
  }
  await clearOverrides();
});

// ── 4: generator end-to-end ─────────────────────────────────────────────────

test('generator skips a cancelled סיור shift, redistributes, and the validator reports no coverage gap for it', async () => {
  // cancel the 22:00 סיור shift of schedule day G only
  await addOverride({ from: G, to: '2026-10-11 14:00', start: '22:00', seats: 0 });
  await persist(await generate(W));   // warm-up day (override does not apply)
  await persist(await generate(G));

  const inWindow = async (from: string, to: string) => Number((await query<{ n: string }>(`
    select count(*) n from shift_assignments sa
    where sa.position_id = ${patrol} and sa.day = $1
      and sa.period && tsrange($2::timestamp, $3::timestamp)`, [G, from, to]))[0].n);

  // no סיור rows touch the cancelled 22:00-06:00 window
  assert.equal(await inWindow('2026-10-10 22:00', '2026-10-11 06:00'), 0,
    'cancelled window must be empty');
  // the two surviving shifts are staffed (>= flex min 3)
  assert.ok(await inWindow('2026-10-10 14:00', '2026-10-10 22:00') >= 3, '14:00 shift staffed');
  assert.ok(await inWindow('2026-10-11 06:00', '2026-10-11 14:00') >= 3, '06:00 shift staffed');
  // warm-up day W was NOT affected: its 22:00 shift exists as usual
  const wNight = Number((await query<{ n: string }>(`
    select count(*) n from shift_assignments sa
    where sa.position_id = ${patrol} and sa.day = $1
      and sa.period && tsrange('2026-10-09 22:00'::timestamp, '2026-10-10 06:00'::timestamp)`,
    [W]))[0].n);
  assert.ok(wNight >= 3, `warm-up day keeps its 22:00 shift (got ${wNight})`);

  // the day still generates — everyone-works redistributes the freed crew
  const assigned = await query<{ n: string }>(
    `select count(*) n from day_assignments where day = $1`, [G]);
  assert.ok(Number(assigned[0].n) > 0, 'day generated');

  // validator: the cancelled slot is not a coverage gap (it is not demand at all)
  const findings = await validateDay(G);
  const patrolCoverage = findings.filter((f) => f.rule === 'coverage' && f.message.includes('סיור'));
  assert.deepEqual(patrolCoverage, [], JSON.stringify(patrolCoverage));

  await clearOverrides();
});

// ── 5: constraints ──────────────────────────────────────────────────────────

test('duplicate (position_id, valid_from, start_time=null) rejected — unique nulls not distinct', async () => {
  await addOverride({ from: '2026-11-01', seats: 6 });
  await assert.rejects(
    addOverride({ from: '2026-11-01', seats: 7 }),
    /duplicate key value/);
  await clearOverrides();
});

test('negative seats rejected by check (seats >= 0)', async () => {
  await assert.rejects(
    addOverride({ from: '2026-11-01', seats: -1 }),
    /check constraint|violates/);
});
