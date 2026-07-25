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
    name: 'חייל 20', fromDate: D1, from: '18:00', toDate: '2026-10-02', to: '06:00',
    email: 'x@y.z', note: 'אירוע משפחתי',
  });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const r = (res.body as { request: ExitRequest }).request;
  assert.equal(typeof r.id, 'number');
  assert.equal(r.soldierName, 'חייל 20');
  assert.equal(r.day, D1);                    // literal start date
  assert.equal(r.start, `${D1} 18:00`);
  assert.equal(r.end, '2026-10-02 06:00');   // literal cross-date return
  assert.equal(r.note, 'אירוע משפחתי');
  const db = await query<{ period: string; created_by: string; note: string }>(
    `select period::text, created_by, note from exit_requests where id = $1`, [r.id]);
  assert.equal(db[0]?.period, `["${D1} 18:00:00","2026-10-02 06:00:00")`);
  assert.equal(db[0]?.created_by, 'x@y.z');
  assert.equal(db[0]?.note, 'אירוע משפחתי');
});

test('POST 06:00 request stays on its literal calendar day (not +1)', async () => {
  // choosing 06:00 on a date must store 06:00 on THAT date — no schedule-day roll
  const res = await post({
    name: 'חייל 40', fromDate: '2026-10-16', from: '06:00', toDate: '2026-10-16', to: '14:00',
  });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const r = (res.body as { request: ExitRequest }).request;
  assert.equal(r.start, '2026-10-16 06:00');   // NOT 2026-10-17 06:00
  assert.equal(r.end, '2026-10-16 14:00');
  assert.equal(r.day, '2026-10-16');
  const db = await query<{ period: string }>(
    `select period::text from exit_requests where id = $1`, [r.id]);
  assert.equal(db[0]?.period, '["2026-10-16 06:00:00","2026-10-16 14:00:00")');
});

test('POST cross-date request 22:00 → next-day 06:00 persists literally', async () => {
  const res = await post({
    name: 'חייל 41', fromDate: '2026-10-17', from: '22:00', toDate: '2026-10-18', to: '06:00',
  });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const r = (res.body as { request: ExitRequest }).request;
  assert.equal(r.start, '2026-10-17 22:00');
  assert.equal(r.end, '2026-10-18 06:00');
  assert.equal(r.day, '2026-10-17');
  const db = await query<{ period: string }>(
    `select period::text from exit_requests where id = $1`, [r.id]);
  assert.equal(db[0]?.period, '["2026-10-17 22:00:00","2026-10-18 06:00:00")');
});

test('POST resolves quote/whitespace variants of the name (normalizeName)', async () => {
  const res = await post({ name: '  חייל   19 ', fromDate: D1, from: '14:00', toDate: D1, to: '18:00' });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal((res.body as { request: ExitRequest }).request.soldierName, 'חייל 19');
});

test('POST unknown soldier → 404', async () => {
  const res = await post({ name: 'לא קיים', fromDate: D2, from: '14:00', toDate: D2, to: '18:00' });
  assert.equal(res.statusCode, 404);
  assert.equal((res.body as any).error, 'החייל לא נמצא במצבת המשובצים');
});

test('POST invalid boundary time / bad date → 400', async () => {
  for (const body of [
    { name: 'חייל 20', fromDate: D2, from: '15:00', toDate: D2, to: '18:00' },  // from not a boundary
    { name: 'חייל 20', fromDate: D2, from: '14:00', toDate: D2, to: '13:00' },  // to not a boundary
    { name: 'חייל 20', fromDate: 'junk', from: '14:00', toDate: D2, to: '18:00' },
    { name: 'חייל 20', fromDate: D2, from: '14:00', to: '18:00' },              // toDate missing
    { name: 'חייל 20', from: '14:00', toDate: D2, to: '18:00' },                // fromDate missing
  ]) {
    const res = await post(body);
    assert.equal(res.statusCode, 400, JSON.stringify(body));
    assert.equal((res.body as any).error, 'טווח שעות לא תקין — יש לבחור שעות גבול משמרת');
  }
});

