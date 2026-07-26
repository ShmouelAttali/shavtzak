// Handler-level tests for the api/* query rework (Agent C).
//
// Each case pins a behaviour that a query change could silently break:
//   * exit-requests: generatedDay() is now ONE set-based query instead of two
//     serial probes per day — it must still answer "generated" for a day with
//     assignments, for a day whose status is past 'draft', and "no" otherwise,
//     agreeing with the SQL-side `generated` column of REQUEST_COLS.
//   * exit-requests: the normalized-name lookup moved from a JS full scan to
//     an indexed SQL expression (NORMALIZE_SQL) — quote/whitespace variants
//     must still resolve.
//   * draft: GET now caps the range at 62 days (400).
//   * presence: the per-run insert loop became one multi-row insert — several
//     runs written by ONE PUT must land as the same rows as before.
//   * publish/unpublish: the merged single read must keep the whole lifecycle
//     (publish, idempotent re-publish, unpublish, idempotent re-unpublish,
//     404, 409) intact.
// Positions and soldiers are resolved by NAME (never hardcoded seed ids).
import './env.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshSchema, seedSoldiers, closePool, query, soldierId } from './helpers.js';
import exitRequestsHandler, { NORMALIZE_SQL } from '../../api/exit-requests.js';
import draftHandler from '../../api/draft.js';
import presenceHandler from '../../api/presence.js';
import publishHandler from '../../api/publish.js';
import unpublishHandler from '../../api/unpublish.js';
import { getPool } from '../../api/_db.js';
import { normalizeName } from '../src/text.js';
import type { PublishResponse } from '../../api/publish.js';

const PREV = '2026-07-19';      // Sunday
const DAY = '2026-07-20';       // Monday

function mockRes() {
  const out: { status: number; body: any } = { status: 0, body: null };
  const res: any = {
    setHeader() { return res; },
    status(code: number) { out.status = code; return res; },
    json(body: any) { out.body = body; return res; },
    end() { return res; },
  };
  return { res, out };
}
const call = async (handler: any, req: any): Promise<{ status: number; body: any }> => {
  const { res, out } = mockRes();
  await handler(req as any, res as any);
  return out;
};

const posId = async (name: string): Promise<number> => {
  const r = await query<{ id: number }>(`select id from positions where name = $1`, [name]);
  assert.equal(r.length, 1, `position ${name}`);
  return r[0].id;
};

/** A schedule_days row in a chosen state (created or updated). */
const setDay = (day: string, status: string) => query(
  `insert into schedule_days (day, status) values ($1::date, $2)
   on conflict (day) do update set status = excluded.status`, [day, status]);

/** One assignment row on `day` (forces the "has shift_assignments" branch). */
async function addShift(day: string, soldier: string): Promise<void> {
  await query(
    `insert into shift_assignments (day, position_id, soldier_id, period, source, blocks_overlap)
     values ($1::date, $2, $3, tsrange($4::timestamp, $4::timestamp + interval '2 hours'),
             'auto', false)`,
    [day, await posId('סיור'), await soldierId(soldier), `${day} 16:00`]);
}

/** POST a 14:00-18:00 exit (one affected schedule day, well under the 16h cap). */
const postExit = (name: string, day: string) => call(exitRequestsHandler, {
  method: 'POST', query: {},
  body: { name, fromDate: day, from: '14:00', toDate: day, to: '18:00' },
});

const wipeExits = () => query(`delete from exit_requests`);

before(async () => {
  await freshSchema();
  await seedSoldiers();
});
after(async () => { await getPool().end(); await closePool(); });

// ── exit-requests: set-based generatedDay ────────────────────────────────────

test('generatedDay: a day holding assignments blocks the request', async () => {
  await wipeExits();
  await setDay(DAY, 'draft');
  await addShift(DAY, 'חייל 01');
  const { status, body } = await postExit('חייל 02', DAY);
  assert.equal(status, 409);
  assert.match(body.error, new RegExp(DAY), 'the 409 names the generated day');
  await query(`delete from shift_assignments where day = $1`, [DAY]);
});

