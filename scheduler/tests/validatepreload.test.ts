// validateDay(day, preloaded): handing the validator the day-independent rows
// load.ts already fetched drops those statements from its batch. It must not
// change a single finding, and the seat-rule position subset (previously its
// own `where config ? 'seat_rules'` query) must be derived from the same rows.
import './env.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshSchema, seedSoldiers, addCandidates, closePool, query } from './helpers.js';
import { validateDay } from '../src/validate.js';
import { generate, persist } from '../src/generate.js';
import { loadStatic } from '../src/load.js';

const D = '2026-09-14';

before(async () => {
  await freshSchema();
  await seedSoldiers();
  // חפק is the seat-rule position (H6b) — its findings exercise the subset the
  // validator now derives in JS instead of re-querying
  await addCandidates('חפק', 'קשר', ['חייל 20', 'חייל 21'], true);
  await addCandidates('חפק', 'חובש', ['חייל 22']);
  await persist(await generate(D), { storeReport: false });
});
after(closePool);

test('preloaded refs produce byte-identical findings', async () => {
  const base = await loadStatic();
  assert.deepEqual(await validateDay(D, base.refs), await validateDay(D),
    'skipping the day-independent statements must not change a finding');
});

test('the seat-rule subset derived in JS matches the SQL predicate it replaced', async () => {
  const base = await loadStatic();
  const fromSql = (await query<{ name: string }>(
    `select name from positions where config ? 'seat_rules' order by name`)).map((r) => r.name);
  const fromJs = base.refs.positions
    .filter((p: any) => p.config != null && 'seat_rules' in p.config)
    .map((p: any) => p.name).sort();
  assert.ok(fromSql.length > 0, 'the seed must have at least one seat-rule position');
  assert.deepEqual(fromJs, fromSql);
});

test('a hand-built result (no validateRefs) still validates through persist', async () => {
  const res = await generate(D);
  delete res.validateRefs;
  const findings = await persist(res, { storeReport: false });
  assert.deepEqual(findings, await validateDay(D));
});
