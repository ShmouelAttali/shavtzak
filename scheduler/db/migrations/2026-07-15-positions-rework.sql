-- Positions rework (user review 2026-07-15):
-- 1. seat_overrides: per-position per-date seat counts (seats PER SLOT).
-- 2. Merge כוננות (4) + התקפי (13) into one position: התקפי — an 8-soldier
--    standing readiness crew (14:00-14:00) that also staffs the תגבצ windows
--    and executes ad-hoc attack missions.
-- 3. תגבצ is staffed by the התקפי crew (config.staffed_by) — no own Level-1 crew.
-- 4. מגן + תגבצ: continuity + same-platoon crew (config flags).
-- 5. Konenut-from-patrol chain rules removed (standing crew replaces T4b).

begin;

create table if not exists seat_overrides (
  id          smallint generated always as identity primary key,
  position_id smallint not null references positions,
  valid_from  date not null,
  seats       smallint not null,
  note        text,
  unique (position_id, valid_from)
);

-- merge position 13 (old ad-hoc התקפי) into 4 (old כוננות)
update shift_assignments set position_id = 4 where position_id = 13;
delete from chain_rules where target_position in (4, 13) or source_position = 13;
delete from slot_templates where position_id = 13;
delete from positions where id = 13;
update positions set
  name = 'התקפי',
  mission_class = 'readiness',
  blocks_day = true,
  config = '{"open_for_attack": true, "covers": ["תגבצ"]}'
where id = 4;

-- תגבצ: staffed by the התקפי crew, keeps its own slot windows
update positions set config = config || '{"staffed_by": "התקפי"}' where id = 5;

-- מגן + תגבצ: same platoon, day-to-day continuity
update positions set config = config || '{"continuity": true, "same_platoon": true}' where id = 3;

commit;

-- day_slots now resolves seat_overrides (latest valid_from <= day wins)
create or replace view day_slots as
select sd.day,
       st.id  as slot_template_id,
       st.position_id,
       st.sub_position_id,
       tsrange(sd.day::timestamp + st.start_time::interval
               + case when st.start_time < time '14:00' then interval '1 day' else interval '0' end,
               sd.day::timestamp + st.start_time::interval
               + case when st.start_time < time '14:00' then interval '1 day' else interval '0' end
               + make_interval(mins => st.duration_minutes)) as period,
       coalesce((select o.seats from seat_overrides o
                 where o.position_id = st.position_id and o.valid_from <= sd.day
                 order by o.valid_from desc limit 1),
                st.seats) as seats,
       st.commander_first_seat
from schedule_days sd
join slot_templates st
  on sd.day >= st.valid_from and (st.valid_to is null or sd.day <= st.valid_to);

-- 2026-07-15 (later): rename the position to just מגן
update positions set name = 'מגן' where id = 3;
