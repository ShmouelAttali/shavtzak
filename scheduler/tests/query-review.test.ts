// Query review (2026-07-26, db/query-review-2026-07-26.sql) — the schema-side
// guarantees the delta introduced. Everything here is asserted against a
// database freshly built from db/schema.sql, so the baseline is what is tested.
import './env.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshSchema, closePool, query } from './helpers.js';
import { pool } from '../src/db.js';
import { normalizeName } from '../src/text.js';

/** The name-normalization expression indexed by soldiers_name_normalized —
 *  must stay a character-for-character mirror of normalizeName(). Anything
 *  that reads it (api/exit-requests.ts) uses this exact text. */
const NORM_SQL = `btrim(regexp_replace(
  translate(full_name, chr(160) || chr(65279) || '״"׳''\`', '  '),
  '\\s+', ' ', 'g'))`;

/** Same expression over an arbitrary column/alias. */
const normOf = (col: string) => NORM_SQL.replace(/full_name/g, col);

before(async () => { await freshSchema(); });
after(closePool);

test('the new indexes exist with their partial predicates', async () => {
  const rows = await query<{ indexname: string; indexdef: string }>(
    `select indexname, indexdef from pg_indexes
      where schemaname = 'public'
        and indexname in ('seat_overrides_template', 'slot_templates_day_scoped',
                          'soldiers_name_normalized')
      order by indexname`);
  assert.deepEqual(rows.map((r) => r.indexname),
    ['seat_overrides_template', 'slot_templates_day_scoped', 'soldiers_name_normalized']);

  const def = (n: string) => rows.find((r) => r.indexname === n)!.indexdef;
  // The partial predicates are the point: each index covers exactly the rows
  // that are looked up, and slot_templates_day_scoped is the complement of the
  // slot_templates_no_overlap exclusion GiST (whose predicate is the negation),
  // so between them the table is fully covered on position_id.
  assert.match(def('seat_overrides_template'), /WHERE \(slot_template_id IS NOT NULL\)/);
  assert.match(def('slot_templates_day_scoped'), /WHERE \(valid_from = valid_to\)/);
  assert.match(def('slot_templates_day_scoped'), /\(position_id, valid_from\)/);
});

test('exit_requests keeps exactly one (soldier_id, period) gist index', async () => {
  // exit_requests_soldier_period was a byte-for-byte duplicate of the index
  // backing exit_requests_no_overlap; every write paid for both.
  const rows = await query<{ indexname: string }>(
    `select indexname from pg_indexes
      where schemaname = 'public' and tablename = 'exit_requests'
        and indexdef like '%gist%'`);
  assert.deepEqual(rows.map((r) => r.indexname), ['exit_requests_no_overlap'],
    'the exclusion constraint index is the only gist index left');
});

test('the indexed name expression mirrors normalizeName() exactly', async () => {
  // Every character class normalizeName() touches, plus the whitespace
  // characters JS's \s matches and Postgres's does not (NBSP U+00A0, BOM
  // U+FEFF) — those are why the expression TRANSLATES them to a space instead
  // of merely deleting the quote characters.
  // escapes, never literals — these four are invisible in an editor
  const NBSP = '\u00a0', BOM = '\ufeff', THIN = '\u2009', IDEO = '\u3000';
  const cases = [
    'אבי כהן',        // plain Hebrew name
    '  אבי   כהן  ',  // padding + doubled spaces
    'דוד "בן" ג',     // ASCII double quote
    'יוחאי ׳י',       // Hebrew geresh
    'א״ב  ג',         // Hebrew gershayim
    "או'ק",           // ASCII apostrophe
    'back`tick',
    `nbsp${NBSP}here`,
    `bom${BOM}here`,
    `trailing bom${BOM}`,
    `lead${NBSP}${NBSP}trail`,
    'tab\there',
    'new\nline',
    `thin${THIN}space`,
    `ideographic${IDEO}space`,
    '',
  ];
  const rows = await query<{ got: string; want: string }>(
    `select ${normOf('v.x')} as got, v.w as want
       from unnest($1::text[], $2::text[]) v(x, w)`,
    [cases, cases.map(normalizeName)]);
  assert.equal(rows.length, cases.length);
  for (let i = 0; i < rows.length; i++) {
    assert.equal(rows[i].got, rows[i].want,
      `SQL/JS normalization diverged on ${JSON.stringify(cases[i])} — ` +
      'db/schema.sql soldiers_name_normalized and scheduler/src/text.ts ' +
      'normalizeName() must stay in lockstep');
  }
});

test('soldiers_name_normalized is usable for an equality lookup', async () => {
  for (let i = 1; i <= 40; i++) {
    await query(`insert into soldiers (personal_number, full_name, platoon, role, rifle_level)
                 values ($1, $2, '1', 'לוחם', 3)`,
      [`N${i}`, `חייל ${i} א״ב`]);
  }
  await query('analyze soldiers');

  // One connection for the whole block — `set` is session state and the pool
  // hands out an arbitrary client per query(). seqscan is disabled because on a
  // 40-row table the planner picks it regardless; what is being asserted is
  // that the expression is INDEXABLE as written, i.e. that the query text and
  // the stored index expression parse to the same tree.
  const client = await pool.connect();
  let plan: string;
  try {
    await client.query('set enable_seqscan = off');
    const res = await client.query(
      `explain select id from soldiers where ${NORM_SQL} = $1`,
      [normalizeName('חייל 7 א״ב')]);
    plan = res.rows.map((p: Record<string, string>) => p['QUERY PLAN']).join('\n');
  } finally {
    await client.query('set enable_seqscan = on');
    client.release();
  }
  assert.match(plan, /soldiers_name_normalized/,
    `expected an index scan on soldiers_name_normalized, got:\n${plan}`);

  // and it actually resolves a quote-variant spelling (the api/exit-requests.ts
  // fallback, which used to read the whole roster and compare in JS)
  const hit = await query<{ full_name: string }>(
    `select full_name from soldiers where ${NORM_SQL} = $1`,
    [normalizeName('חייל 7 אב')]);
  assert.deepEqual(hit.map((h) => h.full_name), ['חייל 7 א״ב'],
    'a quote-variant spelling resolves through the index');
});
