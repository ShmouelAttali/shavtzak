// Handler-level tests for api/exit-requests.ts (half-day exit requests) —
// against the local test database (never Supabase).
process.env.SCHEDULER_DATABASE_URL =
  process.env.SCHEDULER_TEST_DATABASE_URL
  ?? 'postgres://postgres:test@localhost:55432/shavtzak_test';

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshSchema, seedSoldiers, soldierId, closePool, query } from '../scheduler/tests/helpers.js';
import { getPool } from '../api/_db.js';
import exitRequestsHandler from '../api/exit-requests.js';
import type { ExitRequest, ExitRequestsResponse } from '../api/exit-requests.js';

// far-future days, never touched by generator suites
const D1 = '2026-10-01';   // POST happy path
const D2 = '2026-10-02';   // boundary/inverted/full-cycle rejections
const D3 = '2026-10-03';   // generated via shift_assignments row
const D4 = '2026-10-04';   // generated via schedule_days.status
const D5 = '2026-10-05';   // duplicate-overlap checks
const D6 = '2026-10-06';   // DELETE flow
const D7 = '2026-10-07';   // GET schedule-day mapping (02:00 start)

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

const call = async (req: Record<string, unknown>) => {
  const res = mockRes();
  await exitRequestsHandler(req, res);
  return res;
};
const post = (body: Record<string, unknown>) => call({ method: 'POST', body, query: {} });

before(async () => {
  await freshSchema();      // schema.sql already contains exit_requests
  await seedSoldiers();
});
after(async () => {
  await closePool();        // scheduler pool
  await getPool().end();    // api pool
});

// ── POST ─────────────────────────────────────────────────────────────────────

test('POST happy path: correct row shape + tsrange in the DB', async () => {
  const res = await post({
    name: 'חייל 20', day: D1, from: '18:00', to: '06:00',
    email: 'x@y.z', note: 'אירוע משפחתי',
  });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const r = (res.body as { request: ExitRequest }).request;
  assert.equal(typeof r.id, 'number');
  assert.equal(r.soldierName, 'חייל 20');
  assert.equal(r.day, D1);
  assert.equal(r.start, `${D1} 18:00`);
  assert.equal(r.end, '2026-10-02 06:00');   // 06:00 falls on the next calendar day
  assert.equal(r.note, 'אירוע משפחתי');
  const db = await query<{ period: string; created_by: string; note: string }>(
    `select period::text, created_by, note from exit_requests where id = $1`, [r.id]);
  assert.equal(db[0]?.period, `["${D1} 18:00:00","2026-10-02 06:00:00")`);
  assert.equal(db[0]?.created_by, 'x@y.z');
  assert.equal(db[0]?.note, 'אירוע משפחתי');
});

test('POST resolves quote/whitespace variants of the name (normalizeName)', async () => {
  const res = await post({ name: '  חייל   19 ', day: D1, from: '14:00', to: '18:00' });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal((res.body as { request: ExitRequest }).request.soldierName, 'חייל 19');
});

test('POST unknown soldier → 404', async () => {
  const res = await post({ name: 'לא קיים', day: D2, from: '14:00', to: '18:00' });
  assert.equal(res.statusCode, 404);
  assert.equal((res.body as any).error, 'החייל לא נמצא במצבת המשובצים');
});

test('POST invalid boundary time / bad day → 400', async () => {
  for (const body of [
    { name: 'חייל 20', day: D2, from: '15:00', to: '18:00' },  // from not a boundary
    { name: 'חייל 20', day: D2, from: '14:00', to: '13:00' },  // to not a boundary
    { name: 'חייל 20', day: D2, from: '06:00', to: '18:00' },  // wait — 18:00(4) <= 06:00(16): inverted, still 400
    { name: 'חייל 20', day: 'junk', from: '14:00', to: '18:00' },
    { name: 'חייל 20', from: '14:00', to: '18:00' },           // day missing
  ]) {
    const res = await post(body);
    assert.equal(res.statusCode, 400, JSON.stringify(body));
    assert.equal((res.body as any).error, 'טווח שעות לא תקין — יש לבחור שעות גבול משמרת');
  }
});

test('POST from/to inverted (to at or before from) → 400', async () => {
  for (const [from, to] of [['22:00', '18:00'], ['02:00', '02:00'], ['06:00', '22:00']]) {
    const res = await post({ name: 'חייל 20', day: D2, from, to });
    assert.equal(res.statusCode, 400, `${from}→${to}`);
    assert.equal((res.body as any).error, 'טווח שעות לא תקין — יש לבחור שעות גבול משמרת');
  }
});

test('POST full 24h cycle (14:00→14:00) → 400 vacation message', async () => {
  const res = await post({ name: 'חייל 20', day: D2, from: '14:00', to: '14:00' });
  assert.equal(res.statusCode, 400);
  assert.equal((res.body as any).error,
    'היציאה משאירה פחות מ-8 שעות זמינות ביממת השיבוץ — ליציאה ארוכה כזו יש להגיש יום חופש');
});

test('POST for a day that already has shift_assignments → 409', async () => {
  const sid = await soldierId('חייל 01');
  const pos = await query<{ id: number }>(`select id from positions where name = 'מגן'`);
  assert.ok(pos[0], 'position מגן exists in seed');
  await query(`insert into schedule_days (day) values ($1) on conflict do nothing`, [D3]);
  await query(
    `insert into shift_assignments (day, position_id, soldier_id, period)
     values ($1, $2, $3, tsrange($1::date + time '14:00', $1::date + time '18:00'))`,
    [D3, pos[0].id, sid]);
  const res = await post({ name: 'חייל 20', day: D3, from: '18:00', to: '22:00' });
  assert.equal(res.statusCode, 409);
  assert.equal((res.body as any).error,
    `השבצ"ק ליום ${D3} כבר נוצר — לא ניתן להגיש בקשת יציאה. יש לפנות לאחראי השבצ"ק.`);
});

