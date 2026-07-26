// persist() options + the schedule_days snapshot it writes:
//   * { storeReport: false } (cli's --no-report) must NOT write report_html
//   * the default still does, and validation rides the SAME update statement
//   * generated_at is Asia/Jerusalem wall-clock, not the server's UTC now()
import './env.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshSchema, seedSoldiers, closePool, query } from './helpers.js';
import { generate, persist } from '../src/generate.js';
import { chunked, MAX_ROWS_PER_INSERT, PARAMS_PER_SHIFT_ROW } from '../src/persist.js';

const D1 = '2026-08-04', D2 = '2026-08-05';

before(async () => {
  await freshSchema();
  await seedSoldiers();
});
after(closePool);

const snapshot = (day: string) => query<{ has_report: boolean; findings: number; drift: number }>(`
  select report_html is not null has_report,
         coalesce(jsonb_array_length(validation), -1) findings,
         extract(epoch from (generated_at - timezone('Asia/Jerusalem', now())))::float drift
  from schedule_days where day = $1`, [day]);

test('storeReport: false skips report_html but still stores the validation snapshot', async () => {
  await persist(await generate(D1), { storeReport: false });
  const [row] = await snapshot(D1);
  assert.equal(row.has_report, false, '--no-report must leave report_html null');
  assert.ok(row.findings >= 0, 'validation snapshot is written regardless of the report');
});

test('default persist() stores both report_html and validation', async () => {
  const findings = await persist(await generate(D2));
  const [row] = await snapshot(D2);
  assert.equal(row.has_report, true);
  assert.equal(row.findings, findings.length,
    'the stored validation is the same array persist() returns');
});

test('generated_at is Asia/Jerusalem wall-clock (schema-wide convention), not UTC', async () => {
  const [row] = await snapshot(D2);
  // the test container runs on UTC, so a bare now() would land ~3h off
  assert.ok(Math.abs(row.drift) < 300,
    `generated_at drifts ${row.drift}s from Asia/Jerusalem wall-clock`);
});

test('the insert chunk stays inside the 65535 bind-parameter wire limit', () => {
  assert.ok(MAX_ROWS_PER_INSERT * PARAMS_PER_SHIFT_ROW + 1 <= 65535,
    'a full chunk must fit in one extended-protocol bind message');
});

test('chunked() splits only past the limit and preserves order + every row', () => {
  assert.deepEqual(chunked([]), [], 'no rows = no statement at all');
  assert.deepEqual(chunked([1, 2, 3]), [[1, 2, 3]], 'a small batch stays one statement');
  const rows = Array.from({ length: 2500 }, (_, i) => i);
  const parts = chunked(rows, 1000);
  assert.deepEqual(parts.map((p) => p.length), [1000, 1000, 500]);
  assert.deepEqual(parts.flat(), rows, 'chunking must not drop or reorder rows');
});
