-- ============================================================================
-- Consolidation 2026-07-17 — bring the LIVE Supabase DB in line with the
-- refactored baseline (schema.sql + seed.sql as of this date).
--
-- NOT a numbered migration: db/migrations/ is archived (see
-- db/migrations/archive/README.md); schema.sql+seed.sql is the consolidated
-- baseline for fresh builds, and THIS file captures the equivalent deltas for
-- the one live database. Apply once, via the supabase-access skill.
-- Idempotent: safe to re-run.
-- ============================================================================

begin;

-- ── 1. daily-flag consolidation (positions.config) ──────────────────────────
-- `daily: true` = sleeping 14:00–14:00 day duty; implies night_exempt +
-- full_rest_after + yomi_display (src/config.ts effectiveConfig; explicit
-- keys override). Replaces the three hand-set flags per position.

update positions set config = '{"daily":true,"continuity":true,"same_platoon":true}'
where name = 'מגן';

-- התקפי: explicit full_rest_after only (readiness class, not a yomi duty);
-- open_for_attack was dead — never read
update positions set config = '{"full_rest_after":true}'
where name = 'התקפי';

-- חפק: daily + seat rules; seats חובש/נהג gain a `qual` guard (H6b:
-- assignment warning when the named soldier lacks the qualification)
update positions set config = '{"daily": true, "seat_rules": [
    {"sub": "מפקד", "roles": ["מ\"פ", "סמ\"פ"], "commander": true},
    {"sub": "קשר",  "soldiers": ["יהודה חושן", "אור חיים בלונדר", "יחיעם אושפיזאי"], "ordered": true, "release_unpicked": true},
    {"sub": "חובש", "soldiers": ["כפיר לנדסמן", "שחר מיכאלי"], "qual": "חובש"},
    {"sub": "נהג",  "soldiers": ["אמיר יונייב", "יאיר מובשוביץ"], "qual": "נהג דוד"}
  ]}'
where name = 'חפק';

-- תורנים: daily, but explicitly OPTED OUT of full_rest_after (R5 exception —
-- finishing at 14:00 grants no exemption; R1's 4h floor applies)
update positions set config = '{"daily":true,"full_rest_after":false}'
where name = 'תורנים';

update positions set config = '{"daily":true}'
where name = 'קצין מוצב';

-- dead config keys: tracker (כונן גשש) was never read
update positions set config = config - 'tracker' where name = 'כונן גשש';

-- role-חמל whitelist is now DERIVED from the חמל position's staff_all_roles
-- config (same allowedIn mechanism + validator rule) — the explicit rows are
-- redundant. H6c allowed_positions stays for genuine per-soldier cases
-- (e.g. אריאל ביר → סיור).
update soldiers set allowed_positions = null
where translate(coalesce(role,''),'"״','') = 'חמל';

-- ── 2. tombstones documented in the seed ────────────────────────────────────
-- תגבצ stays only as a history tombstone; אחר is the import catch-all —
-- neither is schedulable
update positions set is_scheduled = false, config = '{}' where name = 'תגבצ';
update positions set is_scheduled = false where name = 'אחר';
insert into positions (id, name, mission_class, is_scheduled, config)
values (99, 'אחר', 'other', false, '{}')
on conflict (id) do nothing;

-- ── 3. dead columns / values ────────────────────────────────────────────────
-- H5 is enforced by construction (daily slots span the whole 14:00–14:00 day;
-- H4 gives one Level-1 position per day; H3 excludes overlaps)
alter table positions drop column if exists blocks_day;
-- role gates live in code (H6) / seat_rules — column was never read
alter table sub_positions drop column if exists required_role;
-- chain_rules.pick 'highest_rifle' was never used (carmel commander = highest
-- rifle is generator logic over pick='all' rows)
alter table chain_rules drop constraint if exists chain_rules_pick_check;
alter table chain_rules add constraint chain_rules_pick_check
  check (pick in ('all','min_tracker_hours'));

-- ── 4. honest config table ──────────────────────────────────────────────────
-- Only keys the code reads remain (src/config.ts loadTunables +
-- soldier_fairness's readiness_hour_weight). Day/night anchors are hardcoded
-- mirrors in src/time.ts + schema.sql helpers BY DESIGN.
delete from config where key in
  ('day_anchor', 'night_window', 'blocking_kinds', 'excluded_keywords',
   'carmel_commander_rule', 'carmel_min_staffing', 'priority_list',
   'scoring_weights');
insert into config (key, value) values
  ('readiness_hour_weight', '0.25'),
  ('daily_cap_hours',       '8'),
  ('rest_rules',            '{"minimum_hours":4,"ideal_hours":8,"long_task_hours":4,"gashash_effective_hours":1.5}')
on conflict (key) do update set value = excluded.value;

-- ── 5. soldier_fairness: night_exempt implied by daily ──────────────────────
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
    coalesce(sum(hours(b.period))
             filter (where b.position_name = 'כונן גשש'
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

-- ── 6. DB guards (schema.sql mirrors) ───────────────────────────────────────
-- Two template versions of the same (position, sub, start) must never be
-- active on the same day (day_slots treats valid_to as INCLUSIVE → '[]').
alter table slot_templates drop constraint if exists slot_templates_no_overlap;
alter table slot_templates add constraint slot_templates_no_overlap
  exclude using gist (
    position_id with =,
    (coalesce(sub_position_id, -1)) with =,
    start_time with =,
    daterange(valid_from, valid_to, '[]') with &&
  );

-- unavailability.kind whitelist (cleanup.py FULL_BLOCK + PARTIAL + the
-- short-exits 'יציאה'). NOT VALID: guards new rows without failing on any
-- legacy row — run `alter table unavailability validate constraint
-- unavailability_kind_check;` after checking `select distinct kind`.
alter table unavailability drop constraint if exists unavailability_kind_check;
alter table unavailability add constraint unavailability_kind_check
  check (kind in (
    'חופש','לא מגויס','לא מגוייס','שחרור','גיוס','מחלה',
    'יציאה','יציאה בבוקר','יציאה ב14:00','יציאה בערב',
    'חזרה ב14:00','חזרה בערב')) not valid;

commit;
