import pg from 'pg';

// Scheduler DB (Supabase Postgres). Underscore-prefixed file: not exposed as a route.
// SCHEDULER_DATABASE_URL = session-pooler URI, see scheduler/README.md.
let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (!pool) {
    const url = process.env.SCHEDULER_DATABASE_URL;
    if (!url) throw new Error('SCHEDULER_DATABASE_URL not set');
    pool = new pg.Pool({ connectionString: url, max: 3 });
  }
  return pool;
}

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
