import pg from 'pg';

// Scheduler DB (Supabase Postgres). Underscore-prefixed file: not exposed as a route.
// SCHEDULER_DATABASE_URL = session-pooler URI, see scheduler/README.md.
let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (!pool) {
    const url = process.env.SCHEDULER_DATABASE_URL;
    if (!url) throw new Error('SCHEDULER_DATABASE_URL not set');
    pool = new pg.Pool({
      connectionString: url,
      max: 3,
      // Serverless: the pooler drops idle connections anyway — release them
      // ourselves rather than handing out a dead socket on the next request.
      idleTimeoutMillis: 30_000,
      // Never let a request hang forever waiting for a connection.
      connectionTimeoutMillis: 10_000,
    });
    // An idle client erroring out (pooler restart, network drop) emits on the
    // POOL, and an unhandled 'error' there takes the whole function down. pg
    // removes the broken client by itself; we only have to not crash.
    pool.on('error', (err) => console.error('pg pool error (idle client):', err));
  }
  return pool;
}

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
