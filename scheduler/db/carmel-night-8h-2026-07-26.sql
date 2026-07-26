-- כרמל חטיבה night = ONE 8h window (owner decision 2026-07-26)
--
-- The template carried a 6×4h grid (…, 22:00-02:00, 02:00-06:00) mirroring
-- עמדות הגנה, but the company has never run it that way: every imported day
-- from 28/06/2026 onward writes the night as a single 22:00→06:00 row, manned
-- by exactly the עמדות הגנה 18:00-22:00 crew (verified on 23-26/07). The
-- 22:00-02:00 defense crew gets NO standby window.
--
-- The pre-17/07 template version was already correct (22:00 = 480 min, no
-- 02:00 row); the 4h split arrived with the 2026-07-17 version. So this is a
-- correction applied to that version in place, not a new dated version —
-- nothing in the history it covers was ever really a 4h night.
--
--   SPEC.md §T4a + positions catalog and LOGIC.he.md updated in step.
--   Baseline mirrored in db/seed.sql.
-- Idempotent.

begin;

-- 1. the 22:00 windows (regular + commander seats) become 8h
update slot_templates
   set duration_minutes = 480
 where position_id = 10                    -- כרמל חטיבה
   and start_time = '22:00'
   and duration_minutes <> 480;

-- 2. the 02:00 windows never existed in reality. No seat_overrides reference
--    them (checked); the FK is ON DELETE CASCADE either way.
delete from slot_templates
 where position_id = 10
   and start_time = '02:00';

-- 3. T4a chain: carmel 02:00 ← defense 22:00 is gone with its target window.
--    Rule 5 (carmel 22:00 ← defense 18:00) now feeds the whole 8h night.
delete from chain_rules
 where target_position = 10 and target_start = '02:00';

commit;

-- Verify: 5 windows per sub (06/10/14/18 × 240, 22 × 480), 5 carmel chain rules.
--   select sub_position_id, start_time, duration_minutes, seats, valid_from, valid_to
--     from slot_templates where position_id = 10 order by valid_from, start_time;
--   select id, target_start, source_start from chain_rules
--    where target_position = 10 order by id;