test('POST same-day return at/before leave → 400 (must use a later To date)', async () => {
  // no silent next-day roll: a same-date to ≤ from is rejected
  for (const [from, to] of [['22:00', '18:00'], ['02:00', '02:00'], ['18:00', '06:00']]) {
    const res = await post({ name: 'חייל 20', fromDate: D2, from, toDate: D2, to });
    assert.equal(res.statusCode, 400, `${from}→${to}`);
    assert.equal((res.body as any).error, 'זמן החזרה חייב להיות אחרי זמן היציאה');
  }
});

test('POST full 24h cycle (14:00→14:00) → 400 vacation message', async () => {
  const res = await post({ name: 'חייל 20', fromDate: D2, from: '14:00', toDate: '2026-10-03', to: '14:00' });
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
  const res = await post({ name: 'חייל 20', fromDate: D3, from: '18:00', toDate: D3, to: '22:00' });
  assert.equal(res.statusCode, 409);
  assert.equal((res.body as any).error,
    `השבצ"ק ליום ${D3} כבר נוצר — לא ניתן להגיש בקשת יציאה. יש לפנות לאחראי השבצ"ק.`);
});

test('POST for a day whose schedule_days.status is not draft → 409', async () => {
  await query(`insert into schedule_days (day, status) values ($1, 'generated')
               on conflict (day) do update set status = 'generated'`, [D4]);
  const res = await post({ name: 'חייל 20', fromDate: D4, from: '14:00', toDate: D4, to: '18:00' });
  assert.equal(res.statusCode, 409);
  assert.match((res.body as any).error, new RegExp(D4));
});

test('POST overlap with recorded unavailability → 400', async () => {
  const sid = await soldierId('חייל 25');
  await query(
    `insert into unavailability (soldier_id, period, kind)
     values ($1, tsrange($2::date + time '00:00', $2::date + interval '1 day'), 'חופש')`,
    [sid, '2026-10-06']);
  const res = await post({ name: 'חייל 25', fromDate: '2026-10-06', from: '02:00', toDate: '2026-10-06', to: '06:00' });
  assert.equal(res.statusCode, 400);
  assert.equal((res.body as any).error, 'קיימת כבר היעדרות רשומה בתאריכים אלה');
});

test('POST duplicate overlapping request → 409; other soldier same window OK', async () => {
  const first = await post({ name: 'חייל 22', fromDate: D5, from: '14:00', toDate: D5, to: '22:00' });
  assert.equal(first.statusCode, 200, JSON.stringify(first.body));
  const dup = await post({ name: 'חייל 22', fromDate: D5, from: '18:00', toDate: '2026-10-06', to: '02:00' });
  assert.equal(dup.statusCode, 409);
  assert.equal((dup.body as any).error, 'כבר קיימת בקשת יציאה חופפת');
  const other = await post({ name: 'חייל 21', fromDate: D5, from: '18:00', toDate: '2026-10-06', to: '02:00' });
  assert.equal(other.statusCode, 200, JSON.stringify(other.body));
});

// ── DELETE ───────────────────────────────────────────────────────────────────

