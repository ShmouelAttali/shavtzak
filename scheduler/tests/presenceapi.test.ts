// Handler-level tests for api/_handlers/presence.ts (the נוכחות presence editor).
// GET returns the roster document + the selectable states DERIVED from the
// `unavailability` kind CHECK constraint + the per-soldier × per-day matrix.
// PUT is a declarative per-day replace for ONE soldier: consecutive same-kind
// days collapse into one [firstDay bus, lastDay+1 bus) row (Sunday 08:00,
// otherwise 06:00), runs merge with adjacent untouched rows, נוכח splits/clears
// and a partial-kind row on a touched day is replaced.
// Resolve soldiers by NAME (never hardcoded seed ids).
import './env.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshSchema, seedSoldiers, closePool, query, soldierId } from './helpers.js';
import presenceHandler from '../../api/_handlers/presence.js';
import { getPool } from '../../api/_db.js';
import type { PresenceResponse } from '../../api/_handlers/presence.js';

// 2026-07-19 Sunday … 2026-07-26 Sunday
const SUN = '2026-07-19', MON = '2026-07-20', TUE = '2026-07-21', WED = '2026-07-22',
  THU = '2026-07-23', FRI = '2026-07-24', SAT = '2026-07-25', SUN2 = '2026-07-26';

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
async function call(req: any): Promise<{ status: number; body: any }> {
  const { res, out } = mockRes();
  await presenceHandler(req as any, res as any);
  return out;
}
const get = (from: string, to: string) => call({ method: 'GET', query: { from, to } });
const put = (body: any) => call({ method: 'PUT', query: {}, body });

/** One soldier's statuses keyed by day. (`soldiers.id` is a bigint — pg hands
 *  it back as a string, so coerce before comparing.) */
function matrix(b: PresenceResponse, id: number | string): Record<string, string> {
  const row = b.presence.find((p) => p.soldierId === Number(id));
  assert.ok(row, `no presence row for soldier ${id}`);
  const out: Record<string, string> = {};
  b.days.forEach((d, i) => { out[d] = row!.statuses[i]; });
  return out;
}

/** The soldier's stored rows as 'kind|start|end' strings, ordered. */
async function stored(name: string): Promise<string[]> {
  const rows = await query<{ k: string; s: string; e: string }>(
    `select u.kind k,
            to_char(lower(u.period),'YYYY-MM-DD HH24:MI') s,
            to_char(upper(u.period),'YYYY-MM-DD HH24:MI') e
       from unavailability u join soldiers so on so.id = u.soldier_id
      where so.full_name = $1
      order by lower(u.period)`, [name]);
  return rows.map((r) => `${r.k}|${r.s}|${r.e}`);
}

const mark = async (name: string, days: string[], status: string) =>
  put({ soldier_id: await soldierId(name), days: days.map((day) => ({ day, status })) });

before(async () => {
  await freshSchema();
  await seedSoldiers();
});
after(async () => { await getPool().end().catch(() => {}); await closePool(); });

test('GET returns the states derived from the DB constraint', async () => {
  const out = await get(SUN, SUN2);
  assert.equal(out.status, 200);
  const b = out.body as PresenceResponse;

  // full-day kinds only, the two לא מגויס spellings collapsed, נוכח first
  assert.deepEqual(b.states, ['נוכח', 'חופש', 'מחלה', 'לא מגויס', 'שחרור', 'גיוס']);
  // the partial kinds the constraint also allows are NOT offered
  for (const k of ['יציאה', 'יציאה בבוקר', 'חזרה בערב'])
    assert.ok(!b.states.includes(k), `${k} must stay display-only`);

  assert.deepEqual(b.days, [SUN, MON, TUE, WED, THU, FRI, SAT, SUN2]);
  assert.equal(b.presence.length, 60);
  assert.equal(b.roster.soldiers.length, 60, 'the roster document the filter bar needs');
  assert.ok(b.roster.qualifications.includes('נהג דוד') && b.roster.roles.includes('מ"כ'));
});

test('GET maps stored rows back to the days they cover', async () => {
  const sid = await soldierId('חייל 02');
  // exactly what cleanup.py writes for Mon..Wed חופש + a Thursday partial
  await query(
    `insert into unavailability (soldier_id, period, kind) values
       ($1, tsrange('${MON} 06:00','${THU} 06:00'), 'חופש'),
       ($1, tsrange('${THU} 00:00','${THU} 14:00'), 'חזרה ב14:00')`, [sid]);

  const m = matrix((await get(SUN, SUN2)).body as PresenceResponse, sid);
  assert.deepEqual(m, {
    [SUN]: 'נוכח', [MON]: 'חופש', [TUE]: 'חופש', [WED]: 'חופש',
    [THU]: 'חזרה ב14:00', [FRI]: 'נוכח', [SAT]: 'נוכח', [SUN2]: 'נוכח',
  });
  await query(`delete from unavailability where soldier_id = $1`, [sid]);
});

test('PUT writes ONE merged row per consecutive same-kind run', async () => {
  const out = await mark('חייל 03', [MON, TUE, WED], 'חופש');
  assert.equal(out.status, 200);
  assert.deepEqual(await stored('חייל 03'),
    [`חופש|${MON} 06:00|${THU} 06:00`]);

  // the echo already reflects the new state
  assert.deepEqual(out.body.days,
    [MON, TUE, WED].map((day) => ({ day, status: 'חופש' })));

  // and so does a fresh GET
  const m = matrix((await get(SUN, SUN2)).body as PresenceResponse, await soldierId('חייל 03'));
  assert.equal(m[MON], 'חופש');
  assert.equal(m[WED], 'חופש');
  assert.equal(m[THU], 'נוכח', 'the run must not bleed onto the return day');
  assert.equal(m[SUN], 'נוכח');
});

