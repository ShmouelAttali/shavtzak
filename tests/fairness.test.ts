// Handler-level test for api/fairness.ts against the local test database
// (same shavtzak_test DB the scheduler suite uses — never Supabase).
process.env.SCHEDULER_DATABASE_URL =
  process.env.SCHEDULER_TEST_DATABASE_URL
  ?? 'postgres://postgres:test@localhost:55432/shavtzak_test';

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshSchema, seedSoldiers, soldierId, closePool, query } from '../scheduler/tests/helpers.js';
import { generate, persist } from '../scheduler/src/generate.js';
import { getPool } from '../api/_db.js';
import handler from '../api/fairness.js';
import type { FairnessResponse } from '../api/fairness.js';

const D1 = '2026-09-01', D2 = '2026-09-02', D3 = '2026-09-03';

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
  for (const d of [D1, D2, D3]) await persist(await generate(d));
  // manual rest violation on D2: two blocking shifts 2h apart (the rest check
  // ignores non-blocking rows, so clear the soldier's generated day first)
  const sid = await soldierId('חייל 50');
  await query(`delete from shift_assignments where soldier_id = $1 and day = $2`, [sid, D2]);
  for (const [from, to] of [['2026-09-02 14:30', '2026-09-02 15:00'], ['2026-09-02 17:00', '2026-09-02 17:30']]) {
    await query(`
      insert into shift_assignments (day, position_id, soldier_id, period, source, blocks_overlap)
      select $1, p.id, $2, tsrange($3::timestamp, $4::timestamp), 'manual', true
      from positions p where p.name = 'עמדות הגנה'`, [D2, sid, from, to]);
  }
  // 3 consecutive manual nights for another soldier (R6 error, must dedupe to one)
  const nsid = await soldierId('חייל 51');
  for (const [d, next] of [[D1, '2026-09-02'], [D2, '2026-09-03'], [D3, '2026-09-04']]) {
    await query(`
      insert into shift_assignments (day, position_id, soldier_id, period, source, blocks_overlap)
      select $1, p.id, $2, tsrange(($3 || ' 01:00')::timestamp, ($3 || ' 03:00')::timestamp), 'manual', false
      from positions p where p.name = 'סיור'`, [d, nsid, next]);
  }
});
after(async () => {
  await closePool();          // scheduler pool
  await getPool().end();      // api pool
});

test('GET returns compliance findings over the checked window days', async () => {
  const res = await get({ date: '2026-09-04' });
  assert.equal(res.statusCode, 200);
  const body = res.body as FairnessResponse;
  assert.ok(body.rows.length > 0, 'fairness rows exist');
  assert.deepEqual(body.checkedDays, [D1, D2, D3]);
  const rest = body.compliance.filter((f) => f.rule === 'rest' && f.message.includes('חייל 50'));
  assert.ok(rest.some((f) => f.severity === 'error' && f.day === D2), JSON.stringify(rest));
});

test('consecutive_nights findings are deduped to one per soldier', async () => {
  const res = await get({ date: '2026-09-04' });
  const body = res.body as FairnessResponse;
  const sid = await soldierId('חייל 51');
  const nights = body.compliance.filter((f) => f.rule === 'consecutive_nights' && f.soldierId === sid);
  assert.equal(nights.length, 1, JSON.stringify(nights));
  assert.equal(nights[0].severity, 'error');   // worst of the run (3 nights) wins
  assert.equal(nights[0].day, D3);             // latest day of the run
});

test('spread stats exclude soldiers with no service in the window', async () => {
  // a schedulable soldier who never served (e.g. home all week) must not pin
  // the spread min at 0 or drag the average
  await query(`
    insert into soldiers (personal_number, full_name, platoon, is_schedulable)
    values ('9999999', 'חייל בבית', '1', true)
    on conflict (personal_number) do nothing`);
  const res = await get({ date: '2026-09-04' });
  const body = res.body as FairnessResponse;
  const idle = body.rows.find((r) => r.name === 'חייל בבית');
  assert.ok(idle, 'idle soldier row is still returned');
  assert.equal(idle!.weightedHours7d, 0);
  assert.ok(body.spread.weightedHours.min > 0, `min should ignore idle soldiers, got ${body.spread.weightedHours.min}`);
});

test('empty window returns no checked days and no findings', async () => {
  const res = await get({ date: '2027-01-01' });
  assert.equal(res.statusCode, 200);
  const body = res.body as FairnessResponse;
  assert.deepEqual(body.checkedDays, []);
  assert.deepEqual(body.compliance, []);
});
