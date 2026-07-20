// Rules-overhaul coverage over a generated surplus world (60 soldiers,
// 3 warm-up days): flex seat sizing at surplus (מגן 12, סיור 4/shift),
// everyone-works (rest_bucket), the קצין מוצב candidate pool (H6-pool),
// the H6d tiger-driver rule on התקפי, and the התקפי platoon groups (P5).
import './env.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshSchema, seedSoldiers, closePool, query } from './helpers.js';
import { generate, persist } from '../src/generate.js';
import { validateDay } from '../src/validate.js';
import { RationaleEntry } from '../src/rationale.js';

const D1 = '2026-08-01', D2 = '2026-08-02', D3 = '2026-08-03';
const POOL = ['חייל 07', 'חייל 08', 'חייל 09', 'חייל 10'];
const issuesByDay = new Map<string, string[]>();

before(async () => {
  await freshSchema();
  await seedSoldiers();
  for (const d of [D1, D2, D3]) {
    const res = await generate(d);
    await persist(res);
    issuesByDay.set(d, res.issues);
  }
});
after(closePool);

test('flex surplus: מגן absorbs to its flex max (12) and every סיור shift runs 4 seats', async () => {
  const magen = await query<{ n: string }>(`
    select count(*) n from day_assignments da
    join positions p on p.id = da.position_id
    where da.day = $1 and p.name = 'מגן'`, [D3]);
  assert.equal(Number(magen[0].n), 12, 'מגן crew must be at the flex max');

  const patrol = await query<{ lo: string; n: string }>(`
    select lower(sa.period)::text lo, count(*) n
    from shift_assignments sa join positions p on p.id = sa.position_id
    where sa.day = $1 and p.name = 'סיור' group by 1 order by 1`, [D3]);
  assert.equal(patrol.length, 3, 'three patrol shifts exist');
  for (const r of patrol) assert.equal(Number(r.n), 4, `patrol ${r.lo}: expected 4 seats filled`);
});

test('everyone works: מנוחה only beyond מגן flex max, one rest_bucket warning each', async () => {
  const resting = await query<{ soldier_id: number }>(`
    select da.soldier_id from day_assignments da
    join positions p on p.id = da.position_id
    where da.day = $1 and p.name = 'מנוחה'`, [D3]);
  // surplus fixture: 60 soldiers, ~47 assigned — the overflow rests only
  // because מגן is already full at 12
  assert.ok(resting.length > 0, 'surplus fixture must have a מנוחה overflow');
  const magen = await query<{ n: string }>(`
    select count(*) n from day_assignments da
    join positions p on p.id = da.position_id
    where da.day = $1 and p.name = 'מגן'`, [D3]);
  assert.equal(Number(magen[0].n), 12, 'no one may rest while מגן is below its flex max');

  const findings = await validateDay(D3);
  const bucket = findings.filter((f) => f.rule === 'rest_bucket');
  for (const f of bucket) assert.equal(f.severity, 'warning');
  const warned = bucket.map((f) => Number(f.soldierId)).sort((a, b) => a - b);
  const rested = resting.map((r) => Number(r.soldier_id)).sort((a, b) => a - b);
  assert.deepEqual(warned, rested, 'exactly one rest_bucket warning per מנוחה soldier');
  // and the generator itself flagged each of them
  const issues = issuesByDay.get(D3)!;
  assert.equal(issues.filter((i) => i.includes('נותר במנוחה')).length, rested.length);
});

test('קצין מוצב pool (H6-pool): manned only from the list, members rotate and serve elsewhere', async () => {
  for (const d of [D1, D2, D3]) {
    const rows = await query<{ full_name: string }>(`
      select s.full_name from day_assignments da
      join positions p on p.id = da.position_id
      join soldiers s on s.id = da.soldier_id
      where da.day = $1 and p.name = 'קצין מוצב'`, [d]);
    assert.equal(rows.length, 1, `day ${d}: קצין מוצב seat filled`);
    assert.ok(POOL.includes(rows[0].full_name), `day ${d}: ${rows[0].full_name} not in pool`);
  }
  // no generation complaints about the position
  assert.ok(!issuesByDay.get(D3)!.some((i) => i.includes('קצין מוצב')),
    JSON.stringify(issuesByDay.get(D3)));
  // NON-exclusivity: unpicked pool members serve in other real positions
  const elsewhere = await query<{ full_name: string; name: string }>(`
    select s.full_name, p.name from day_assignments da
    join positions p on p.id = da.position_id
    join soldiers s on s.id = da.soldier_id
    where da.day = $1 and s.full_name = any($2)
      and p.name not in ('קצין מוצב', 'מנוחה', 'בבית')`, [D3, POOL]);
  assert.ok(elsewhere.length >= 1,
    'at least one unpicked pool member must hold another position');
});

test('H6d: התקפי crew includes a נהג טיגריס', async () => {
  const rows = await query<{ n: string }>(`
    select count(*) n from day_assignments da
    join positions p on p.id = da.position_id
    join soldiers s on s.id = da.soldier_id
    where da.day = $1 and p.name = 'התקפי' and s.full_name in ('חייל 13', 'חייל 14')`, [D3]);
  assert.ok(Number(rows[0].n) >= 1, 'התקפי crew must carry a qualified tiger driver');
});

test('התקפי groups: two commanders lead the 8-man crew, members join by platoon_group', async () => {
  const crew = await query<{ full_name: string; role: string; rationale: RationaleEntry[] }>(`
    select s.full_name, s.role, sa.rationale
    from shift_assignments sa join positions p on p.id = sa.position_id
    join soldiers s on s.id = sa.soldier_id
    where sa.day = $1 and p.name = 'התקפי'`, [D3]);
  assert.equal(crew.length, 8, 'standing התקפי crew is 8');
  const commanders = crew.filter((r) => ['מ"כ', 'סמל', 'מ"מ'].includes(r.role));
  assert.ok(commanders.length >= 2,
    `group_size 4 over 8 seats needs 2 commanders, got ${commanders.length}`);
  assert.ok(crew.some((r) => r.rationale.some((e) => e.code === 'platoon_group')),
    'some crew member must carry a platoon_group rationale');
});
