-- ============================================================================
-- Shavtzak Scheduler — seed: current template (as of 2026-07-15) + config
-- Derived from the שבצק tab slot list and the Apps Script rules.
-- ============================================================================

-- ── Positions ───────────────────────────────────────────────────────────────
insert into positions (id, name, mission_class, is_scheduled, blocks_day, config) values
  ( 1, 'סיור',        'dynamic',   true,  false, '{}'),
  ( 2, 'עמדות הגנה',  'static',    true,  false, '{}'),
  ( 3, 'מגן',  'other',     true,  true,  '{"package":"magen_tagbatz","continuity":true,"same_platoon":true,"yomi_display":true}'),
  -- התקפי: standing 8-soldier readiness crew (14:00-14:00) that also staffs
  -- the תגבצ windows and executes ad-hoc attack missions
  ( 4, 'התקפי',       'readiness', true,  true,  '{"open_for_attack":true,"covers":["תגבצ"]}'),
  ( 5, 'תגבצ',        'dynamic',   false, false, '{"staffed_by":"התקפי"}'),  -- disabled for now (is_scheduled=false)
  ( 6, 'חפק',         'other',     true,  true,  '{"seat_rules": [
      {"sub": "מפקד", "roles": ["מ\"פ", "סמ\"פ"], "commander": true},
      {"sub": "קשר",  "soldiers": ["יהודה חושן", "אור חיים בלונדר", "יחיעם אושפיזאי"], "ordered": true, "release_unpicked": true},
      {"sub": "חובש", "soldiers": ["כפיר לנדסמן", "שחר מיכאלי"]},
      {"sub": "נהג",  "soldiers": ["אמיר יונייב", "יאיר מובשוביץ"]}
    ], "yomi_display": true}'),
  ( 7, 'תורנים',      'static',    true,  true,  '{"night_exempt":true}'),
  ( 8, 'כונן גשש',    'readiness', true,  false, '{"tracker":true}'),
  ( 9, 'קצין מוצב',   'other',     true,  true,  '{"night_exempt":true}'),
  (10, 'כרמל חטיבה',  'readiness', true,  false, '{}'),
  -- חמל: standing crew — every present role-חמל soldier staffs it daily,
  -- full schedule day; readiness class = rest-transparent (internal shifts)
  (11, 'חמל',         'readiness', true,  false, '{"staff_all_roles":["חמל"]}'),
  (12, 'מנוחה',       'rest',      true,  false, '{}'),
  (13, 'בבית',        'rest',      true,  false, '{}');  -- fully unavailable (H1) — not on base

-- ── Sub-positions ───────────────────────────────────────────────────────────
insert into sub_positions (id, position_id, name, required_role) values
  ( 1,  2, 'שג',                null),
  ( 2,  2, 'בונקר',             null),
  ( 3,  2, 'מזרחית',            null),
  ( 4,  2, 'דרומית',            null),
  ( 5, 10, 'כרמל חטיבה',        null),
  ( 6, 10, 'מפקד כרמל חטיבה',   null),   -- commander chosen by highest רובאי (chain rule)
  ( 7,  6, 'מפקד',              null),   -- חפק seats (H6b seat_rules on the position config)
  ( 8,  6, 'קשר',               null),
  ( 9,  6, 'חובש',              null),
  (10,  6, 'נהג',               null);

-- ── Slot templates (valid from 2026-07-15) ──────────────────────────────────
-- סיור: 3 shifts × 8h × 4 seats, first seat = commander
insert into slot_templates (position_id, sub_position_id, start_time, duration_minutes, seats, commander_first_seat, valid_from)
values
  (1, null, '06:00', 480, 4, true, '2026-07-15'),
  (1, null, '14:00', 480, 4, true, '2026-07-15'),
  (1, null, '22:00', 480, 4, true, '2026-07-15');

-- עמדות הגנה: 4 posts × 6 shifts × 4h
insert into slot_templates (position_id, sub_position_id, start_time, duration_minutes, seats, commander_first_seat, valid_from)
select 2, sp.id, t.start_time, 240, 1, false, date '2026-07-15'
from (values (1),(2),(3),(4)) sp(id)
cross join (values (time '06:00'),('10:00'),('14:00'),('18:00'),('22:00'),('02:00')) t(start_time);

-- מגן: 10 seats, 06:00–22:00
insert into slot_templates (position_id, start_time, duration_minutes, seats, valid_from)
values (3, '06:00', 960, 10, '2026-07-15');

-- התקפי: 8 seats, full readiness day 14:00–14:00 (crew also staffs תגבצ windows)
insert into slot_templates (position_id, start_time, duration_minutes, seats, valid_from)
values (4, '14:00', 1440, 8, '2026-07-15');

-- תגבצ: 06:30–09:00 and 17:00–22:00, 8 seats each, first seat = commander
insert into slot_templates (position_id, start_time, duration_minutes, seats, commander_first_seat, valid_from)
values
  (5, '06:30', 150, 8, true, '2026-07-15'),
  (5, '17:00', 300, 8, true, '2026-07-15');

