-- ============================================================================
-- One-off live-DB delta — 2026-07-18 rules overhaul (owner's 18-item list).
-- Idempotent; mirrors the schema.sql/seed.sql baseline changes of the same
-- date. Apply with: docker exec -i shavtzak-pg psql "$URI" < this-file.
-- ============================================================================

begin;

-- ── Position config: flex seats, hard driver quals, קצין מוצב pool, groups ──
update positions set config = coalesce(config, '{}'::jsonb)
  || '{"flex_seats":{"min":3,"max":4},"driver_qual":"נהג דוד"}'::jsonb
where name = 'סיור';

update positions set config = coalesce(config, '{}'::jsonb)
  || '{"flex_seats":{"min":10,"max":12}}'::jsonb
where name = 'מגן';

update positions set config = coalesce(config, '{}'::jsonb)
  || '{"driver_qual":"נהג טיגריס","group_size":4}'::jsonb
where name = 'התקפי';

update positions set config = coalesce(config, '{}'::jsonb)
  || '{"candidate_pool":["שמואל אטלי","צבי שור","יוחאי יעקבסון","אורי שאג","אלעד זיו","אביאל גיאת","עמיחי ברוורמן","גלעד דביר"]}'::jsonb
where name = 'קצין מוצב';

-- ── מפלג: the רס"פ/סרס"פ/מנהלה staff — no shifts, appears in the שבצק ──────
insert into positions (id, name, mission_class, is_scheduled, config)
values (14, 'מפלג', 'other', true,
        '{"daily":true,"staff_all_roles":["רס\"פ","סרס\"פ","מנהלה"]}'::jsonb)
on conflict (id) do nothing;

insert into slot_templates (position_id, start_time, duration_minutes, seats, valid_from)
select 14, '14:00', 1440, 6, '2026-07-17'
where not exists (select 1 from slot_templates where position_id = 14);

-- ── התקפי: first seat is a commander seat (H6 hard) ─────────────────────────
update slot_templates set commander_first_seat = true
where position_id = (select id from positions where name = 'התקפי');

-- ── Soldiers ────────────────────────────────────────────────────────────────
-- בנימין קיי: the sheet's מפלג tab says לא מגיע — he is not deployed
update soldiers set is_schedulable = false where full_name = 'בנימין קיי';

-- יהונתן רוט: only static posts + תורנות (כרמל included — the T4a chain takes
-- the whole descending defense crew)
update soldiers
set allowed_positions = array['עמדות הגנה','כרמל חטיבה','תורנים']
where full_name = 'יהונתן רוט';

-- ── Bus time 10:00 → 08:00 for FUTURE full-day unavailability boundaries ────
-- (past boundaries reflect what actually happened and stay at 10:00)
update unavailability set period = tsrange(
  case when lower(period) >= timestamp '2026-07-18 00:00' and lower(period)::time = '10:00'
       then lower(period) - interval '2 hours' else lower(period) end,
  case when upper(period) >= timestamp '2026-07-18 00:00' and upper(period)::time = '10:00'
       then upper(period) - interval '2 hours' else upper(period) end)
where kind in ('חופש','לא מגויס','שחרור','גיוס','מחלה')
  and ((lower(period) >= timestamp '2026-07-18 00:00' and lower(period)::time = '10:00')
    or (upper(period) >= timestamp '2026-07-18 00:00' and upper(period)::time = '10:00'));

-- ── soldier_fairness: גשש tracker load counts ONLY night windows (R3) ───────
create or replace function soldier_fairness(as_of date)
returns table (
  soldier_id          bigint,
  night_count_7d      bigint,
  night_count_total   bigint,
  mission_hours_7d    numeric,
  weighted_hours_7d   numeric,
  readiness_hours_7d  numeric,
  tracker_hours_total numeric,
  position_counts     jsonb
)
language sql stable as $$
  with w as (
    select day_start(as_of) as t_end, day_start(as_of) - interval '7 days' as t_start
  ),
  base as (
    -- daily:true implies night_exempt (src/config.ts effectiveConfig);
    -- an explicit night_exempt key wins over the implied value
    select sa.soldier_id, sa.period, sa.day, p.mission_class, p.name as position_name,
           coalesce((p.config->>'night_exempt')::boolean,
                    (p.config->>'daily')::boolean, false) as night_exempt
    from shift_assignments sa
    join positions p on p.id = sa.position_id
    where p.mission_class <> 'rest'
  )
  select s.id,
    -- night_exempt positions (24h duties like תורנים/קצין מוצב — the soldier
    -- sleeps) overlap 00-06 but do not count as nights
    count(*) filter (where b.period && night_range(b.day)
                       and b.period && tsrange(w.t_start, w.t_end)
                       and b.mission_class <> 'readiness'
                       and not b.night_exempt)                         as night_count_7d,
    count(*) filter (where b.period && night_range(b.day)
                       and lower(b.period) < w.t_end
                       and b.mission_class <> 'readiness'
                       and not b.night_exempt)                         as night_count_total,
    -- counted hours: a single assignment contributes at most 8h (R4 — daily
    -- 06:00-22:00 missions count as one 8h duty, matching the generator's cap).
    -- NB: the && filter is essential — hours(empty_range) is NULL and
    -- least(NULL, 8) = 8, so unfiltered out-of-window rows would add 8h each.
    coalesce(sum(least(hours(b.period * tsrange(w.t_start, w.t_end)), 8))
             filter (where b.mission_class <> 'readiness'
                       and b.period && tsrange(w.t_start, w.t_end)), 0) as mission_hours_7d,
    coalesce(sum(least(hours(b.period * tsrange(w.t_start, w.t_end)), 8)
             * case when b.mission_class = 'readiness'
                    then coalesce((select (value->>0)::numeric from config
                                    where key = 'readiness_hour_weight'), 0.25)
                    else 1 end)
             filter (where b.period && tsrange(w.t_start, w.t_end)), 0) as weighted_hours_7d,
    coalesce(sum(hours(b.period * tsrange(w.t_start, w.t_end)))
             filter (where b.mission_class = 'readiness'), 0)          as readiness_hours_7d,
    -- R3 (owner decision): only the גשש NIGHT window (22:00-07:00, i.e. a row
    -- overlapping its schedule day's night range) counts as tracker load —
    -- day windows (07-14, 14-22) are free
    coalesce(sum(hours(b.period))
             filter (where b.position_name = 'כונן גשש'
                       and b.period && night_range(b.day)
                       and lower(b.period) < w.t_end), 0)              as tracker_hours_total,
    coalesce(jsonb_object_agg(b.position_name, cnt) filter (where b.position_name is not null),
             '{}'::jsonb)                                              as position_counts
  from soldiers s
  cross join w
  left join (
    select soldier_id, period, day, mission_class, position_name, night_exempt,
           count(*) over (partition by soldier_id, position_name) as cnt
    from base
  ) b on b.soldier_id = s.id and lower(b.period) < w.t_end
  group by s.id, w.t_end
$$;

commit;
