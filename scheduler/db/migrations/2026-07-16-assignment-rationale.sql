-- Structured per-assignment rationale ("why was this soldier picked"),
-- captured by the generator at decision time as {code, params} entries
-- (catalog + Hebrew templates: scheduler/src/rationale.ts).
-- Old rows read as '[]' — the UI shows a "no stored explanation" note.

alter table shift_assignments
  add column if not exists rationale jsonb not null default '[]';
