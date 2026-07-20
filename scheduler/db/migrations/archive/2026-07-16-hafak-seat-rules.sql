-- חפק rework (H6b): 4 named seats — מפקד / קשר / חובש / נהג.
-- Each seat has a dedicated candidate list (soldiers by name, or roles for
-- מפקד). Candidates are reserved for חפק only; קשר releases its unchosen
-- candidates back to the pool. A seat with no available candidate stays empty.
-- Takes effect 2026-07-17; published days keep the old 4-seat template.
begin;

insert into sub_positions (id, position_id, name, required_role) values
  (7, 6, 'מפקד', null),
  (8, 6, 'קשר',  null),
  (9, 6, 'חובש', null),
  (10, 6, 'נהג', null)
on conflict do nothing;

update slot_templates set valid_to = '2026-07-16'
where position_id = 6 and sub_position_id is null and valid_to is null;

insert into slot_templates (position_id, sub_position_id, start_time, duration_minutes, seats, valid_from)
select 6, v.sp, '06:00', 960, 1, date '2026-07-17'
from (values (7),(8),(9),(10)) v(sp);

update positions set config = config || '{
  "seat_rules": [
    {"sub": "מפקד", "roles": ["מ\"פ", "סמ\"פ"], "commander": true},
    {"sub": "קשר",  "soldiers": ["יהודה חושן", "אור חיים בלונדר", "יחיעם אושפיזאי"], "ordered": true, "release_unpicked": true},
    {"sub": "חובש", "soldiers": ["כפיר לנדסמן", "שחר מיכאלי"]},
    {"sub": "נהג",  "soldiers": ["אמיר יונייב", "יאיר מובשוביץ"]}
  ]
}'::jsonb
where id = 6;

commit;
