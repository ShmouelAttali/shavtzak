import pg from 'pg';

// Connection: SCHEDULER_DATABASE_URL env var, defaults to the local dev container
// (docker run --name shavtzak-pg -p 55432:5432 ... postgres:16, see README).
const url = process.env.SCHEDULER_DATABASE_URL
  ?? 'postgres://postgres:test@localhost:55432/postgres';

export const pool = new pg.Pool({
  connectionString: url,
  max: 10,                                  // pg's own default, pinned explicitly
  application_name: 'shavtzak-scheduler',   // identifies us in pg_stat_activity
});

// The Supabase pooler hangs up idle clients. node-postgres surfaces that as an
// 'error' event on the POOL (not on any query), and an EventEmitter 'error'
// with no listener is re-thrown as an uncaught exception — which would take
// down the CLI run or the serverless function mid-flight. The pool discards the
// broken client and opens a fresh one on the next checkout; we only log.
pool.on('error', (err) => {
  console.error('pg pool: idle client error (client discarded):', err.message);
});

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string, params: unknown[] = [],
): Promise<T[]> {
  const res = await pool.query<T>(text, params);
  return res.rows;
}

/**
 * A `YYYY-MM-DD` date as a quoted SQL literal, for the multiQuery batches
 * (the simple query protocol takes no bind parameters, so day boundaries have
 * to be inlined). Throws on anything that is not exactly a plain ISO date —
 * validation at the POINT OF USE, so a new interpolation can't quietly skip
 * the entry-point regex in loadContext()/validateDay(). Those regexes stay as
 * the outer guard; this is the inner one.
 */
export function litDate(s: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error(`bad date literal: ${s}`);
  return `'${s}'`;
}

/** Run several statements in ONE round trip (no params allowed — inline
 *  validated literals only, see litDate). Returns one rows-array per statement. */
export async function multiQuery(statements: string[]): Promise<pg.QueryResultRow[][]> {
  const res = await pool.query(statements.join(';\n'));
  const results = Array.isArray(res) ? res : [res];
  return results.map((r) => r.rows);
}
