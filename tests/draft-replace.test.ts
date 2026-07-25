// Handler-level tests for the manual replacement in api/draft.ts (PUT):
// the officer clicks a soldier in the צור שבצק tab and swaps him for another.
// The swap must (a) hit exactly the clicked slot (identified by day + soldier
// + the slot's rendered time label), (b) leave a locked/manual row so
// regeneration re-seats the replacement at the SAME position+period+seat
// (ctx.lockedShift in scheduler/src/level2.ts) and pins his Level-1 bucket
// (ctx.lockedDay in level1.ts), and (c) refuse swaps the DB/rules forbid.
process.env.SCHEDULER_DATABASE_URL =
  process.env.SCHEDULER_TEST_DATABASE_URL
  ?? 'postgres://postgres:test@localhost:55432/shavtzak_test';

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshSchema, seedSoldiers, closePool, query } from '../scheduler/tests/helpers.js';
import { getPool } from '../api/_db.js';
import draftHandler from '../api/draft.js';
import type { DraftResponse, ReplaceResponse } from '../api/draft.js';

const D = '2026-09-08';

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
  await draftHandler(req as any, res as any);
  return res;
};
const getDay = async (): Promise<DraftResponse> =>
  (await call({ method: 'GET', query: { from: D, to: D } })).body as DraftResponse;

interface Row {
  id: string; soldier_id: string; full_name: string; position_id: number; pos_name: string;
  seat_index: number; source: string; locked: boolean; rationale: any; lo: string; hi: string;
}
const rowsOf = (name?: string) => query<Row>(`
  select sa.id, sa.soldier_id, s.full_name, sa.position_id, p.name pos_name, sa.seat_index,
         sa.source, sa.locked, sa.rationale,
         to_char(lower(sa.period),'YYYY-MM-DD HH24:MI') lo,
         to_char(upper(sa.period),'YYYY-MM-DD HH24:MI') hi
  from shift_assignments sa
  join positions p on p.id = sa.position_id
  join soldiers s on s.id = sa.soldier_id
  where sa.day = $1 ${name ? 'and s.full_name = $2' : ''}
  order by lower(sa.period), p.id, sa.seat_index`, name ? [D, name] : [D]);

/** An assignment to click on, taken from the GET response exactly as the
 *  popup takes it — (name, time label) — narrowed to soldiers holding a
 *  SINGLE row that day so the label maps to one unambiguous row. Returns the
 *  row itself plus a soldier who is free during its window. */
async function pickTarget(opts: { needFree?: boolean } = {}) {
  const { days } = await getDay();
  const day = days[0];
  for (const g of day.groups) {
    for (const sub of g.subTypes) {
      for (const slot of sub.times) {
        for (const name of slot.soldiers) {
          if (name === 'לא מאויש') continue;
          const rows = await rowsOf(name);
          if (rows.length !== 1 || rows[0].source === 'manual') continue;
          const row = rows[0];
          const free = await query<{ id: string; full_name: string }>(`
            select s.id, s.full_name from soldiers s
            where not exists (
              select 1 from shift_assignments sa
              where sa.soldier_id = s.id and sa.blocks_overlap
                and sa.period && tsrange($1::timestamp, $2::timestamp))
            order by s.full_name limit 1`, [row.lo, row.hi]);
          if (free.length || opts.needFree === false) {
            return { day, name, time: slot.time, row, free: free[0] };
          }
        }
      }
    }
  }
  throw new Error('no replaceable assignment found in the generated day');
}

before(async () => {
  await freshSchema();
  await seedSoldiers();
  const res = await call({ method: 'POST', body: { day: D }, query: {} });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
});
after(async () => {
  await closePool();
  await getPool().end();
});

test('GET /api/draft returns the picker roster with roles + qualifications', async () => {
  const { roster } = await getDay();
  assert.ok(roster.length >= 60, `roster size ${roster.length}`);
  const driver = roster.find((s) => s.name === 'חייל 11');
  assert.ok(driver, 'נהג דוד in roster');
  assert.deepEqual(driver!.quals, ['נהג דוד']);
  assert.ok(roster.some((s) => s.role === 'מ"כ'), 'commanders carry their role');
  assert.ok(roster.every((s) => typeof s.id === 'number' && s.id > 0), 'ids present');
});