test('generatedDay: a day whose status is past draft blocks it too (no assignments)', async () => {
  await wipeExits();
  await setDay(DAY, 'generated');
  const rows = await query(`select 1 from shift_assignments where day = $1`, [DAY]);
  assert.equal(rows.length, 0, 'this case must exercise the status branch alone');
  const { status, body } = await postExit('חייל 02', DAY);
  assert.equal(status, 409);
  assert.match(body.error, new RegExp(DAY));
});

test('generatedDay: neither condition → the request is created', async () => {
  await wipeExits();
  await setDay(DAY, 'draft');
  const { status, body } = await postExit('חייל 02', DAY);
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.request.day, DAY);
  assert.equal(body.request.generated, false);
});

test('generatedDay agrees with the SQL `generated` column of the GET', async () => {
  await wipeExits();
  await setDay(DAY, 'draft');
  assert.equal((await postExit('חייל 02', DAY)).status, 200);

  const read = async () => (await call(exitRequestsHandler,
    { method: 'GET', query: { from: DAY, to: DAY } })).body.requests[0];
  assert.equal((await read()).generated, false, 'draft day, no rows');

  // status branch
  await setDay(DAY, 'generated');
  assert.equal((await read()).generated, true);

  // assignments branch (status back to draft, one row present)
  await setDay(DAY, 'draft');
  await addShift(DAY, 'חייל 01');
  assert.equal((await read()).generated, true);
  await query(`delete from shift_assignments where day = $1`, [DAY]);
  assert.equal((await read()).generated, false);
});

test('generatedDay returns the EARLIEST generated day of the affected set', async () => {
  // 12:00→18:00 straddles the 14:00 boundary, so it affects schedule days
  // PREV and DAY while leaving each cycle far more than 8h free.
  await wipeExits();
  await setDay(PREV, 'generated');
  await setDay(DAY, 'generated');
  const { status, body } = await call(exitRequestsHandler, {
    method: 'POST', query: {},
    body: { admin: true, name: 'חייל 02', start: `${DAY} 12:00`, end: `${DAY} 18:00` },
  });
  assert.equal(status, 200, JSON.stringify(body));
  assert.match(body.warning, new RegExp(PREV), 'warns about the EARLIEST generated day');
});

test('generatedDay picks the later day when only that one is generated', async () => {
  await wipeExits();
  await setDay(PREV, 'draft');
  await setDay(DAY, 'generated');
  const { status, body } = await call(exitRequestsHandler, {
    method: 'POST', query: {},
    body: { admin: true, name: 'חייל 02', start: `${DAY} 12:00`, end: `${DAY} 18:00` },
  });
  assert.equal(status, 200, JSON.stringify(body));
  assert.match(body.warning, new RegExp(DAY));
});

test('generatedDay: no warning when no affected day is generated', async () => {
  await wipeExits();
  await setDay(PREV, 'draft');
  await setDay(DAY, 'draft');
  const { status, body } = await call(exitRequestsHandler, {
    method: 'POST', query: {},
    body: { admin: true, name: 'חייל 02', start: `${DAY} 12:00`, end: `${DAY} 18:00` },
  });
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.warning, undefined);
});

// ── exit-requests: the SQL normalized-name mirror ────────────────────────────

test('NORMALIZE_SQL matches normalizeName() for quote and whitespace variants', async () => {
  // The pair that matters: JS \s strips NBSP/BOM, Postgres \s does not — the
  // expression spells the class out, so both sides must agree.
  const samples = ['מ"כ דוד', 'מ״כ דוד', "מ'כ ד", 'a`b', '  x   y  ', 'x y', 'x﻿y'];
  for (const s of samples) {
    const r = await query<{ n: string }>(`select ${NORMALIZE_SQL('$1::text')} n`, [s]);
    assert.equal(r[0].n, normalizeName(s), `normalize mismatch for ${JSON.stringify(s)}`);
  }
});

