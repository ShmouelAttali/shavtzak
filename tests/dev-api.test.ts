// End-to-end tests over the REAL dev-API HTTP seam (scripts/dev-api-server.ts):
// query parsing, JSON body parsing, and handler routing. The handler-level
// suites call handlers with mock req/res and never cover this path — a stale
// or mis-parsed body silently rerouted an admin POST into the soldier-path
// boundary validation once; these tests pin the seam.
process.env.SCHEDULER_DATABASE_URL =
  process.env.SCHEDULER_TEST_DATABASE_URL
  ?? 'postgres://postgres:test@localhost:55432/shavtzak_test';

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { freshSchema, seedSoldiers, closePool } from '../scheduler/tests/helpers.js';
import { getPool } from '../api/_db.js';
import { createDevApiServer } from '../scripts/dev-api-server.js';
import type { ExitRequest, ExitRequestsResponse } from '../api/exit-requests.js';

const D1 = '2026-11-01';   // admin POST over HTTP
const D2 = '2026-11-02';   // soldier POST over HTTP

const server = createDevApiServer();
let base = '';

before(async () => {
  await freshSchema();
  await seedSoldiers();
  await new Promise<void>((ok) => server.listen(0, () => ok()));
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
});
after(async () => {
  await new Promise((ok) => server.close(ok));
  await closePool();
  await getPool().end();
});

const postJson = (body: unknown) => fetch(`${base}/api/exit-requests`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

test('admin POST over HTTP routes to the admin path (JSON body parsed)', async () => {
  const res = await postJson({
    admin: true, name: 'חייל 40',
    start: `${D1} 14:00`, end: `${D1} 18:00`, email: 'a@b.c',
  });
  const body = await res.json() as { request?: ExitRequest; error?: string };
  // the one regression that actually happened: an unparsed/unrecognized body
  // falls into the soldier path and dies on its boundary validation
  assert.notEqual(body.error, 'טווח שעות לא תקין — יש לבחור שעות גבול משמרת',
    'admin body was routed into the soldier-path validation');
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(body.request!.soldierName, 'חייל 40');
  assert.equal(body.request!.start, `${D1} 14:00`);
  assert.equal(body.request!.end, `${D1} 18:00`);
});

test('soldier POST over HTTP: boundary window accepted', async () => {
  const res = await postJson({ name: 'חייל 41', fromDate: D2, from: '14:00', toDate: D2, to: '18:00' });
  const body = await res.json() as { request?: ExitRequest; error?: string };
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(body.request!.day, D2);
});

test('GET over HTTP: query params reach the handler', async () => {
  const res = await fetch(
    `${base}/api/exit-requests?from=${D1}&to=${D2}&name=${encodeURIComponent('חייל 40')}`);
  assert.equal(res.status, 200);
  const body = await res.json() as ExitRequestsResponse;
  assert.equal(body.requests.length, 1);
  assert.equal(body.requests[0].soldierName, 'חייל 40');
});

test('unknown path → 404', async () => {
  const res = await fetch(`${base}/api/nope`);
  assert.equal(res.status, 404);
});
