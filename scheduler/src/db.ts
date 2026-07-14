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