test('a name with quote/whitespace noise still resolves to the soldier', async () => {
  await wipeExits();
  await setDay(DAY, 'draft');
  // 'חייל 02' typed with a doubled space — only the normalized path can match
  const { status, body } = await postExit('חייל  02', DAY);
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.request.soldierName, 'חייל 02');
});

test('an unknown name is still a 404', async () => {
  await wipeExits();
  await setDay(DAY, 'draft');
  assert.equal((await postExit('לא קיים בכלל', DAY)).status, 404);
});

// ── draft: GET range guard ───────────────────────────────────────────────────

test('draft GET rejects a range longer than 62 days', async () => {
  const { status, body } = await call(draftHandler,
    { method: 'GET', query: { from: '2026-01-01', to: '2026-12-31' } });
  assert.equal(status, 400);
  assert.match(body.error, /62/);
});

test('draft GET accepts a range at the 62-day limit and rejects 63', async () => {
  // 2026-07-01 .. 2026-08-31 inclusive = 62 days
  assert.equal((await call(draftHandler,
    { method: 'GET', query: { from: '2026-07-01', to: '2026-08-31' } })).status, 200);
  assert.equal((await call(draftHandler,
    { method: 'GET', query: { from: '2026-07-01', to: '2026-09-01' } })).status, 400);
});

test('draft GET rejects an inverted range', async () => {
  const { status } = await call(draftHandler,
    { method: 'GET', query: { from: '2026-07-20', to: '2026-07-19' } });
  assert.equal(status, 400);
});

// ── presence: batched multi-run insert ───────────────────────────────────────

/** A soldier's stored unavailability rows as 'kind|start|end'. */
const stored = async (name: string): Promise<string[]> => (await query<{ k: string }>(
  `select u.kind || '|' || to_char(lower(u.period),'YYYY-MM-DD HH24:MI')
                 || '|' || to_char(upper(u.period),'YYYY-MM-DD HH24:MI') k
     from unavailability u join soldiers so on so.id = u.soldier_id
    where so.full_name = $1
    order by lower(u.period)`, [name])).map((r) => r.k);

test('presence PUT writes SEVERAL runs in one batched insert, same rows as before', async () => {
  const sid = await soldierId('חייל 03');
  await query(`delete from unavailability where soldier_id = $1`, [sid]);
  // Two separate runs, split by a נוכח day in the middle → the plan emits two
  // insert rows, which is exactly what the unnest batching had to preserve.
  const { status, body } = await call(presenceHandler, {
    method: 'PUT', query: {},
    body: {
      soldier_id: sid,
      days: [
        { day: '2026-07-20', status: 'חופש' },
        { day: '2026-07-21', status: 'חופש' },
        { day: '2026-07-22', status: 'נוכח' },
        { day: '2026-07-23', status: 'מחלה' },
        { day: '2026-07-24', status: 'מחלה' },
      ],
    },
  });
  assert.equal(status, 200, JSON.stringify(body));
  // bus(d) = 06:00 on a non-Sunday; a run is [firstDay bus, lastDay+1 bus)
  assert.deepEqual(await stored('חייל 03'), [
    'חופש|2026-07-20 06:00|2026-07-22 06:00',
    'מחלה|2026-07-23 06:00|2026-07-25 06:00',
  ]);
  // and the echo agrees with what was stored
  const byDay = Object.fromEntries(body.days.map((d: any) => [d.day, d.status]));
  assert.equal(byDay['2026-07-20'], 'חופש');
  assert.equal(byDay['2026-07-22'], 'נוכח');
  assert.equal(byDay['2026-07-24'], 'מחלה');
});

