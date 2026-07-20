-- 2026-07-19: seat_overrides gains time scoping (owner request).
-- One-off delta for the live Supabase DB; the consolidated baseline
-- (db/schema.sql) already carries the same definition for fresh builds.
--
--   valid_to   timestamp — EXCLUSIVE end, compared against the slot's concrete
--              period start; null = open-ended (previous behavior unchanged).
--              A single schedule day D = valid_from D, valid_to day_start(D+1).
--   start_time time — null = every slot of the position (previous behavior);
--              set = only the slot(s) starting at that template time.
--   seats = 0  cancels the matched slot(s): day_slots omits them, the
--              generator redistributes the crew, no coverage gap is reported.
--
-- Resolution (day_slots): start_time match beats position-wide, then latest
-- valid_from, then newest row. Existing rows keep their exact old meaning.
-- Requires Postgres >= 15 (unique nulls not distinct).

begin;

alter table seat_overrides
  add column valid_to   timestamp,
  add column start_time time,
  add constraint seat_overrides_seats_nonneg check (seats >= 0);

alter table seat_overrides
  drop constraint if exists seat_overrides_position_id_valid_from_key;
alter table seat_overrides
  add constraint seat_overrides_pos_from_start_key
  unique nulls not distinct (position_id, valid_from, start_time);

create or replace view day_slots as
select * from (
  select sd.day,
         st.id  as slot_template_id,
         st.position_id,
         st.sub_position_id,
         tsrange(p.start_ts, p.start_ts + make_interval(mins => st.duration_minutes)) as period,
         coalesce((select o.seats from seat_overrides o
                   where o.position_id = st.position_id
                     and o.valid_from <= sd.day
                     and (o.valid_to is null or p.start_ts < o.valid_to)
                     and (o.start_time is null or o.start_time = st.start_time)
                   order by (o.start_time is not null) desc, o.valid_from desc, o.id desc
                   limit 1),
                  st.seats) as seats,
         st.commander_first_seat
  from schedule_days sd
  join slot_templates st
    on sd.day >= st.valid_from and (st.valid_to is null or sd.day <= st.valid_to)
  cross join lateral (
    select sd.day::timestamp + st.start_time::interval
           + case when st.start_time < time '14:00' then interval '1 day' else interval '0' end
           as start_ts) p
) s
where s.seats > 0;

commit;
