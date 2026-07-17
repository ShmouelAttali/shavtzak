// persist() write-path behavior: future-day clash removal (daily missions
// extend past the day boundary) and lock handling at both levels.
import './env.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshSchema, seedSoldiers, soldierId, closePool, query } from './helpers.js';
import { generate, persist } from '../src/generate.js';
import { minToIso } from '../src/time.js';

const D1 = '2026-08-01', D2 = '2026-08-02';

before(async () => {
  await freshSchema();
  await seedSoldiers();
  await persist(await generate(D1));
});
after(closePool);

test('regenerating D removes only colliding unlocked future drafts; locked + non-colliding survive', async () => {
  // regenerate D1 in memory FIRST (so the fake D2 rows below don't distort
  // the generation inputs), then plant future-day rows before persisting
  const res = await generate(D1);
  const a = res.assignments.find((x) => x.source === 'auto' && x.blocksOverlap)!;
  const b = res.assignments.find((x) => x.source === 'auto' && x.blocksOverlap
    && x.soldierId !== a.soldierId)!;
  const other = res.assignments.find((x) => x.soldierId !== a.soldierId && x.soldierId !== b.soldierId)!;
  await query(`insert into schedule_days (day) values ($1) on conflict do nothing`, [D2]);
  const mkIso = minToIso;
  // colliding UNLOCKED draft row on D2 (overlaps a's period) — must be deleted
  await query(`insert into shift_assignments (day, position_id, soldier_id, period, source, blocks_overlap, locked)
               values ($1, 1, $2, tsrange($3::timestamp, $4::timestamp), 'auto', false, false)`,
    [D2, a.soldierId, mkIso(a.period[0]), mkIso(a.period[1])]);
  // colliding LOCKED row on D2 — must survive
  await query(`insert into shift_assignments (day, position_id, soldier_id, period, source, blocks_overlap, locked)
               values ($1, 1, $2, tsrange($3::timestamp, $4::timestamp), 'auto', false, true)`,
    [D2, b.soldierId, mkIso(b.period[0]), mkIso(b.period[1])]);
  // NON-colliding unlocked D2 draft row (starts well after D1's window) — survives
  await query(`insert into shift_assignments (day, position_id, soldier_id, period, source, blocks_overlap, locked)
               values ($1, 1, $2, tsrange(day_start($1) + interval '2 hours', day_start($1) + interval '6 hours'), 'auto', false, false)`,
    [D2, other.soldierId]);

  await persist(res);
  assert.ok(res.issues.some((i) => i.includes('הוסרו') && i.includes('מתנגשים')),
    JSON.stringify(res.issues));

  const d2rows = await query<{ soldier_id: string; locked: boolean }>(`
    select soldier_id::text, locked from shift_assignments where day = $1`, [D2]);
  assert.ok(!d2rows.some((r) => r.soldier_id === String(a.soldierId)),
    'colliding unlocked D2 row must be deleted');
  assert.ok(d2rows.some((r) => r.soldier_id === String(b.soldierId) && r.locked),
    'colliding LOCKED D2 row must survive');
  assert.ok(d2rows.some((r) => r.soldier_id === String(other.soldierId)),
    'non-colliding D2 row must survive');
  await query(`delete from shift_assignments where day = $1`, [D2]);
});

test('locked day_assignments row is honored by the generator (Level 1)', async () => {
  const D3 = '2026-08-03';
  const sid = await soldierId('חייל 50');
  await query(`insert into schedule_days (day) values ($1) on conflict do nothing`, [D3]);
  await query(`insert into day_assignments (day, soldier_id, position_id, source, locked)
               values ($1, $2, (select id from positions where name = 'תורנים'), 'manual', true)`, [D3, sid]);
  const res = await generate(D3);
  await persist(res);
  const toranim = await query<{ id: string }>(`select id::text from positions where name = 'תורנים'`);
  assert.equal(String(res.level1.get(sid)), toranim[0].id, 'locked Level-1 bucket honored in-memory');
  const bucket = await query<{ name: string; locked: boolean }>(`
    select p.name, da.locked from day_assignments da join positions p on p.id = da.position_id
    where da.day = $1 and da.soldier_id = $2`, [D3, sid]);
  assert.equal(bucket[0]?.name, 'תורנים');
  assert.equal(bucket[0]?.locked, true, 'locked row survives persist');
  // and Level 2 kept him inside his locked position
  const wrong = await query(`
    select 1 from shift_assignments sa join positions p on p.id = sa.position_id
    where sa.day = $1 and sa.soldier_id = $2 and p.name <> 'תורנים'`, [D3, sid]);
  assert.deepEqual(wrong, []);
});
