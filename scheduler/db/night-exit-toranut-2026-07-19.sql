-- H9 night-exit relaxation (owner decision 2026-07-19): a soldier whose
-- approved half-day exit windows for the schedule day ALL fall entirely
-- within 22:00–06:00 (windows 22–02, 02–06, 22–06) may ALSO serve in a
-- night_exit_ok position on his exit day — additively to shift positions.
-- Only תורנים carries the flag; other daily duties and readiness rows stay
-- forbidden (מגן stickiness unchanged). The exit window does not block the
-- daily 14:00–14:00 row — מפקד התורנים covers the night absence internally;
-- the validator emits one exit_night_toranut warning instead of the
-- exit_window/exit_daily errors. Idempotent — safe to re-run. Mirrors
-- db/seed.sql.
update positions set config = config || '{"night_exit_ok": true}'::jsonb
where name = 'תורנים';
