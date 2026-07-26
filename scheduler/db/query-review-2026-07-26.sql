-- ============================================================================
-- Query review — schema delta (2026-07-26)
-- Spec: ../SPEC.md
--
-- Standalone LIVE-DB delta — NOT a migration to replay. Apply ONCE to Supabase
-- (via the supabase-access skill). The consolidated baseline (db/schema.sql)
-- has been updated to match — tests rebuild from schema.sql (freshSchema), so
-- this file is only for the already-built live database.
--
-- Nothing here changes RESULTS — index changes, a function body rewritten to
-- identical semantics, and a dead function dropped:
--   1. seat_overrides (slot_template_id) — cover the cascade FK.
--   2. slot_templates (position_id, valid_from) where day-scoped — the one
--      access path the existing GiST exclusion deliberately does NOT index.
--   3. drop exit_requests_soldier_period — 100% duplicated by the exclusion
--      constraint's own index.
--   4. soldiers ((normalized full_name)) — the name resolution in
--      api/exit-requests.ts, today a full scan + JS compare.
--   5. soldier_fairness(as_of, include_drafts) — the correlated NOT EXISTS in
--      the draft-scope filter becomes an explicit non-correlated set. IDENTICAL
--      output (tests/fairness-equivalence.test.ts compares both bodies row by
--      row); see the measurement note at section 5 before expecting a speedup.
--
-- KNOWN PRE-EXISTING DRIFT (benign, NOT touched here): the live seats>=0 check
-- on seat_overrides is named `seat_overrides_seats_nonneg` (added by
-- seat-overrides-hourly-2026-07-19.sql), while a fresh schema.sql build names
-- the equivalent inline check `seat_overrides_seats_check`. Same predicate,
-- different name — see db/seat-overrides-drop-stale-check-2026-07-26.sql.
-- ============================================================================

