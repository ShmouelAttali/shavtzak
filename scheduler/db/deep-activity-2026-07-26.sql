-- ============================================================================
-- Delta 2026-07-26: position 'פעילות עומק' (deep activity) + its team
-- sub-positions.
--
-- The sheet's כל השבצק tab started writing a deep-activity block on sheet date
-- 27/07/2026 (schedule day 26/07): סוג='פעילות עומק', העמדה = the team
-- ('צוות א' / 'צוות ב' / 'נהג טיגריס'), a bare 00:00 time. Owner decision
-- 2026-07-26: this is its own position (not a sub-position of משימות שונות)
-- and the window runs 00:00 → 14:00.
--
-- MANUAL-ONLY (is_scheduled=false): the generator never invents it, but the
-- imported rows still occupy the soldier for rest, double-booking and fairness.
--
-- Mirrored in db/seed.sql (positions id 17, sub_positions 17-19). Idempotent.
-- ============================================================================

insert into positions (id, name, mission_class, is_scheduled, config) values
  (17, 'פעילות עומק', 'other', false, '{}')
on conflict (id) do nothing;

insert into sub_positions (id, position_id, name) values
  (17, 17, 'צוות א'),
  (18, 17, 'צוות ב'),
  (19, 17, 'נהג טיגריס')
on conflict (id) do nothing;