test('presence PUT with a single run still works (batch of one)', async () => {
  const sid = await soldierId('חייל 04');
  await query(`delete from unavailability where soldier_id = $1`, [sid]);
  const { status } = await call(presenceHandler, {
    method: 'PUT', query: {},
    body: { soldier_id: sid, days: [{ day: '2026-07-20', status: 'חופש' }] },
  });
  assert.equal(status, 200);
  assert.deepEqual(await stored('חייל 04'), ['חופש|2026-07-20 06:00|2026-07-21 06:00']);
});

test('presence PUT clearing every day inserts nothing', async () => {
  const sid = await soldierId('חייל 05');
  await query(`delete from unavailability where soldier_id = $1`, [sid]);
  await call(presenceHandler, {
    method: 'PUT', query: {},
    body: { soldier_id: sid, days: [{ day: '2026-07-20', status: 'חופש' }] },
  });
  const { status } = await call(presenceHandler, {
    method: 'PUT', query: {},
    body: { soldier_id: sid, days: [{ day: '2026-07-20', status: 'נוכח' }] },
  });
  assert.equal(status, 200);
  assert.deepEqual(await stored('חייל 05'), []);
});

// ── publish / unpublish lifecycle over the merged read ───────────────────────

const publish = (day: string, email?: string) =>
  call(publishHandler, { method: 'POST', query: {}, body: { day, email } });
const unpublish = (day: string) =>
  call(unpublishHandler, { method: 'POST', query: {}, body: { day } });

test('publish → unpublish round trip, both idempotent', async () => {
  await setDay(DAY, 'generated');

  const first = await publish(DAY, 'officer@example.com');
  assert.equal(first.status, 200, JSON.stringify(first.body));
  const p = first.body as PublishResponse;
  assert.equal(p.day, DAY);
  assert.equal(p.status, 'published');
  assert.equal(p.approvedBy, 'officer@example.com');
  assert.ok(p.publishedAt, 'publishedAt is set');

  // re-publishing is a no-op success and echoes the SAME stored row — this is
  // the path that used to need a second read
  const again = await publish(DAY, 'someone.else@example.com');
  assert.equal(again.status, 200);
  assert.equal((again.body as PublishResponse).status, 'published');
  assert.equal((again.body as PublishResponse).approvedBy, 'officer@example.com',
    'the original approver is preserved, not overwritten');
  assert.equal((again.body as PublishResponse).publishedAt, p.publishedAt);

  const down = await unpublish(DAY);
  assert.equal(down.status, 200);
  assert.equal((down.body as PublishResponse).status, 'generated');
  assert.equal((down.body as PublishResponse).approvedBy, null);
  assert.equal((down.body as PublishResponse).publishedAt, null);

  const downAgain = await unpublish(DAY);
  assert.equal(downAgain.status, 200);
  assert.equal((downAgain.body as PublishResponse).status, 'generated');
});

test('publish: 404 on an unknown day, 409 on a bare draft', async () => {
  assert.equal((await publish('2019-01-01')).status, 404);
  await setDay(DAY, 'draft');
  const { status, body } = await publish(DAY);
  assert.equal(status, 409);
  assert.match(body.error, /generated/);
});

test('unpublish: 404 on an unknown day, 409 on a day that was never published', async () => {
  assert.equal((await unpublish('2019-01-01')).status, 404);
  await setDay(DAY, 'draft');
  assert.equal((await unpublish(DAY)).status, 409);
});

test('publishedAt records the current time, not a UTC-skewed one', async () => {
  await setDay(DAY, 'generated');
  const before = Date.now();
  const { body } = await publish(DAY, 'officer@example.com');
  const after = Date.now();
  const at = Date.parse((body as PublishResponse).publishedAt!);
  // a generous window: the point is to catch a 2-3h timezone skew, not clock drift
  const hour = 3600_000;
  assert.ok(at > before - hour && at < after + hour,
    `publishedAt ${new Date(at).toISOString()} is not within an hour of now — timezone skew?`);
});