-- חפק: 4 named seats (מפקד/קשר/חובש/נהג), 06:00–22:00, 1 seat each
insert into slot_templates (position_id, sub_position_id, start_time, duration_minutes, seats, valid_from)
select 6, v.sp, '06:00', 960, 1, date '2026-07-15' from (values (7),(8),(9),(10)) v(sp);

-- תורנים: 2 seats, 14:00–14:00 (full schedule day, aligned with the rotation)
insert into slot_templates (position_id, start_time, duration_minutes, seats, valid_from)
values (7, '14:00', 1440, 2, '2026-07-15');

-- כונן גשש: 3 chained windows (T4c), 1 seat each
insert into slot_templates (position_id, start_time, duration_minutes, seats, valid_from)
values
  (8, '22:00', 540, 1, '2026-07-15'),   -- 22:00–07:00
  (8, '07:00', 420, 1, '2026-07-15'),   -- 07:00–14:00
  (8, '14:00', 480, 1, '2026-07-15');   -- 14:00–22:00

-- חמל: full schedule day, up to 5 present role-חמל soldiers
insert into slot_templates (position_id, start_time, duration_minutes, seats, valid_from)
values (11, '14:00', 1440, 5, '2026-07-15');

-- קצין מוצב: 1 seat, full schedule day 14:00–14:00 (blocks day)
insert into slot_templates (position_id, start_time, duration_minutes, seats, valid_from)
values (9, '14:00', 1440, 1, '2026-07-15');

-- כרמל חטיבה: 3 regular + 1 commander × 6 shifts × 4h (same grid as עמדות הגנה)
insert into slot_templates (position_id, sub_position_id, start_time, duration_minutes, seats, valid_from)
select 10, sp, t.start_time, 240, case sp when 5 then 3 else 1 end, date '2026-07-15'
from (values (5),(6)) s(sp)
cross join (values (time '06:00'),('10:00'),('14:00'),('18:00'),('22:00'),('02:00')) t(start_time);

-- ── Chain rules (T4) ────────────────────────────────────────────────────────
-- source_day_offset is relative to the 14:00–14:00 schedule day of the TARGET.
-- T4a: carmel shift at H ← defense-posts crew that finished at H
insert into chain_rules (id, target_position, target_start, source_position, source_start, source_day_offset, pick) values
  ( 1, 10, '06:00', 2, '02:00',  0, 'all'),
  ( 2, 10, '10:00', 2, '06:00',  0, 'all'),
  ( 3, 10, '14:00', 2, '10:00', -1, 'all'),  -- defense 10:00 belongs to previous schedule day
  ( 4, 10, '18:00', 2, '14:00',  0, 'all'),
  ( 5, 10, '22:00', 2, '18:00',  0, 'all'),
  ( 6, 10, '02:00', 2, '22:00',  0, 'all'),
-- (T4b konenut-from-patrol chains removed: התקפי is a standing Level-1 crew)
-- T4c: tracker window ← one soldier from the descending patrol crew
  ( 9,  8, '22:00', 1, '14:00',  0, 'min_tracker_hours'),  -- ירד ב-22:00 → 22:00–07:00
  (10,  8, '07:00', 1, '22:00',  0, 'min_tracker_hours'),  -- ירד ב-06:00 → 07:00–14:00
  (11,  8, '14:00', 1, '06:00', -1, 'min_tracker_hours');  -- ירד ב-14:00 → 14:00–22:00

-- Note: carmel rules keep pick='all' (whole descending crew fills the shift);
-- the commander seat is then chosen by highest רובאי — see config key
-- 'carmel_commander_rule' below.

-- ── Config defaults ─────────────────────────────────────────────────────────
insert into config (key, value) values
  ('day_anchor',            '"14:00"'),
  ('night_window',          '{"start":"00:00","end":"06:00"}'),
  ('readiness_hour_weight', '0.25'),
  ('daily_cap_hours',       '8'),
  ('rest_rules',            '{"minimum_hours":4,"ideal_hours":8,"long_task_hours":4,"tracker_effective_hours":1.5}'),
  ('blocking_kinds',        '["חופש","לא מגויס","יציאה","מחלה","שחרור"]'),
  ('excluded_keywords',     '["מפלג","חמל"]'),
  ('carmel_commander_rule', '"highest_rifle"'),
  ('carmel_min_staffing',   '{"regular":3,"commander":1}'),
  ('priority_list',         '["hard_constraints","night_count_7d","weighted_hours_7d","rotation","role_fit","rest_since_last"]'),
  ('scoring_weights',       '{
      "weekly_weighted_hours": 1.4,
      "weekly_night_count":    7,
      "short_rest":            28,
      "same_class_yesterday":  18,
      "static_streak_penalty": 55,
      "static_streak_break_bonus": -25,
      "commander_needed_bonus": -26,
      "commander_missing_penalty": 90,
      "tiger_driver_needed_bonus": -35,
      "tiger_driver_missing_penalty": 100,
      "dud_driver_night_bonus": -16,
      "fallback_base_penalty": 400
   }');
