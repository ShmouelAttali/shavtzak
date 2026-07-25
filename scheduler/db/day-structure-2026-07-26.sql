-- ============================================================================
-- Day-structure ("מבנה יומי") tab — schema delta (2026-07-26)
-- Spec: ../SPEC.md  (§ seat_overrides resolution + the מבנה יומי model)
--
-- Standalone LIVE-DB delta — NOT a migration to replay. Apply ONCE to Supabase
-- (via the supabase-access skill) BEFORE deploying api/day-structure.ts; the
-- new column makes the API 500 on an un-migrated DB. The consolidated baseline
-- (db/schema.sql) has been updated to match — tests rebuild from schema.sql
-- (freshSchema), so this file is only for the already-built live database.
--
-- What it adds: per-DAY shift-structure targeting for the new tab.
--  1. seat_overrides.slot_template_id — resize/cancel ONE specific slot template
--     (not just "the position's 18:00 shift"): (position, start_time) can't tell
--     a cancelled permanent template apart from its day-scoped replacement at the
--     same start. A template-id target hits exactly one row; sub-level targeting
--     comes free (the template carries the sub). New day_slots specificity:
--       template-id match > start_time match > position-wide,
--       then valid_from desc, id desc.
--  2. slot_templates_no_overlap relaxed with WHERE (valid_from is distinct from
--     valid_to): DAY-SCOPED rows (valid_from = valid_to) leave the exclusion,
--     so a day template can share (position, sub, start_time) with the permanent
--     one it replaces (a duration-only change is representable). Permanent rows
--     (incl. valid_to null) keep no-overlap. MUST be `is distinct from`, not
--     `<>` — `<>` would drop valid_to-null rows out of the constraint.
-- ============================================================================

-- 1. seat_overrides: template-id target + recreated unique ────────────────────
alter table seat_overrides
  add column if not exists slot_template_id smallint
    references slot_templates(id) on delete cascade;

-- drop the old unique (auto-named by schema.sql; older hand-built DBs used a
-- shortened name — cover both)
alter table seat_overrides
  drop constraint if exists seat_overrides_position_id_valid_from_start_time_key;
alter table seat_overrides
  drop constraint if exists seat_overrides_pos_from_start_key;

alter table seat_overrides
  add constraint seat_overrides_uniq
    unique nulls not distinct (position_id, valid_from, start_time, slot_template_id);

-- 2. relax slot_templates_no_overlap for day-scoped rows ──────────────────────
alter table slot_templates drop constraint if exists slot_templates_no_overlap;
alter table slot_templates add constraint slot_templates_no_overlap
  exclude using gist (
    position_id with =,
    (coalesce(sub_position_id, -1)) with =,
    start_time with =,
    daterange(valid_from, valid_to, '[]') with &&
  ) where (valid_from is distinct from valid_to);

-- 3. day_slots: honor the template-id target as the most-specific override ─────
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
                     and (o.slot_template_id is null or o.slot_template_id = st.id)
                   order by (o.slot_template_id is not null) desc,
                            (o.start_time is not null) desc,
                            o.valid_from desc, o.id desc
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
