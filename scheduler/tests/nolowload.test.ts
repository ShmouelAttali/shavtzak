// Task 4a: weekly load must not influence group composition, and the
// misleading "low weekly load in the group" (low_load) pick rationale is no
// longer emitted. This integration test generates a full day and asserts no
// assignment carries a low_load rationale entry. (The static group-cascade
// neutrality is proven separately in grouploadneutral.test.ts.)
import './env.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshSchema, seedSoldiers, closePool, query } from './helpers.js';
import { generate, persist } from '../src/generate.js';

const D = '2026-08-05';

before(async () => {
  await freshSchema();
  await seedSoldiers();
  await persist(await generate(D));
});
after(closePool);

test('no generated assignment carries a low_load rationale', async () => {
  const rows = await query<{ rationale: { code: string }[] }>(
    `select rationale from shift_assignments where day = $1 and source in ('auto','chain')`, [D]);
  assert.ok(rows.length > 0, 'the day generated some assignments');
  const offenders = rows.filter((r) => (r.rationale ?? []).some((e) => e.code === 'low_load'));
  assert.equal(offenders.length, 0,
    `low_load rationale must not be emitted (found ${offenders.length})`);
});