test('POST for a day whose schedule_days.status is not draft → 409', async () => {
  await query(`insert into schedule_days (day, status) values ($1, 'generated')
               on conflict (day) do update set status = 'generated'`, [D4]);
  const res = await post({ name: 'חייל 20', day: D4, from: '14:00', to: '18:00' });
  assert.equal(res.statusCode, 409);
  assert.match((res.body as any).error, new RegExp(D4));
});

test('POST overlap with recorded unavailability → 400', async () => {
  const sid = await soldierId('חייל 25');
  await query(
    `insert into unavailability (soldier_id, period, kind)
     values ($1, tsrange($2::date + time '00:00', $2::date + interval '1 day'), 'חופש')`,
    [sid, '2026-10-06']);   // covers the tail of schedule day D5 (02:00/06:00 next morning)
  const res = await post({ name: 'חייל 25', day: D5, from: '02:00', to: '06:00' });
  assert.equal(res.statusCode, 400);
  assert.equal((res.body as any).error, 'קיימת כבר היעדרות רשומה בתאריכים אלה');
});

test('POST duplicate overlapping request → 409; other soldier same window OK', async () => {
  const first = await post({ name: 'חייל 22', day: D5, from: '14:00', to: '22:00' });
  assert.equal(first.statusCode, 200, JSON.stringify(first.body));
  const dup = await post({ name: 'חייל 22', day: D5, from: '18:00', to: '02:00' });
  assert.equal(dup.statusCode, 409);
  assert.equal((dup.body as any).error, 'כבר קיימת בקשת יציאה חופפת');
  const other = await post({ name: 'חייל 21', day: D5, from: '18:00', to: '02:00' });
  assert.equal(other.statusCode, 200, JSON.stringify(other.body));
});

// ── DELETE ───────────────────────────────────────────────────────────────────

test('DELETE ownership, generated-day block, then happy path', async () => {
  const created = await post({ name: 'חייל 23', day: D6, from: '22:00', to: '06:00' });
  assert.equal(created.statusCode, 200, JSON.stringify(created.body));
  const id = (created.body as { request: ExitRequest }).request.id;

  // wrong name → 404 (ownership)
  let res = await call({ method: 'DELETE', query: { id: String(id), name: 'חייל 24' } });
  assert.equal(res.statusCode, 404);
  // unknown id → 404
  res = await call({ method: 'DELETE', query: { id: '999999', name: 'חייל 23' } });
  assert.equal(res.statusCode, 404);

  // day generated after the request was made → 409
  await query(`insert into schedule_days (day, status) values ($1, 'generated')
               on conflict (day) do update set status = 'generated'`, [D6]);
  res = await call({ method: 'DELETE', query: { id: String(id), name: 'חייל 23' } });
  assert.equal(res.statusCode, 409);
  assert.equal((res.body as any).error,
    `השבצ"ק ליום ${D6} כבר נוצר — לביטול יש לפנות לאחראי השבצ"ק`);

  // back to draft → deletion succeeds and the row is gone
  await query(`update schedule_days set status = 'draft' where day = $1`, [D6]);
  res = await call({ method: 'DELETE', query: { id: String(id), name: 'חייל 23' } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true });
  const gone = await query(`select 1 from exit_requests where id = $1`, [id]);
  assert.equal(gone.length, 0);
});

// ── GET ──────────────────────────────────────────────────────────────────────

test('GET filters by schedule-day range (02:00 start belongs to the prior day)', async () => {
  // starts 02:00 on the calendar day AFTER D7 — still schedule day D7
  const late = await post({ name: 'חייל 26', day: D7, from: '02:00', to: '06:00' });
  assert.equal(late.statusCode, 200, JSON.stringify(late.body));

  let res = await call({ method: 'GET', query: { from: D7, to: D7 } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['Cache-Control'], 'no-store');
  let body = res.body as ExitRequestsResponse;
  assert.equal(body.requests.length, 1);
  assert.equal(body.requests[0].soldierName, 'חייל 26');
  assert.equal(body.requests[0].day, D7);
  assert.equal(body.requests[0].start, '2026-10-08 02:00');

  // D1 has two requests (happy path + normalized-name test), ordered by period
  res = await call({ method: 'GET', query: { from: D1, to: D1 } });
  body = res.body as ExitRequestsResponse;
  assert.deepEqual(body.requests.map((r) => r.soldierName), ['חייל 19', 'חייל 20']);
  assert.ok(body.requests.every((r) => r.day === D1));

  // name filter narrows to one soldier
  res = await call({ method: 'GET', query: { from: D1, to: D7, name: 'חייל 20' } });
  body = res.body as ExitRequestsResponse;
  assert.ok(body.requests.length >= 1);
  assert.ok(body.requests.every((r) => r.soldierName === 'חייל 20'));

  // unknown name → empty, not an error
  res = await call({ method: 'GET', query: { from: D1, to: D7, name: 'לא קיים' } });
  assert.deepEqual((res.body as ExitRequestsResponse).requests, []);
});

test('GET without valid from/to → 400; unsupported method → 405', async () => {
  for (const q of [{}, { from: 'junk' }, { from: D1, to: 'junk' }]) {
    const res = await call({ method: 'GET', query: q });
    assert.equal(res.statusCode, 400, JSON.stringify(q));
  }
  const res = await call({ method: 'PUT', query: {}, body: {} });
  assert.equal(res.statusCode, 405);
});
