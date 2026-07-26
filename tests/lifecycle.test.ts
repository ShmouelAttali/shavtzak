// Handler-level tests for the draft lifecycle (Tasks 6 & 7): report_html
// persistence + GET /api/report, publish/unpublish flow + overwrite guard,
// and stale-draft cleanup. Runs against the local test DB (never Supabase).
process.env.SCHEDULER_DATABASE_URL =
  process.env.SCHEDULER_TEST_DATABASE_URL
  ?? 'postgres://postgres:test@localhost:55432/shavtzak_test';

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshSchema, seedSoldiers, soldierId, closePool, query } from '../scheduler/tests/helpers.js';
import { getPool } from '../api/_db.js';
import draftHandler from '../api/_handlers/draft.js';
import reportHandler from '../api/_handlers/report.js';
import publishHandler from '../api/_handlers/publish.js';
import unpublishHandler from '../api/_handlers/unpublish.js';

function mockRes() {
  const res: any = {
    headers: {} as Record<string, string>,
    statusCode: 0,
    body: undefined as unknown,
    setHeader(k: string, v: string) { res.headers[k] = v; },
    status(c: number) { res.statusCode = c; return res; },
    json(b: unknown) { res.body = b; return res; },
    send(b: unknown) { res.body = b; return res; },
    end() { return res; },
  };
  return res;
}
const call = async (handler: Function, req: Record<string, unknown>) => {
  const res = mockRes();
  await handler(req, res);
  return res;
};

/** Insert a schedule_days row + one shift_assignment for a given day/status. */
async function seedDay(day: string, status: string, opts: { sid: number; source: string; locked?: boolean; seat: number }[]) {
  await query(`insert into schedule_days (day, status) values ($1, $2)
               on conflict (day) do update set status = excluded.status`, [day, status]);
  const posId = (await query<{ id: string }>(`select id from positions where name = 'מגן'`))[0].id;
  for (const o of opts) {
    await query(
      `insert into shift_assignments (day, position_id, soldier_id, period, source, blocks_overlap, locked, seat_index)
       values ($1, $2, $3, tsrange(day_start($1), day_start($1) + interval '4 hours'), $4, true, $5, $6)`,
      [day, posId, o.sid, o.source, o.locked ?? false, o.seat]);
  }
}
const rowsOn = async (day: string) =>
  (await query<{ n: string }>(`select count(*) n from shift_assignments where day = $1`, [day]))[0].n;
const statusOf = async (day: string) =>
  (await query<{ status: string }>(`select status from schedule_days where day = $1`, [day]))[0]?.status;

before(async () => {
  await freshSchema();
  await seedSoldiers();
});
after(async () => {
  await closePool();
  await getPool().end();
});

// ── Task 6: report_html + GET /api/report ──────────────────────────────────

const RD = '2026-09-10';

test('generating a day stores report_html and GET /api/report returns it', async () => {
  const gen = await call(draftHandler, { method: 'POST', body: { day: RD }, query: {} });
  assert.equal(gen.statusCode, 200, JSON.stringify(gen.body));
  const stored = await query<{ report_html: string | null }>(
    `select report_html from schedule_days where day = $1`, [RD]);
  assert.ok(stored[0]?.report_html && stored[0].report_html.length > 500, 'report_html written');

  const res = await call(reportHandler, { method: 'GET', query: { day: RD } });
  assert.equal(res.statusCode, 200);
  assert.match(String(res.headers['Content-Type']), /text\/html/);
  assert.ok(String(res.body).includes('<html'), 'returns an HTML page');
});

test('GET /api/report 404s for a day with no stored report', async () => {
  await query(`insert into schedule_days (day, status) values ('2026-09-11', 'draft')
               on conflict do nothing`);
  const res = await call(reportHandler, { method: 'GET', query: { day: '2026-09-11' } });
  assert.equal(res.statusCode, 404);
});

test('GET /api/report validates input and rejects non-GET', async () => {
  assert.equal((await call(reportHandler, { method: 'GET', query: { day: 'junk' } })).statusCode, 400);
  assert.equal((await call(reportHandler, { method: 'GET', query: {} })).statusCode, 400);
  assert.equal((await call(reportHandler, { method: 'POST', query: {} })).statusCode, 405);
});

// ── Task 7A: publish / unpublish + overwrite guard ─────────────────────────

const PD = '2026-09-12';

