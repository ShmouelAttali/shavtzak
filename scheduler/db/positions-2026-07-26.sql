-- New positions that appeared in the sheet on 24-25/07/2026 (one-off live delta;
-- mirrored in the consolidated baseline db/seed.sql). Idempotent.
--
--   משימות שונות — ad-hoc missions written by hand in 'כל השבצק'. The sheet
--     spells each force in the העמדה column ('כח אלישיב', 'כח אמיתי',
--     'כח גלעד', 'כח שאג', 'תפיסת בית', or a bare 'משימות שונות'); those become
--     sub-positions so the force a soldier served in is not lost.
--   חפק2 — the second חפק team (4 soldiers, daily 14:00-14:00), alongside חפק.
--
-- Both are is_scheduled=false: the generator never invents them, but imported
-- rows still occupy the soldier for rest / double-booking / fairness.

insert into positions (id, name, mission_class, is_scheduled, config) values
  (15, 'משימות שונות', 'other', false, '{}'),
  (16, 'חפק2',         'other', false, '{"daily":true,"no_rest_floor":true}')
on conflict (id) do nothing;

insert into sub_positions (id, position_id, name) values
  (11, 15, 'כח אלישיב'),
  (12, 15, 'כח אמיתי'),
  (13, 15, 'כח גלעד'),
  (14, 15, 'כח שאג'),
  (15, 15, 'תפיסת בית'),
  (16, 15, 'משימות שונות')
on conflict (id) do nothing;
