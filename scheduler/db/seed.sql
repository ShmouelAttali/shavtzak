-- ============================================================================
-- Shavtzak Scheduler — seed: current template (as of 2026-07-15) + config
-- Derived from the שבצק tab slot list and the Apps Script rules.
-- ============================================================================

-- ── Positions ───────────────────────────────────────────────────────────────
-- config key `daily: true` = sleeping 14:00–14:00 day duty; it IMPLIES
-- night_exempt + full_rest_after + yomi_display (src/config.ts
-- effectiveConfig). An explicit key overrides the implied value
-- (e.g. תורנים opts out of full_rest_after).
insert into positions (id, name, mission_class, is_scheduled, config) values
  -- סיור: flex 3-4 seats per shift (shrinks to 3 only on soldier shortage);
  -- every crew must include a נהג דוד (H6d hard driver rule)
  ( 1, 'סיור',        'dynamic',   true,  '{"flex_seats":{"min":3,"max":4},"driver_qual":"נהג דוד"}'),
  ( 2, 'עמדות הגנה',  'static',    true,  '{"on_call":true}'),
  -- מגן: flex 10-12 — absorbs surplus soldiers (everyone works, no מנוחה).
  -- no_rest_floor: the crew is scheduled internally by the מגן officer, so a
  -- soldier may join with no rest at all (owner 2026-07-19).
  ( 3, 'מגן',         'other',     true,  '{"daily":true,"continuity":true,"same_platoon":true,"flex_seats":{"min":10,"max":12},"no_rest_floor":true}'),
  -- התקפי: standing 8-soldier readiness crew (14:00-14:00); ad-hoc attack
  -- missions are separate rows and may not overlap the readiness (H3 strict).
  -- Explicit full_rest_after (NOT daily): readiness class, not a yomi duty.
  -- Crew must include a נהג טיגריס (H6d); group_size 4 = two groups of
  -- (1 commander + 3), each preferably from one מחלקה (P5 soft).
  ( 4, 'התקפי',       'readiness', true,  '{"full_rest_after":true,"driver_qual":"נהג טיגריס","group_size":4,"on_call":true}'),
  -- תגבצ: history tombstone (owner decision 2026-07-17) — imported rows
  -- (24/6–16/7) reference it; never scheduled again, no slot templates
  ( 5, 'תגבצ',        'other',     false, '{}'),
  -- Seat-rule metadata only — the named candidate lists are id-based rows in
  -- position_candidates, seeded by seed-candidates.sql AFTER the roster import
  ( 6, 'חפק',         'other',     true,  '{"daily": true, "no_rest_floor": true, "seat_rules": [
      {"sub": "מפקד", "roles": ["מ\"פ", "סמ\"פ"], "commander": true},
      {"sub": "קשר",  "ordered": true, "release_unpicked": true},
      {"sub": "חובש", "qual": "חובש"},
      {"sub": "נהג",  "qual": "נהג דוד"}
    ]}'),
  -- תורנים: mission_class 'other' — outside T2/T3 rotation; soft rule T5:
  -- at most one תורנות per rolling 7 days (ranking preference + validator
  -- warning). Explicit full_rest_after:false — finishing at 14:00 grants no
  -- R5 exemption; the normal R1 regime applies (>= 4h rest, earliest 18:00).
  -- night_exit_ok (H9 relaxation, owner 2026-07-19): a soldier whose exit
  -- windows are ALL within 22:00–06:00 may also serve here on his exit day
  ( 7, 'תורנים',      'other',     true,  '{"daily":true,"full_rest_after":false,"night_exit_ok":true}'),
  ( 8, 'כונן גשש',    'readiness', true,  '{}'),
  -- קצין מוצב: manned ONLY from the fixed candidate list (H6-pool) —
  -- unordered (rotates by fairness); members serve anywhere when not picked.
  -- The pool itself is id-based rows in position_candidates (seed-candidates.sql).
  ( 9, 'קצין מוצב',   'other',     true,  '{"daily":true,"no_rest_floor":true,"candidate_pool":true}'),
  (10, 'כרמל חטיבה',  'readiness', true,  '{}'),
  -- חמל: MANUAL-ONLY (is_scheduled=false) — the generator never auto-fills it;
  -- the dedicated חמל tab places per-shift picks (day-scoped slot_templates +
  -- manual/locked shift_assignments). staff_all_roles still drives חמל-tab auth
  -- (api/admins.ts) and the H6c role whitelist (role חמל → position חמל only).
  (11, 'חמל',         'readiness', false, '{"staff_all_roles":["חמל"]}'),
  (12, 'מנוחה',       'rest',      true,  '{}'),
  (13, 'בבית',        'rest',      true,  '{}'),  -- fully unavailable (H1) — not on base
  -- מפלג: the רס"פ/סרס"פ/מנהלה staff — they do no shifts (role-restricted to
  -- this position, like חמל) but appear in the שבצק when present on base.
  -- Presence follows the מפלג sheet tab's סטטוס (לא מגיע -> is_schedulable=false).
  (14, 'מפלג',        'other',     true,  '{"daily":true,"staff_all_roles":["רס\"פ","סרס\"פ","מנהלה"]}'),
  -- משימות שונות: ad-hoc missions the officers add by hand (the sheet writes
  -- them as 'כח <שם>' / 'תפיסת בית' / 'משימות שונות', all typed משימות שונות).
  -- MANUAL-ONLY (is_scheduled=false): the generator never invents them, but the
  -- imported rows still occupy the soldier (rest, double-booking, fairness).
  -- The individual force is the sub-position.
  (15, 'משימות שונות', 'other',    false, '{}'),
  -- חפק2: the second חפק team (appears from 24/07/2026). Same daily
  -- 14:00-14:00 duty semantics as חפק; manual-only until the owner decides the
  -- generator should staff it (no seat_rules, no candidate lists).
  (16, 'חפק2',        'other',     false, '{"daily":true,"no_rest_floor":true}'),
  -- אחר: catch-all for imported history rows whose position no longer exists
  (99, 'אחר',         'other',     false, '{}');

