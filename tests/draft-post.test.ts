// Handler-level tests for api/draft.ts POST (generation) and the input-
// validation branches of both scheduler endpoints — against the local test
// database (never Supabase).
process.env.SCHEDULER_DATABASE_URL =
  process.env.SCHEDULER_TEST_DATABASE_URL
  ?? 'postgres://postgres:test@localhost:55432/shavtzak_test';

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshSchema, seedSoldiers, closePool, query } from '../scheduler/tests/helpers.js';
import { getPool } from '../api/_db.js';
import draftHandler from '../api/draft.js';
import fairnessHandler from '../api/fairness.js';
import type { GenerateResponse } from '../api/draft.js';

const D = '2026-09-05';

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

const call = async (handler: Function, req: Record<string, unknown>) => {
  const res = mockRes();
  await handler(req, res);
  return res;
};

before(async () => {
  await freshSchema();
  await seedSoldiers();
});
after(async () => {
  await closePool();          // scheduler pool
  await getPool().end();      // api pool
});

test('POST /api/draft generates the day and returns a GenerateResponse', async () => {
  const res = await call(draftHandler, { method: 'POST', body: { day: D }, query: {} });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const body = res.body as GenerateResponse;
  assert.equal(body.day, D);
  assert.ok(body.rows > 0, 'generated rows');
  assert.ok(Array.isArray(body.issues));
  assert.ok(Array.isArray(body.validation));
  const status = await query<{ status: string }>(
    `select status from schedule_days where day = $1`, [D]);
  assert.equal(status[0]?.status, 'generated');
});

test('POST /api/draft without a valid day → 400', async () => {
  for (const body of [undefined, {}, { day: 'not-a-date' }, { day: '17/07/2026' }]) {
    const res = await call(draftHandler, { method: 'POST', body, query: {} });
    assert.equal(res.statusCode, 400, JSON.stringify(body));
  }
});

test('GET /api/draft without valid from/to → 400', async () => {
  for (const q of [{}, { from: 'junk' }, { from: D, to: 'junk' }]) {
    const res = await call(draftHandler, { method: 'GET', query: q });
    assert.equal(res.statusCode, 400, JSON.stringify(q));
  }
});

test('unsupported method on /api/draft → 405', async () => {
  const res = await call(draftHandler, { method: 'PUT', query: {}, body: {} });
  assert.equal(res.statusCode, 405);
});

test('GET /api/fairness without a valid date → 400; non-GET → 405', async () => {
  for (const q of [{}, { date: 'junk' }]) {
    const res = await call(fairnessHandler, { method: 'GET', query: q });
    assert.equal(res.statusCode, 400, JSON.stringify(q));
  }
  const res = await call(fairnessHandler, { method: 'POST', query: {}, body: {} });
  assert.equal(res.statusCode, 405);
});