test('publish sets status/approved_by/published_at; getDrafts includes it; unpublish reverts', async () => {
  await call(draftHandler, { method: 'POST', body: { day: PD }, query: {} });

  const pub = await call(publishHandler, { method: 'POST', body: { day: PD, email: 'officer@x.io' }, query: {} });
  assert.equal(pub.statusCode, 200, JSON.stringify(pub.body));
  assert.equal((pub.body as any).status, 'published');
  const row = (await query<{ status: string; approved_by: string; published_at: string | null }>(
    `select status, approved_by, published_at from schedule_days where day = $1`, [PD]))[0];
  assert.equal(row.status, 'published');
  assert.equal(row.approved_by, 'officer@x.io');
  assert.ok(row.published_at, 'published_at set');

  // getDrafts includes the published day and renders its rows
  const drafts = await call(draftHandler, { method: 'GET', query: { from: PD, to: PD } });
  const d = (drafts.body as any).days.find((x: any) => x.day === PD);
  assert.equal(d.status, 'published');
  assert.ok(d.groups.length > 0, 'published day still renders rows');

  // idempotent re-publish
  const again = await call(publishHandler, { method: 'POST', body: { day: PD, email: 'officer@x.io' }, query: {} });
  assert.equal(again.statusCode, 200);

  const unpub = await call(unpublishHandler, { method: 'POST', body: { day: PD }, query: {} });
  assert.equal(unpub.statusCode, 200, JSON.stringify(unpub.body));
  const row2 = (await query<{ status: string; approved_by: string | null; published_at: string | null }>(
    `select status, approved_by, published_at from schedule_days where day = $1`, [PD]))[0];
  assert.equal(row2.status, 'generated');
  assert.equal(row2.approved_by, null);
  assert.equal(row2.published_at, null);
});

test('publish refuses a bare draft (409); generate refuses a published day (409)', async () => {
  await query(`insert into schedule_days (day, status) values ('2026-09-13', 'draft')
               on conflict (day) do update set status = 'draft'`);
  const bad = await call(publishHandler, { method: 'POST', body: { day: '2026-09-13' }, query: {} });
  assert.equal(bad.statusCode, 409);

  // publish PD again, then confirm regeneration is blocked
  await call(draftHandler, { method: 'POST', body: { day: PD }, query: {} });
  await call(publishHandler, { method: 'POST', body: { day: PD, email: 'o@x.io' }, query: {} });
  const gen = await call(draftHandler, { method: 'POST', body: { day: PD }, query: {} });
  assert.equal(gen.statusCode, 409, JSON.stringify(gen.body));
  // cleanup so later tests aren't affected
  await call(unpublishHandler, { method: 'POST', body: { day: PD }, query: {} });
});

// ── Task 7B: stale-draft cleanup ────────────────────────────────────────────

test('cleanup deletes past auto/chain drafts with a published successor, keeps locked/manual', async () => {
  const s1 = await soldierId('חייל 01');
  const s2 = await soldierId('חייל 02');
  const s3 = await soldierId('חייל 03');
  const s4 = await soldierId('חייל 04');

  // A: past, generated, auto + locked → auto dropped, locked kept, stays generated
  await seedDay('2020-01-01', 'generated', [
    { sid: s1, source: 'auto', seat: 1 },
    { sid: s2, source: 'auto', locked: true, seat: 2 },
  ]);
  // B: past, generated, auto only → emptied → reverts to draft
  await seedDay('2020-01-02', 'generated', [{ sid: s1, source: 'auto', seat: 1 }]);
  // Dpub: past, PUBLISHED, auto → never touched
  await seedDay('2020-03-01', 'published', [{ sid: s3, source: 'auto', seat: 1 }]);
  // C: past, generated, auto, but AFTER the only published day → no successor → kept
  await seedDay('2020-06-01', 'generated', [{ sid: s4, source: 'auto', seat: 1 }]);

  // GET now caps the range at 62 days (query-review 2026-07-26), so the year
  // is walked in three in-cap windows. The cleanup's published-successor
  // check is global (any published day >= d), not bound to the requested
  // range, so the narrower trigger windows change nothing about what it sees.
  for (const [from, to] of [['2020-01-01', '2020-01-31'],
                            ['2020-03-01', '2020-03-31'],
                            ['2020-06-01', '2020-06-30']] as const) {
    const res = await call(draftHandler, { method: 'GET', query: { from, to } });
    assert.equal(res.statusCode, 200);
  }

  assert.equal(await rowsOn('2020-01-01'), '1', 'A: only the locked row survives');
  assert.equal(await statusOf('2020-01-01'), 'generated', 'A: keeps generated (human rows remain)');
  assert.equal(await rowsOn('2020-01-02'), '0', 'B: auto rows deleted');
  assert.equal(await statusOf('2020-01-02'), 'draft', 'B: reverts to empty draft');
  assert.equal(await rowsOn('2020-03-01'), '1', 'Dpub: published day untouched');
  assert.equal(await statusOf('2020-03-01'), 'published');
  assert.equal(await rowsOn('2020-06-01'), '1', 'C: no published successor → kept');
  assert.equal(await statusOf('2020-06-01'), 'generated');
});

test('cleanup leaves future / in-cycle days untouched even with a published successor', async () => {
  const s1 = await soldierId('חייל 05');
  await seedDay('2099-01-01', 'generated', [{ sid: s1, source: 'auto', seat: 1 }]);
  await seedDay('2099-12-01', 'published', [{ sid: s1, source: 'auto', seat: 2 }]);

  // In-cap window (62-day GET guard); the 2099-12-01 published successor is
  // still visible to the cleanup — its successor check is range-independent.
  const res = await call(draftHandler, { method: 'GET', query: { from: '2099-01-01', to: '2099-01-31' } });
  assert.equal(res.statusCode, 200);
  assert.equal(await rowsOn('2099-01-01'), '1', 'future day auto rows kept (cycle not ended)');
  assert.equal(await statusOf('2099-01-01'), 'generated');
});