-- ── Sub-positions ───────────────────────────────────────────────────────────
insert into sub_positions (id, position_id, name) values
  ( 1,  2, 'שג'),
  ( 2,  2, 'בונקר'),
  ( 3,  2, 'מזרחית'),
  ( 4,  2, 'דרומית'),
  ( 5, 10, 'כרמל חטיבה'),
  ( 6, 10, 'מפקד כרמל חטיבה'),   -- commander chosen by highest רובאי (chain rule)
  ( 7,  6, 'מפקד'),              -- חפק seats (H6b seat_rules on the position config)
  ( 8,  6, 'קשר'),
  ( 9,  6, 'חובש'),
  (10,  6, 'נהג'),
  -- משימות שונות: one row per named ad-hoc force, exactly as the sheet spells
  -- it. New force names are added here (or by a delta) as they appear.
  (11, 15, 'כח אלישיב'),
  (12, 15, 'כח אמיתי'),
  (13, 15, 'כח גלעד'),
  (14, 15, 'כח שאג'),
  (15, 15, 'תפיסת בית'),
  (16, 15, 'משימות שונות');   -- unnamed / generic mission row

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

-- מגן: 10 seats, full schedule day 14:00–14:00 (re-anchored effective
-- 2026-07-19 — history days before that ran 06:00–22:00; nothing crosses the
-- day boundary — the continuity crew repeats back-to-back, R5/full_rest_after)
insert into slot_templates (position_id, start_time, duration_minutes, seats, valid_from)
values (3, '14:00', 1440, 10, '2026-07-19');

-- התקפי: 8 seats, full readiness day 14:00–14:00; first seat = commander
-- (H6 hard — a commander mans the standing crew)
insert into slot_templates (position_id, start_time, duration_minutes, seats, commander_first_seat, valid_from)
values (4, '14:00', 1440, 8, true, '2026-07-15');

-- חפק: 4 named seats (מפקד/קשר/חובש/נהג), full schedule day 14:00–14:00
-- (re-anchored effective 2026-07-19; earlier days ran 06:00–22:00)
insert into slot_templates (position_id, sub_position_id, start_time, duration_minutes, seats, valid_from)
select 6, v.sp, '14:00', 1440, 1, date '2026-07-19' from (values (7),(8),(9),(10)) v(sp);

-- תורנים: 2 seats, 14:00–14:00 (full schedule day, aligned with the rotation)
insert into slot_templates (position_id, start_time, duration_minutes, seats, valid_from)
values (7, '14:00', 1440, 2, '2026-07-15');

-- כונן גשש: 3 chained windows (T4c), 1 seat each
insert into slot_templates (position_id, start_time, duration_minutes, seats, valid_from)
values
  (8, '22:00', 540, 1, '2026-07-15'),   -- 22:00–07:00
  (8, '07:00', 420, 1, '2026-07-15'),   -- 07:00–14:00
  (8, '14:00', 480, 1, '2026-07-15');   -- 14:00–22:00

