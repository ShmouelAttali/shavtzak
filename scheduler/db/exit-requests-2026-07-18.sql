-- ============================================================================
-- One-off live-DB delta — 2026-07-18 half-day exit requests (H9).
-- Idempotent; mirrors the schema.sql baseline change of the same date.
-- Apply with: docker exec -i shavtzak-pg psql "$URI" < this-file.
-- ============================================================================

begin;

-- Own table — NOT unavailability, which the sheet import truncates and
-- rebuilds; requests must survive re-imports. A row IS an approved exit
-- (auto-approved). The generator merges periods into the blocked windows at
-- load time and packs the soldier's shifts around them.
create table if not exists exit_requests (
  id          bigint generated always as identity primary key,
  soldier_id  bigint not null references soldiers on delete cascade,
  period      tsrange not null check (upper(period) > lower(period)),
  created_by  text,                        -- requester email (audit only)
  created_at  timestamp not null default now(),
  note        text
);
create index if not exists exit_requests_soldier_period
  on exit_requests using gist (soldier_id, period);

do $$ begin
  alter table exit_requests add constraint exit_requests_no_overlap
    exclude using gist (soldier_id with =, period with &&);
exception when duplicate_table or duplicate_object then null;
end $$;

commit;
