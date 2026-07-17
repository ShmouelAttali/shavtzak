-- כרמל חטיבה adopts the עמדות הגנה shift grid: 6 × 4h (14,18,22,02,06,10)
-- instead of 4×4h + one 8h night shift. New chain: the עמדות crew descending
-- at 02:00 covers כרמל 02:00-06:00. Takes effect 2026-07-17 (regenerate 17+ to adopt).
begin;

update slot_templates set valid_to = '2026-07-16'
where position_id = 10 and valid_to is null;

insert into slot_templates (position_id, sub_position_id, start_time, duration_minutes, seats, valid_from)
select 10, sp, t.start_time, 240, case sp when 5 then 3 else 1 end, date '2026-07-17'
from (values (5),(6)) s(sp)
cross join (values (time '06:00'),('10:00'),('14:00'),('18:00'),('22:00'),('02:00')) t(start_time);

insert into chain_rules (id, target_position, target_start, source_position, source_start, source_day_offset, pick)
values (6, 10, '02:00', 2, '22:00', 0, 'all')
on conflict do nothing;

commit;