test('PUT anchors a Sunday boundary at 08:00', async () => {
  await mark('חייל 04', [SAT, SUN2], 'מחלה');
  assert.deepEqual(await stored('חייל 04'),
    [`מחלה|${SAT} 06:00|2026-07-27 06:00`]);

  await mark('חייל 05', [SUN, MON], 'מחלה');
  assert.deepEqual(await stored('חייל 05'),
    [`מחלה|${SUN} 08:00|${TUE} 06:00`], 'a run STARTING on Sunday leaves at 08:00');
});

test('PUT merges with an adjacent untouched block instead of abutting it', async () => {
  await mark('חייל 06', [SUN, MON], 'חופש');
  assert.equal((await stored('חייל 06')).length, 1);

  await mark('חייל 06', [TUE, WED], 'חופש');
  assert.deepEqual(await stored('חייל 06'),
    [`חופש|${SUN} 08:00|${THU} 06:00`], 'one Sun..Wed row, not two');
});

test('PUT with נוכח splits a block and clears it', async () => {
  await mark('חייל 07', [MON, TUE, WED, THU, FRI], 'חופש');
  assert.equal((await stored('חייל 07')).length, 1);

  await mark('חייל 07', [WED], 'נוכח');
  assert.deepEqual(await stored('חייל 07'), [
    `חופש|${MON} 06:00|${WED} 06:00`,
    `חופש|${THU} 06:00|${SAT} 06:00`,
  ]);

  await mark('חייל 07', [MON, TUE, THU, FRI], 'נוכח');
  assert.deepEqual(await stored('חייל 07'), []);
});

test('PUT replaces a partial-kind row on the day it touches', async () => {
  const sid = await soldierId('חייל 08');
  await query(
    `insert into unavailability (soldier_id, period, kind) values
       ($1, tsrange('${TUE} 06:00','${WED} 00:00'), 'יציאה בבוקר'),
       ($1, tsrange('${THU} 18:00','${FRI} 08:00'), 'יציאה בערב')`, [sid]);

  await mark('חייל 08', [TUE], 'חופש');
  assert.deepEqual(await stored('חייל 08'), [
    `חופש|${TUE} 06:00|${WED} 06:00`,
    `יציאה בערב|${THU} 18:00|${FRI} 08:00`,
  ], 'the touched partial is gone, the untouched one survives');

  await mark('חייל 08', [THU], 'נוכח');
  assert.deepEqual(await stored('חייל 08'), [`חופש|${TUE} 06:00|${WED} 06:00`]);
});

test('PUT accepts the alias spelling and stores the canonical one', async () => {
  await mark('חייל 09', [MON], 'לא מגוייס');
  assert.deepEqual(await stored('חייל 09'), [`לא מגויס|${MON} 06:00|${TUE} 06:00`]);
});

test('PUT is idempotent', async () => {
  await mark('חייל 10', [MON, TUE], 'גיוס');
  const first = await stored('חייל 10');
  await mark('חייל 10', [MON, TUE], 'גיוס');
  assert.deepEqual(await stored('חייל 10'), first);
});

test('PUT rejects a partial kind, an unknown status and a bad body', async () => {
  const sid = await soldierId('חייל 11');
  const partial = await put({ soldier_id: sid, days: [{ day: MON, status: 'יציאה בבוקר' }] });
  assert.equal(partial.status, 400);
  assert.match(partial.body.error, /ימים מלאים/);

  assert.equal((await put({ soldier_id: sid, days: [{ day: MON, status: 'משהו' }] })).status, 400);
  assert.equal((await put({ soldier_id: sid, days: [{ day: '20/07/2026', status: 'חופש' }] })).status, 400);
  assert.equal((await put({ soldier_id: sid, days: [] })).status, 400);
  assert.equal((await put({ days: [{ day: MON, status: 'חופש' }] })).status, 400);
  assert.equal((await put(null)).status, 400);
  assert.equal((await put({ soldier_id: 999999, days: [{ day: MON, status: 'חופש' }] })).status, 404);
  assert.deepEqual(await stored('חייל 11'), [], 'nothing was written');
});

test('an archived soldier is out of the matrix and cannot be edited', async () => {
  const sid = await soldierId('חייל 12');
  await mark('חייל 12', [MON], 'חופש');
  await query(`update soldiers set archived_at = now() where id = $1`, [sid]);

  const b = (await get(SUN, SUN2)).body as PresenceResponse;
  assert.ok(!b.presence.some((p) => p.soldierId === Number(sid)));
  assert.equal((await put({ soldier_id: sid, days: [{ day: TUE, status: 'חופש' }] })).status, 404);

  await query(`update soldiers set archived_at = null where id = $1`, [sid]);
});

test('GET rejects a bad or oversized range; unsupported methods are 405', async () => {
  assert.equal((await get('20/07/2026', SUN2)).status, 400);
  assert.equal((await get(SUN2, SUN)).status, 400);
  assert.equal((await get('2026-01-01', '2026-12-31')).status, 400);
  assert.equal((await call({ method: 'DELETE', query: {} })).status, 405);
});
