// T4 completion (owner rule 2026-07-18): when descending crew members go home,
// chained standbys (כונן גשש / כרמל חטיבה) are completed with fresh soldiers —
// preferring arrivals — instead of staying short. The validator downgrades
// out-of-crew completions to a warning when no available source member was
// left unused, and keeps the error when one was.
import './env.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshSchema, seedSoldiers, closePool, query } from './helpers.js';
import { generate, persist } from '../src/generate.js';
import { validateDay } from '../src/validate.js';
import { RationaleEntry } from '../src/rationale.js';

const D1 = '2026-08-01', D2 = '2026-08-02';

before(async () => {
  await freshSchema();
  await seedSoldiers();
  for (const d of [D1, D2]) await persist(await generate(d));
});
after(closePool);

test('גשש completion: whole descending crew leaves at 22:00 → a fresh soldier takes the night window', async () => {
  // the 22:00 גשש window sources the patrol crew that descended at 22:00
  // (patrol 14:00-22:00). Send that whole crew home from 22:00 on.
  const crew = await query<{ soldier_id: string }>(`
    select sa.soldier_id::text from shift_assignments sa
    join positions p on p.id = sa.position_id
    where p.name = 'סיור' and sa.day = $1 and lower(sa.period) = day_start($1)`, [D2]);
  assert.equal(crew.length, 4, 'patrol crew of 4');
  await query(`
    insert into unavailability (soldier_id, period, kind)
    select sid, tsrange(day_start($1) + interval '8 hours', day_start($1) + interval '24 hours'), 'יציאה'
    from unnest($2::bigint[]) sid`, [D2, crew.map((c) => c.soldier_id)]);

  await persist(await generate(D2));
  const gash = await query<{ soldier_id: string; rationale: RationaleEntry[] }>(`
    select sa.soldier_id::text, sa.rationale from shift_assignments sa
    join positions p on p.id = sa.position_id
    where p.name = 'כונן גשש' and sa.day = $1
      and lower(sa.period) = day_start($1) + interval '8 hours'`, [D2]);
  assert.equal(gash.length, 1, 'the 22:00 גשש window must be staffed');
  assert.ok(!crew.some((c) => c.soldier_id === gash[0].soldier_id),
    'the pick must be a completion — the whole crew is out');
  assert.ok(gash[0].rationale.some((e) => e.code === 'chain_completion'),
    JSON.stringify(gash[0].rationale));

  // validator: out-of-crew standby is a WARNING (no available member unused)
  const f = await validateDay(D2);
  const chain = f.filter((x) => x.rule === 'chain' && Number(x.soldierId) === Number(gash[0].soldier_id));
  assert.ok(chain.length >= 1, JSON.stringify(f.filter((x) => x.rule === 'chain')));
  for (const c of chain) assert.equal(c.severity, 'warning', JSON.stringify(c));

  await query(`delete from unavailability`);
  await persist(await generate(D2));   // restore a clean D2
});

test('chain error stays when an available source member was left unused', async () => {
  // hand-place an out-of-crew soldier on a carmel window whose source crew is
  // fully present → error, not warning
  const [outsider] = await query<{ id: string }>(`
    select s.id::text from soldiers s
    where s.is_schedulable and not exists (
      select 1 from shift_assignments sa where sa.soldier_id = s.id and sa.day = $1)
    limit 1`, [D2]);
  assert.ok(outsider, 'an unassigned soldier exists');
  const [slot] = await query<{ start: string }>(`
    select lower(sa.period)::text start from shift_assignments sa
    join positions p on p.id = sa.position_id
    where p.name = 'כרמל חטיבה' and sa.day = $1
    order by 1 limit 1`, [D2]);
  await query(`
    insert into shift_assignments (day, position_id, soldier_id, period, source, blocks_overlap)
    select $1, p.id, $2, tsrange($3::timestamp, $3::timestamp + interval '4 hours'), 'manual', false
    from positions p where p.name = 'כרמל חטיבה'`, [D2, outsider.id, slot.start]);

  const f = await validateDay(D2);
  const mine = f.filter((x) => x.rule === 'chain' && Number(x.soldierId) === Number(outsider.id));
  assert.ok(mine.some((x) => x.severity === 'error'), JSON.stringify(mine));
  await query(`delete from shift_assignments where soldier_id = $1 and day = $2 and source = 'manual'`,
    [outsider.id, D2]);
});