-- חמל: NO permanent slot_template — manual-only, per-shift. The חמל tab writes
-- day-scoped slot_templates (valid_from = valid_to = day) for the windows it
-- shows. Default windows come from the config row below (or the api/hamal.ts
-- hardcoded fallback).

-- קצין מוצב: 1 seat, full schedule day 14:00–14:00 (blocks day)
insert into slot_templates (position_id, start_time, duration_minutes, seats, valid_from)
values (9, '14:00', 1440, 1, '2026-07-15');

-- מפלג: staff crew, full schedule day (seats is a cap — staff_all_roles)
insert into slot_templates (position_id, start_time, duration_minutes, seats, valid_from)
values (14, '14:00', 1440, 6, '2026-07-17');

-- כרמל חטיבה: 3 regular + 1 commander. FIVE windows — four 4h ones on the
-- עמדות הגנה grid plus ONE 8h night, 22:00→06:00 (owner 2026-07-26): the
-- 18:00–22:00 defense crew comes down at 22:00 and holds standby through to
-- 06:00, so the 22:00–02:00 crew gets no standby window at all. A 6×4h grid
-- with a 02:00 window was never real — the whole imported history (28/06
-- onward) writes the night as one 22:00→06:00 row.
insert into slot_templates (position_id, sub_position_id, start_time, duration_minutes, seats, valid_from)
select 10, sp, t.start_time, t.dur, case sp when 5 then 3 else 1 end, date '2026-07-15'
from (values (5),(6)) s(sp)
cross join (values (time '06:00', 240), ('10:00', 240), ('14:00', 240),
                   ('18:00', 240), ('22:00', 480)) t(start_time, dur);

-- ── Chain rules (T4) ────────────────────────────────────────────────────────
-- source_day_offset is relative to the 14:00–14:00 schedule day of the TARGET.
-- T4a: carmel shift at H ← defense-posts crew that finished at H
insert into chain_rules (id, target_position, target_start, source_position, source_start, source_day_offset, pick) values
  ( 1, 10, '06:00', 2, '02:00',  0, 'all'),
  ( 2, 10, '10:00', 2, '06:00',  0, 'all'),
  ( 3, 10, '14:00', 2, '10:00', -1, 'all'),  -- defense 10:00 belongs to previous schedule day
  ( 4, 10, '18:00', 2, '14:00',  0, 'all'),
  ( 5, 10, '22:00', 2, '18:00',  0, 'all'),  -- the 8h night window (22:00→06:00)
-- (id 6, carmel 02:00 ← defense 22:00, removed 2026-07-26: the night is ONE 8h
--  window off the 18:00 crew, so the 22:00–02:00 crew has no standby.)
-- (T4b konenut-from-patrol chains removed: התקפי is a standing Level-1 crew)
-- T4c: tracker window ← one soldier from the descending patrol crew
  ( 9,  8, '22:00', 1, '14:00',  0, 'min_tracker_hours'),  -- ירד ב-22:00 → 22:00–07:00
  (10,  8, '07:00', 1, '22:00',  0, 'min_tracker_hours'),  -- ירד ב-06:00 → 07:00–14:00
  (11,  8, '14:00', 1, '06:00', -1, 'min_tracker_hours');  -- ירד ב-14:00 → 14:00–22:00

-- Note: carmel rules keep pick='all' (whole descending crew fills the shift);
-- the commander seat is then chosen by highest רובאי (generator T4a logic).

-- ── Config ──────────────────────────────────────────────────────────────────
-- ONLY keys the code actually reads (src/config.ts loadTunables +
-- soldier_fairness's readiness_hour_weight). The 14:00 day anchor and the
-- 00:00-06:00 night window are hardcoded mirrors in src/time.ts +
-- db/schema.sql helper functions BY DESIGN — not config rows.
insert into config (key, value) values
  ('readiness_hour_weight', '0.25'),
  ('daily_cap_hours',       '8'),
  ('rest_rules',            '{"minimum_hours":4,"ideal_hours":8,"long_task_hours":4,"gashash_effective_hours":1.5}'),
  -- default חמל shift windows shown by the חמל tab for a virgin day (the tab
  -- writes day-scoped slot_templates only when a day differs from these or has
  -- picks). api/hamal.ts has the same hardcoded fallback.
  ('hamal_default_shifts',  '[{"start":"10:00","end":"18:00"},{"start":"18:00","end":"02:00"},{"start":"02:00","end":"10:00"}]');
