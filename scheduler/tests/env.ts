// Must be imported FIRST in every test file — db.ts builds its pool from this
// env var at module-load time. Tests run against a dedicated database inside
// the local dev container (never against Supabase).
process.env.SCHEDULER_DATABASE_URL =
  process.env.SCHEDULER_TEST_DATABASE_URL
  ?? 'postgres://postgres:test@localhost:55432/shavtzak_test';