-- 1. seat_overrides.slot_template_id: cover the ON DELETE CASCADE FK ──────────
-- The column is only the 4th member of seat_overrides_uniq (position_id,
-- valid_from, start_time, slot_template_id), so nothing can lead with it:
--   * every `delete from slot_templates ...` (the מבנה יומי / חמל tabs delete
--     the day's day-scoped templates wholesale on each save) has to seq-scan
--     seat_overrides once per deleted row to enforce the cascade;
--   * day_slots' correlated `o.slot_template_id = st.id` probe runs per slot.
-- Partial: a null slot_template_id is the classic position/start_time override
-- and is never looked up by this column.
create index if not exists seat_overrides_template
  on seat_overrides (slot_template_id) where slot_template_id is not null;

-- 2. slot_templates: index the DAY-SCOPED rows ────────────────────────────────
-- The only index leading with position_id is the slot_templates_no_overlap
-- exclusion GiST — and its predicate is `where (valid_from is distinct from
-- valid_to)`, i.e. it excludes EXACTLY the day-scoped rows (valid_from =
-- valid_to) that the חמל + מבנה יומי tabs write and read on every request:
--   api/hamal.ts:        position_id = $1 and valid_from = valid_to
--                        and valid_from between $2 and $3
--   api/day-structure.ts: valid_from = $1 and valid_to = $1
--                        and position_id = any($2)   (delete, twice per save)
-- Same partial predicate as the exclusion's complement, so the two indexes
-- partition the table between them.
create index if not exists slot_templates_day_scoped
  on slot_templates (position_id, valid_from) where valid_from = valid_to;

-- 3. drop the duplicated exit_requests index ─────────────────────────────────
-- `exit_requests_no_overlap exclude using gist (soldier_id with =, period
-- with &&)` is backed by an implicit gist(soldier_id, period) index — byte for
-- byte the same structure exit_requests_soldier_period built a second time.
-- Every write paid for both. Lookups keep using the exclusion's index.
drop index if exists exit_requests_soldier_period;

-- 4. normalized-name index on soldiers ───────────────────────────────────────
-- MUST STAY IN LOCKSTEP WITH normalizeName() in scheduler/src/text.ts:
--     (s ?? '').replace(/[״"׳'`]/g, '').replace(/\s+/g, ' ').trim()
-- The SQL below is an exact mirror, verified character class by character
-- class against the JS (incl. NBSP U+00A0 and BOM U+FEFF, which JS's \s
-- matches but Postgres's \s does not — hence they are translated to a plain
-- space instead of being deleted, and the following \s+ collapse absorbs them):
--     translate  from = NBSP, BOM, ״, ", ׳, ', `
--                to   = two spaces → NBSP/BOM become ' ', the five quote
--                       characters have no counterpart and are DELETED
--     regexp_replace \s+ → ' '   (JS .replace(/\s+/g, ' '))
--     btrim                      (JS .trim(); after the collapse only plain
--                                 spaces can be left at the edges)
-- All three functions are IMMUTABLE, so this is index-able.
-- Caller: api/exit-requests.ts resolveSoldier() — its normalized fallback
-- currently reads the WHOLE roster and compares in JS. With this index the
-- lookup is `where <expr> = $1` passing normalizeName(name) as the parameter.
-- Not unique: two different rows CAN normalize to the same key (only
-- full_name itself is unique), and resolveSoldier picks the first match.
create index if not exists soldiers_name_normalized on soldiers (
  (btrim(regexp_replace(
     translate(full_name, chr(160) || chr(65279) || '״"׳''`', '  '),
     '\s+', ' ', 'g')))
);

-- 5. soldier_fairness: state the draft-day set explicitly ────────────────────
-- Body is VERBATIM the schema.sql one except for the draft-scope predicate.
-- Before: `not exists (select 1 from shift_assignments d where d.day = sa.day
--          and d.source in ('auto','chain'))` — correlated on sa.day.
-- After:  a `draft_days` CTE + `sa.day not in (select day from draft_days)` —
--         one non-correlated set, computed once.
--
-- SEMANTICS ARE IDENTICAL, and that is the load-bearing claim: `not in` and
-- `not exists` differ only when the subquery can yield NULL (NOT IN then
-- returns unknown and drops the row); shift_assignments.day is `date not
-- null`, so `select distinct day` can never produce a NULL and the two agree
-- for every possible table state. tests/fairness-equivalence.test.ts loads the
-- PRE-rewrite body verbatim from db/fairness-draft-scope-2026-07-26.sql under a
-- temporary name and asserts the two return the same rows.
--
-- MEASURED, so nobody re-litigates it: on PostgreSQL 16.14 this is NOT a
-- speedup. The planner already turns a correlated EXISTS whose correlation is a
-- simple equality into `NOT (hashed SubPlan)`, so the old form was evaluated
-- once too — 1,800 rows / 30 days: 2.4 ms old vs 2.4 ms new, same plan shape,
-- and still the same at work_mem=64kB. What the rewrite buys is that the single
-- evaluation is written down instead of depending on that transform applying
-- (it needs a hashable equality operator and the subquery to fit work_mem);
-- when it does not apply, a correlated EXISTS is RE-EXECUTED per row while a
-- non-correlated subquery is merely rescanned from one materialized result.
create or replace function soldier_fairness(as_of date, include_drafts boolean default true)
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
  -- every schedule day that holds at least one draft row. Was a correlated
  -- `not exists (...)` in the base filter below; naming the set makes the
  -- single evaluation explicit instead of leaning on the planner's
  -- EXISTS→hashed-SubPlan transform (2026-07-26, db/query-review-2026-07-26.sql
  -- — measured a wash on PG16; kept for the guarantee, not for speed).
  draft_days as (
    select distinct day from shift_assignments where source in ('auto','chain')
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
      -- draft scope: `locked` rows are human truth and always count (the
      -- generator never deletes them either). Otherwise include_drafts decides
      -- per DAY — a day holding drafts contributes its drafts instead of its
      -- published rows, never both, so nothing is double-counted.
      -- `not in` and `not exists` differ only when the subquery can yield
      -- NULL; shift_assignments.day is `date not null`, so the two are exactly
      -- equivalent here (tests/fairness-equivalence.test.ts proves it).
      and (sa.locked
           or case when include_drafts
                     then sa.source in ('auto','chain')
                          or sa.day not in (select day from draft_days)
                     else sa.source not in ('auto','chain')
                end)
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
  where s.archived_at is null
  group by s.id, w.t_end
$$;
