-- Weekly fairness scope (owner decision 2026-07-19): soldier_fairness now
-- judges the CURRENT schedule week only (window opens Sunday 14:00; empty
-- on a Sunday) and position_counts is week-scoped as well (no global
-- fairness). Idempotent — safe to re-run. Mirrors db/schema.sql.

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
  -- Fairness is judged over the CURRENT schedule week only (owner decision
  -- 2026-07-19): the window opens at the week's Sunday 14:00 and ends at the
  -- generation day — so a Sunday starts from a clean slate (empty window).
  -- The *_7d column names are kept for API compatibility.
  with w as (
    select day_start(as_of) as t_end,
           day_start(as_of - (extract(dow from as_of))::int) as t_start
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
    -- position balance is week-scoped too (owner 2026-07-19: no global
    -- fairness) — only this week's stints count toward P4
    select soldier_id, period, day, mission_class, position_name, night_exempt,
           sum(case when period && tsrange(day_start(as_of - (extract(dow from as_of))::int),
                                           day_start(as_of))
                    then 1 else 0 end)
             over (partition by soldier_id, position_name) as cnt
    from base
  ) b on b.soldier_id = s.id and lower(b.period) < w.t_end
  group by s.id, w.t_end
$$;
