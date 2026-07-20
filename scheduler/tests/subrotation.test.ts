// Sub-position rotation: within one schedule day a soldier's second
// עמדות הגנה shift goes to a DIFFERENT post. The mechanism is the static
// two-phase fill (level2): phase 1 picks the window's soldiers post-blind,
// phase 2 hands them to posts purely by even spread — fewest prior shifts
// today on that post — so a repeat post is never chosen while a fresh one
// exists. Tested in a focused world (defense grid only, exactly 12 fighters
// → 24 post-shifts, 2 each).
import './env.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshSchema, closePool, query } from './helpers.js';
import { generate, persist } from '../src/generate.js';

const D = '2026-08-01';

before(async () => {
  await freshSchema();
  await query(`update positions set is_scheduled = false
               where name not in ('עמדות הגנה', 'מנוחה', 'בבית')`);
  for (let i = 1; i <= 12; i++) {
    await query(`insert into soldiers (personal_number, full_name, platoon, role, rifle_level)
                 values ($1, $2, '1', 'לוחם', 3)`,
      [`P${String(i).padStart(2, '0')}`, `לוחם ${String(i).padStart(2, '0')}`]);
  }
  await persist(await generate(D));
});
after(closePool);

test('sub rotation: no soldier mans the same defense post twice within the schedule day', async () => {
  const perSoldier = await query<{ soldier_id: number; n: string; subs: string }>(`
    select sa.soldier_id, count(*) n, count(distinct sa.sub_position_id) subs
    from shift_assignments sa join positions p on p.id = sa.position_id
    where sa.day = $1 and p.name = 'עמדות הגנה'
    group by 1`, [D]);
  assert.equal(perSoldier.length, 12, 'all 12 fighters man the grid');
  for (const r of perSoldier) {
    assert.equal(Number(r.n), 2, `soldier ${r.soldier_id}: 24 post-shifts / 12 men = 2 each`);
    assert.equal(Number(r.subs), 2,
      `soldier ${r.soldier_id}: second shift must rotate to a different post (phase-2 spread)`);
  }
});