test('PUT swaps the clicked slot only, locked+manual, with a manual_replace rationale', async () => {
  const { name, time, row: target, free } = await pickTarget();

  const res = await call({
    method: 'PUT', query: {},
    body: { day: D, time, fromSoldierId: Number(target.soldier_id), toSoldierId: Number(free.id) },
  });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.ok((res.body as ReplaceResponse).updated >= 1);

  // the row is now the replacement's — same seat, same window, same position
  const after = await rowsOf(free.full_name);
  const moved = after.find((r) => r.id === target.id);
  assert.ok(moved, 'the very same row now belongs to the replacement');
  assert.equal(moved!.position_id, target.position_id);
  assert.equal(moved!.seat_index, target.seat_index);
  assert.equal(moved!.lo, target.lo);
  assert.equal(moved!.hi, target.hi);
  assert.equal(moved!.source, 'manual');
  assert.equal(moved!.locked, true);
  assert.deepEqual(moved!.rationale, [{ code: 'manual_replace', params: { from: name } }]);

  // the outgoing soldier no longer holds it, and his other rows are untouched
  const left = await rowsOf(name);
  assert.ok(!left.some((r) => r.id === target.id), 'outgoing released the slot');

  // Level-1 pin: the replacement's day bucket is the position, locked+manual
  const bucket = await query<{ position_id: number; source: string; locked: boolean }>(
    `select position_id, source, locked from day_assignments
     where day = $1 and soldier_id = $2`, [D, free.id]);
  assert.equal(bucket[0]?.position_id, target.position_id);
  assert.equal(bucket[0]?.source, 'manual');
  assert.equal(bucket[0]?.locked, true);
});

test('regeneration keeps the manual row at the same position, window and seat', async () => {
  const manual = (await rowsOf()).filter((r) => r.source === 'manual');
  assert.ok(manual.length, 'a manual row exists from the previous test');
  const res = await call({ method: 'POST', body: { day: D }, query: {} });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));

  const after = await rowsOf();
  for (const m of manual) {
    const same = after.find((r) => r.soldier_id === m.soldier_id && r.position_id === m.position_id
      && r.lo === m.lo && r.hi === m.hi && r.seat_index === m.seat_index);
    assert.ok(same, `manual row survived regeneration: ${m.full_name} ${m.pos_name} ${m.lo}`);
    assert.equal(same!.source, 'manual');
    assert.equal(same!.locked, true);
  }
  // and he was not ALSO seated somewhere else in the same window (level2's
  // lockedInSlot + the loaded `existing` rows keep him busy)
  for (const m of manual) {
    const dupes = after.filter((r) => r.soldier_id === m.soldier_id && r.lo === m.lo && r.hi === m.hi);
    assert.equal(dupes.length, 1, `${m.full_name} seated once in ${m.lo}`);
  }
});

test('PUT refuses a soldier already booked in the window, and an unknown slot', async () => {
  const { time, row: target } = await pickTarget({ needFree: false });
  // someone else holding a blocking row over the same window
  const clash = await query<{ soldier_id: string }>(`
    select sa.soldier_id from shift_assignments sa
    where sa.day = $1 and sa.blocks_overlap and sa.soldier_id <> $2
      and sa.period && tsrange($3::timestamp, $4::timestamp) limit 1`,
    [D, target.soldier_id, target.lo, target.hi]);
  assert.ok(clash.length, 'someone else is on shift during that window');
  const res = await call({
    method: 'PUT', query: {},
    body: { day: D, time, fromSoldierId: Number(target.soldier_id), toSoldierId: Number(clash[0].soldier_id) },
  });
  assert.equal(res.statusCode, 409, JSON.stringify(res.body));

  const bogus = await call({
    method: 'PUT', query: {},
    body: { day: D, time: '03:00-04:00', fromSoldierId: Number(target.soldier_id), toSoldierId: Number(target.soldier_id) + 1 },
  });
  assert.equal(bogus.statusCode, 404, JSON.stringify(bogus.body));
});

test('PUT on a published day → 409', async () => {
  await query(`update schedule_days set status = 'published' where day = $1`, [D]);
  const target = (await rowsOf())[0];
  const res = await call({
    method: 'PUT', query: {},
    body: { day: D, time: 'יומי', fromSoldierId: Number(target.soldier_id), toSoldierId: Number(target.soldier_id) + 1 },
  });
  assert.equal(res.statusCode, 409, JSON.stringify(res.body));
  await query(`update schedule_days set status = 'generated' where day = $1`, [D]);
});
