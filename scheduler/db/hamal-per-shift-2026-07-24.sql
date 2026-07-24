-- ── חמל per-shift staffing (2026-07-24) ─────────────────────────────────────
-- One-off delta for the live Supabase DB; the consolidated baseline
-- (db/schema.sql) already carries the same definition for fresh builds.
--
-- The חמל tab can now split a day into named shift windows and pick a distinct
-- crew per shift (owner decision 2026-07-24). The 3 default windows
-- (14:00-22:00, 22:00-06:00, 06:00-14:00) are IMPLICIT — the config row
-- `hamal_default_shifts` (+ a hardcoded fallback in api/hamal.ts) defines them,
-- and a day stores rows here ONLY when its shift list is CUSTOMIZED away from
-- the defaults.
--
--   position_day_shifts — the per-day, per-position shift STRUCTURE override.
--     Rows exist for (day, position) ⇒ they REPLACE the defaults that day.
--     No rows ⇒ the position uses its defaults. An empty custom shift (a window
--     with nobody assigned) still persists here, so it survives a reload.
--     end_time <= start_time ⇒ the window crosses midnight (ends next day).
--
-- The picks themselves stay ordinary shift_assignments rows (position חמל,
-- source='manual', locked=true, blocks_overlap=false) EXCEPT `period` is the
-- concrete shift window (computed like the day_slots lateral) instead of the
-- whole 14:00→14:00 day. seat_index restarts at 1 per shift. A חמל pick still
-- reserves the soldier for the whole schedule day via a locked day_assignments
-- bucket (owner D2), so they are not seated elsewhere. Manual חמל rows keep
-- blocks_overlap=false, so overlapping windows never trip no_double_booking.

begin;

create table if not exists position_day_shifts (
  day         date     not null references schedule_days,
  position_id smallint not null references positions,
  start_time  time     not null,
  end_time    time     not null,          -- end <= start ⇒ crosses midnight
  primary key (day, position_id, start_time)
);

commit;