test('DELETE ownership, generated-day block, then happy path', async () => {
  const created = await post({ name: 'חייל 23', fromDate: D6, from: '22:00', toDate: D7, to: '06:00' });
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

test('GET filters by literal start date', async () => {
  const late = await post({ name: 'חייל 26', fromDate: D7, from: '02:00', toDate: D7, to: '06:00' });
  assert.equal(late.statusCode, 200, JSON.stringify(late.body));

  let res = await call({ method: 'GET', query: { from: D7, to: D7 } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['Cache-Control'], 'no-store');
  let body = res.body as ExitRequestsResponse;
  assert.equal(body.requests.length, 1);
  assert.equal(body.requests[0].soldierName, 'חייל 26');
  assert.equal(body.requests[0].day, D7);
  assert.equal(body.requests[0].start, `${D7} 02:00`);

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

// ── Admin operations (admin POST / PATCH / DELETE force) ────────────────────

const adminPost = (body: Record<string, unknown>) => post({ admin: true, ...body });
const patch = (body: Record<string, unknown>) => call({ method: 'PATCH', body, query: {} });
const genWarning = (d: string) =>
  `השבצ"ק ליום ${d} כבר נוצר — יש לייצר אותו מחדש כדי שהיציאה תיכנס לתוקף`;

test('admin POST free-form times: correct row + generated:false', async () => {
  const res = await adminPost({
    name: 'חייל 30', start: '2026-10-10 09:30', end: '2026-10-10 13:15',
    email: 'admin@x.y', note: 'אישור מיוחד',
  });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const body = res.body as { request: ExitRequest; warning?: string };
  assert.equal(body.warning, undefined);
  const r = body.request;
  assert.equal(r.soldierName, 'חייל 30');
  assert.equal(r.day, '2026-10-10');            // literal calendar start date
  assert.equal(r.start, '2026-10-10 09:30');
  assert.equal(r.end, '2026-10-10 13:15');
  assert.equal(r.note, 'אישור מיוחד');
  assert.equal(r.generated, false);
  const db = await query<{ period: string; created_by: string }>(
    `select period::text, created_by from exit_requests where id = $1`, [r.id]);
  assert.equal(db[0]?.period, '["2026-10-10 09:30:00","2026-10-10 13:15:00")');
  assert.equal(db[0]?.created_by, 'admin@x.y');
});

test('admin POST malformed/inverted range → 400; unknown soldier → 404', async () => {
  for (const [start, end] of [
    ['2026-10-10 15:00', '2026-10-10 15:00'],   // end == start
    ['2026-10-10 16:00', '2026-10-10 15:00'],   // inverted
    ['junk', '2026-10-10 15:00'],
    ['2026-10-10 15:00', undefined],
  ] as [string, string | undefined][]) {
    const res = await adminPost({ name: 'חייל 30', start, end });
    assert.equal(res.statusCode, 400, `${start}→${end}`);
    assert.equal((res.body as any).error, 'טווח זמנים לא תקין');
  }
  const res = await adminPost({
    name: 'לא קיים', start: '2026-10-10 15:00', end: '2026-10-10 16:00' });
  assert.equal(res.statusCode, 404);
  assert.equal((res.body as any).error, 'החייל לא נמצא במצבת המשובצים');
});

test('admin POST on a generated day → 200 with warning (not 409)', async () => {
  // D3 already has shift_assignments rows (inserted in the 409 test above)
  const res = await adminPost({
    name: 'חייל 31', start: '2026-10-03 15:00', end: '2026-10-03 20:00' });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const body = res.body as { request: ExitRequest; warning?: string };
  assert.equal(body.warning, genWarning(D3));
  assert.equal(body.request.generated, true);
  const db = await query(`select 1 from exit_requests where id = $1`, [body.request.id]);
  assert.equal(db.length, 1);
});

test('admin POST leaving under 8h in a cycle → 400 vacation message', async () => {
  const res = await adminPost({
    name: 'חייל 32', start: '2026-10-11 14:00', end: '2026-10-12 12:00' });  // 22h of one cycle
  assert.equal(res.statusCode, 400);
  assert.equal((res.body as any).error,
    'היציאה משאירה פחות מ-8 שעות זמינות ביממת השיבוץ — ליציאה ארוכה כזו יש להגיש יום חופש');
});

test('admin POST overlapping an existing request → 409', async () => {
  const first = await adminPost({
    name: 'חייל 32', start: '2026-10-12 15:00', end: '2026-10-12 18:00' });
  assert.equal(first.statusCode, 200, JSON.stringify(first.body));
  const dup = await adminPost({
    name: 'חייל 32', start: '2026-10-12 17:00', end: '2026-10-12 19:00' });
  assert.equal(dup.statusCode, 409);
  assert.equal((dup.body as any).error, 'כבר קיימת בקשת יציאה חופפת');
});

test('PATCH happy path: period actually changed in the DB', async () => {
  const created = await adminPost({
    name: 'חייל 33', start: '2026-10-12 08:00', end: '2026-10-12 12:00', note: 'לפני' });
  assert.equal(created.statusCode, 200, JSON.stringify(created.body));
  const id = (created.body as { request: ExitRequest }).request.id;

  // new period overlaps the old one — the overlap check must exclude self
  const res = await patch({
    id, start: '2026-10-12 09:00', end: '2026-10-12 13:00', note: 'אחרי' });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const body = res.body as { request: ExitRequest; warning?: string };
  assert.equal(body.warning, undefined);
  assert.equal(body.request.id, id);
  assert.equal(body.request.start, '2026-10-12 09:00');
  assert.equal(body.request.end, '2026-10-12 13:00');
  assert.equal(body.request.note, 'אחרי');
  const db = await query<{ period: string; note: string }>(
    `select period::text, note from exit_requests where id = $1`, [id]);
  assert.equal(db[0]?.period, '["2026-10-12 09:00:00","2026-10-12 13:00:00")');
  assert.equal(db[0]?.note, 'אחרי');
});

test('PATCH onto an overlapping other request → 409; unknown id → 404', async () => {
  const a = await adminPost({
    name: 'חייל 34', start: '2026-10-14 15:00', end: '2026-10-14 18:00' });
  const b = await adminPost({
    name: 'חייל 34', start: '2026-10-14 19:00', end: '2026-10-14 21:00' });
  assert.equal(a.statusCode, 200, JSON.stringify(a.body));
  assert.equal(b.statusCode, 200, JSON.stringify(b.body));
  const bId = (b.body as { request: ExitRequest }).request.id;

  const res = await patch({
    id: bId, start: '2026-10-14 16:00', end: '2026-10-14 20:00' });  // overlaps a
  assert.equal(res.statusCode, 409);
  assert.equal((res.body as any).error, 'כבר קיימת בקשת יציאה חופפת');
  const db = await query<{ period: string }>(
    `select period::text from exit_requests where id = $1`, [bId]);
  assert.equal(db[0]?.period, '["2026-10-14 19:00:00","2026-10-14 21:00:00")');  // unchanged

  const missing = await patch({
    id: 999999, start: '2026-10-15 15:00', end: '2026-10-15 16:00' });
  assert.equal(missing.statusCode, 404);
  assert.equal((missing.body as any).error, 'הבקשה לא נמצאה');
});

test('PATCH onto a generated day → 200 with warning', async () => {
  const created = await adminPost({
    name: 'חייל 36', start: '2026-10-15 15:00', end: '2026-10-15 18:00' });
  assert.equal(created.statusCode, 200, JSON.stringify(created.body));
  const id = (created.body as { request: ExitRequest }).request.id;
  // move it onto D4 (schedule_days.status = 'generated' from the POST 409 test)
  const res = await patch({ id, start: '2026-10-04 15:00', end: '2026-10-04 18:00' });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const body = res.body as { request: ExitRequest; warning?: string };
  assert.equal(body.warning, genWarning(D4));
  assert.equal(body.request.generated, true);
});

test('DELETE with force=1 on a generated day → 200 with warning + row gone', async () => {
  const created = await adminPost({
    name: 'חייל 35', start: '2026-10-04 16:00', end: '2026-10-04 20:00' });  // D4 is generated
  assert.equal(created.statusCode, 200, JSON.stringify(created.body));
  assert.equal((created.body as any).warning, genWarning(D4));
  const id = (created.body as { request: ExitRequest }).request.id;

  // without force the old behavior holds: ownership + generated-day block
  let res = await call({ method: 'DELETE', query: { id: String(id) } });   // no name
  assert.equal(res.statusCode, 404);
  res = await call({ method: 'DELETE', query: { id: String(id), name: 'חייל 35' } });
  assert.equal(res.statusCode, 409);

  // force: no name needed, generated day only warns
  res = await call({ method: 'DELETE', query: { id: String(id), force: '1' } });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal((res.body as any).ok, true);
  assert.equal((res.body as any).warning, genWarning(D4));
  const gone = await query(`select 1 from exit_requests where id = $1`, [id]);
  assert.equal(gone.length, 0);

  // force on an unknown id still 404s
  res = await call({ method: 'DELETE', query: { id: String(id), force: '1' } });
  assert.equal(res.statusCode, 404);
});

test('GET without name returns all soldiers with generated flags', async () => {
  const res = await call({ method: 'GET', query: { from: D1, to: '2026-10-20' } });
  assert.equal(res.statusCode, 200);
  const body = res.body as ExitRequestsResponse;
  const names = new Set(body.requests.map((r) => r.soldierName));
  assert.ok(names.size >= 4, `expected several soldiers, got ${[...names].join(', ')}`);
  assert.ok(body.requests.every((r) => typeof r.generated === 'boolean'));
  // on D3 (shift_assignments exist) the flag is true
  const onGenerated = body.requests.find((r) => r.soldierName === 'חייל 31');
  assert.equal(onGenerated?.generated, true);
  // an untouched day stays false
  const plain = body.requests.find((r) => r.soldierName === 'חייל 20' && r.day === D1);
  assert.equal(plain?.generated, false);
});
