// Closed-list-first ordering (owner decision 2026-07-19): a candidate_pool
// position (קצין מוצב) is staffed BEFORE the מגן-commander reservation can
// consume its members. Two scenarios over generated days:
//  - pool has other available members → the configured מגן commander stays
//    on מגן (he is the pool's last resort);
//  - the configured מגן commander is the ONLY available pool member → he goes
//    to קצין מוצב, and מגן emits the substitute-commander issue.
import './env.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshSchema, seedSoldiers, soldierId, closePool, query } from './helpers.js';
import { generate, persist } from '../src/generate.js';
import { GenerateResult } from '../src/model.js';
import { RationaleEntry } from '../src/rationale.js';

const D1 = '2026-08-10', D2 = '2026-08-11';
// helpers.ts remaps the קצין מוצב candidate_pool to חייל 07–10; the weekly
// מגן commander decision names a pool member on purpose (the conflict case).
const CMD = 'חייל 07';
const OTHER_POOL = ['חייל 08', 'חייל 09', 'חייל 10'];

let res1: GenerateResult, res2: GenerateResult;

before(async () => {
  await freshSchema();
  await seedSoldiers();
  await query(`insert into config (key, value) values ('magen_commander', $1::jsonb)`,
    [JSON.stringify(CMD)]);
  res1 = await generate(D1);
  await persist(res1);
  // D2: every pool member except the מגן commander is home all day
  for (const n of OTHER_POOL) {
    await query(`insert into unavailability (soldier_id, period, kind)
                 values ($1, tsrange(day_start($2), day_start($2) + interval '1 day'), 'חופש')`,
      [await soldierId(n), D2]);
  }
  res2 = await generate(D2);
  await persist(res2);
});
after(async () => {
  await query(`delete from config where key = 'magen_commander'`);
  await closePool();
});

async function holder(day: string, position: string) {
  return query<{ full_name: string; rationale: RationaleEntry[] }>(`
    select s.full_name, sa.rationale
    from shift_assignments sa
    join positions p on p.id = sa.position_id
    join soldiers s on s.id = sa.soldier_id
    where sa.day = $1 and p.name = $2`, [day, position]);
}

test('pool has alternatives: מגן keeps its configured commander, קצין מוצב staffed from the rest', async () => {
  const officer = await holder(D1, 'קצין מוצב');
  assert.equal(officer.length, 1, 'קצין מוצב is staffed');
  assert.ok(OTHER_POOL.includes(officer[0].full_name),
    `pool pick must skip the מגן commander when others are free: ${officer[0].full_name}`);
  assert.ok(officer[0].rationale.some((e) => e.code === 'candidate_pool'),
    JSON.stringify(officer[0].rationale));
  const magen = await holder(D1, 'מגן');
  const cmd = magen.find((r) => r.full_name === CMD);
  assert.ok(cmd, 'configured commander leads מגן');
  assert.ok(cmd!.rationale.some((e) => e.code === 'magen_commander'), JSON.stringify(cmd!.rationale));
  assert.ok(!res1.issues.some((i) => i.includes('נדרש מפקד מגן חלופי')), res1.issues.join(' | '));
});

test('only pool member = מגן commander: he mans קצין מוצב and מגן flags the substitute need', async () => {
  const officer = await holder(D2, 'קצין מוצב');
  assert.equal(officer.length, 1, 'קצין מוצב is staffed');
  assert.equal(officer[0].full_name, CMD, 'the closed list wins the conflict');
  assert.ok(officer[0].rationale.some((e) => e.code === 'candidate_pool'),
    JSON.stringify(officer[0].rationale));
  const magen = await holder(D2, 'מגן');
  assert.ok(!magen.some((r) => r.full_name === CMD), 'he cannot also be on מגן (H4)');
  assert.ok(res2.issues.some((i) =>
    i.includes('מגן') && i.includes(CMD) && i.includes('שובץ לקצין מוצב')
    && i.includes('נדרש מפקד מגן חלופי')), res2.issues.join(' | '));
});
