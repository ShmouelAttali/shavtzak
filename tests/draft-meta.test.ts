// Handler-level test for api/draft.ts GET meta against the local test database
// (same shavtzak_test DB the scheduler suite uses — never Supabase).
process.env.SCHEDULER_DATABASE_URL =
  process.env.SCHEDULER_TEST_DATABASE_URL
  ?? 'postgres://postgres:test@localhost:55432/shavtzak_test';

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshSchema, seedSoldiers, closePool } from '../scheduler/tests/helpers.js';
import { generate, persist } from '../scheduler/src/generate.js';
import { getPool } from '../api/_db.js';
import handler from '../api/draft.js';
import type { DraftResponse } from '../api/draft.js';

const D1 = '2026-09-01', D2 = '2026-09-02';

function mockRes() {
  const res: any = {
    headers: {} as Record<string, string>,
    statusCode: 0,
    body: undefined as unknown,
    setHeader(k: string, v: string) { res.headers[k] = v; },
    status(c: number) { res.statusCode = c; return res; },
    json(b: unknown) { res.body = b; return res; },
    end() { return res; },
  };
  return res;
}

const get = async (query: Record<string, string>) => {
  const res = mockRes();
  await handler({ method: 'GET', query } as any, res);
  return res;
};

before(async () => {
  await freshSchema();
  await seedSoldiers();
  for (const d of [D1, D2]) await persist(await generate(d));
});
after(async () => {
  await closePool();          // scheduler pool
  await getPool().end();      // api pool
});

test('GET returns rationale meta for every soldier×time in groups', async () => {
  const res = await get({ from: D2, to: D2 });
  assert.equal(res.statusCode, 200);
  const body = res.body as DraftResponse;
  assert.equal(body.days.length, 1);
  const day = body.days[0];
  assert.ok(day.groups.length > 0, 'draft groups exist');

  let cells = 0, withRationale = 0;
  for (const g of day.groups) {
    for (const sub of g.subTypes) {
      for (const slot of sub.times) {
        for (const name of slot.soldiers) {
          cells++;
          const meta = day.meta[`${name}|${slot.time}`];
          assert.ok(meta, `missing meta for ${name}|${slot.time}`);
          assert.ok(Array.isArray(meta.rationale), 'rationale must be an array');
          if (meta.rationale.length > 0) withRationale++;
        }
      }
    }
  }
  assert.ok(cells > 0, 'soldier cells exist');
  // every generated (auto/chain) cell carries an explanation
  assert.ok(withRationale === cells,
    `${cells - withRationale}/${cells} cells missing rationale`);
});

test('GET on an empty day returns no meta and no groups', async () => {
  const res = await get({ from: '2026-09-20', to: '2026-09-20' });
  assert.equal(res.statusCode, 200);
  const body = res.body as DraftResponse;
  assert.equal(body.days.length, 0);
});
