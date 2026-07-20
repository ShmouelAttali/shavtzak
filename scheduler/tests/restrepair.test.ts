// Post-fill short-rest repair (owner 2026-07-20): a <8h gap between two of a
// soldier's same-day shifts is acceptable only when unavoidable. With a clean
// 12-man crew on the עמדות הגנה grid (24 seat-windows × 4h = two 4h shifts
// each), a perfect 8h-spaced assignment exists — after fill + repair, NO
// soldier may end the day with a short intra-day gap.
import './env.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshSchema, closePool, query } from './helpers.js';
import { generate, persist } from '../src/generate.js';

const D = '2026-08-11';

before(async () => {
  await freshSchema();
  // only the static grid is scheduled; exactly 12 fresh identical soldiers
  await query(`update positions set is_scheduled = false where name <> 'עמדות הגנה'`);
  await query(`insert into soldiers (personal_number, full_name, platoon, role, rifle_level)
               select 'R' || i, 'חייל ' || i, (i % 3 + 1)::text, 'לוחם', 3
               from generate_series(1, 12) i`);
  await persist(await generate(D));
});
after(closePool);

test('static grid, exact headcount: nobody ends the day with a <8h intra-day gap', async () => {
  const gaps = await query<{ full_name: string; gap_h: number }>(`
    with w as (
      select sa.soldier_id, s.full_name, sa.period
      from shift_assignments sa
      join soldiers s on s.id = sa.soldier_id
      join positions p on p.id = sa.position_id
      where sa.day = $1 and p.mission_class = 'static')
    select a.full_name, extract(epoch from (lower(b.period) - upper(a.period))) / 3600 gap_h
    from w a join w b on b.soldier_id = a.soldier_id and lower(b.period) >= upper(a.period)
    where lower(b.period) - upper(a.period) < interval '8 hours'`, [D]);
  assert.deepEqual(gaps, [], JSON.stringify(gaps));
});

test('every seat of the grid is covered (the repair never drops coverage)', async () => {
  const [{ n }] = await query<{ n: string }>(`
    select count(*) n from shift_assignments sa
    join positions p on p.id = sa.position_id
    where sa.day = $1 and p.name = 'עמדות הגנה'`, [D]);
  assert.equal(Number(n), 24, `covered ${n}/24 seat-windows`);
});
