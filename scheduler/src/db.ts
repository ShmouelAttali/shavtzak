import pg from 'pg';

// Connection: SCHEDULER_DATABASE_URL env var, defaults to the local dev container
// (docker run --name shavtzak-pg -p 55432:5432 ... postgres:16, see README).
const url = process.env.SCHEDULER_DATABASE_URL
  ?? 'postgres://postgres:test@localhost:55432/postgres';

export const pool = new pg.Pool({ connectionString: url });

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string, params: unknown[] = [],
): Promise<T[]> {
  const res = await pool.query<T>(text, params);
  return res.rows;
}

/** Run several statements in ONE round trip (no params allowed — inline
 *  validated literals only). Returns one rows-array per statement. */
export async function multiQuery(statements: string[]): Promise<pg.QueryResultRow[][]> {
  const res = await pool.query(statements.join(';\n'));
  const results = Array.isArray(res) ? res : [res];
  return results.map((r) => r.rows);
}
