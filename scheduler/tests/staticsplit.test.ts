// Static two-phase fill (level2): עמדות הגנה windows are manned in two
// phases — phase 1 sets the times (who mans each window, post-blind), phase 2
// spreads the picks over the concrete posts (sub_spread rationale). Focused
// world: defense grid only, exactly 12 fighters → every 4h window takes 4
// distinct soldiers on 4 distinct posts, and every row carries a sub_spread
// entry naming its actual post.
import './env.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshSchema, closePool, query } from './helpers.js';
import { generate, persist } from '../src/generate.js';
import { RationaleEntry } from '../src/rationale.js';

const D = '2026-08-01';

before(async () => {
  await freshSchema();
  await query(`update positions set is_scheduled = false
               where name not in ('עמדות הגנה', 'מנוחה', 'בבית')`);
  for (let i = 1; i <= 12; i++) {
    await query(`insert into soldiers (personal_number, full_name, platoon, role, rifle_level)
                 values ($1, $2, '1', 'לוחם', 3)`,
      [`S${String(i).padStart(2, '0')}`, `סטטי ${String(i).padStart(2, '0')}`]);
  }
  await persist(await generate(D));
});
after(closePool);

test('every defense row carries a sub_spread rationale naming its own post', async () => {
  const rows = await query<{ id: string; sub_name: string; rationale: RationaleEntry[] }>(`
    select sa.id::text, sp.name sub_name, sa.rationale
    from shift_assignments sa
    join positions p on p.id = sa.position_id
    join sub_positions sp on sp.id = sa.sub_position_id
    where sa.day = $1 and p.name = 'עמדות הגנה'`, [D]);
  assert.equal(rows.length, 24, '4 posts × 6 windows fully manned');
  for (const r of rows) {
    const spread = r.rationale.filter((e) => e.code === 'sub_spread');
    assert.equal(spread.length, 1, `row ${r.id}: exactly one sub_spread entry`);
    assert.equal(spread[0].params?.sub, r.sub_name,
      `row ${r.id}: sub_spread names the assigned post (${r.sub_name})`);
  }
});

test('each window: 4 distinct soldiers covering 4 distinct posts', async () => {
  const wins = await query<{ starts: string; n: string; soldiers: string; posts: string }>(`
    select lower(sa.period)::text starts, count(*) n,
           count(distinct sa.soldier_id) soldiers,
           count(distinct sa.sub_position_id) posts
    from shift_assignments sa join positions p on p.id = sa.position_id
    where sa.day = $1 and p.name = 'עמדות הגנה'
    group by 1 order by 1`, [D]);
  assert.equal(wins.length, 6, 'six 4h windows in the schedule day');
  for (const w of wins) {
    assert.equal(Number(w.n), 4, `${w.starts}: 4 rows`);
    assert.equal(Number(w.soldiers), 4, `${w.starts}: 4 distinct soldiers (H7)`);
    assert.equal(Number(w.posts), 4, `${w.starts}: 4 distinct posts`);
  }
});
