-- ============================================================================
-- Shavtzak Scheduler — schema (Supabase Postgres)
-- Spec: ../SPEC.md
--
-- Time model:
--   * All shift times are stored as naive local timestamps (timestamp without
--     time zone, Asia/Jerusalem wall-clock) — matching how times are written in
--     the sheet. tsrange (not tstzrange) everywhere.
--   * "Schedule day" D = [D 14:00, D+1 14:00). A shift belongs to the schedule
--     day containing its start.
--   * "Night" = [00:00, 06:00) of the morning inside schedule day D
--     (i.e. D+1 00:00–06:00). Both anchors configurable in `config`.
-- ============================================================================

create extension if not exists btree_gist;

-- ── Helper functions ────────────────────────────────────────────────────────

-- Start of schedule day D (14:00 anchor).
create or replace function day_start(d date)
returns timestamp language sql immutable as
$$ select d::timestamp + interval '14 hours' $$;

-- Full range of schedule day D.
create or replace function day_range(d date)
returns tsrange language sql immutable as
$$ select tsrange(day_start(d), day_start(d) + interval '1 day') $$;

-- Night window inside schedule day D: 00:00–06:00 of the following morning.
create or replace function night_range(d date)
returns tsrange language sql immutable as
$$ select tsrange((d + 1)::timestamp, (d + 1)::timestamp + interval '6 hours') $$;

-- Duration of a tsrange in hours.
create or replace function hours(r tsrange)
returns numeric language sql immutable as
$$ select extract(epoch from upper(r) - lower(r)) / 3600.0 $$;

-- Schedule day that a timestamp belongs to.
create or replace function schedule_day_of(ts timestamp)
returns date language sql immutable as
$$ select case when ts::time >= time '14:00' then ts::date else ts::date - 1 end $$;

-- ── Source tables (small, hand-editable) ────────────────────────────────────

-- A soldier's name appears ONCE in the DB (owner decision 2026-07-19); every
-- other reference is a soldier_id FK (position_candidates,
-- magen_commander_history, soldier_allowed_positions below). full_name is
-- unique — a real-life namesake must be entered with a disambiguator.
create table soldiers (
  id              bigint generated always as identity primary key,
  personal_number text unique not null,
  full_name       text unique not null,
  platoon         text not null,          -- 1 / 2 / 3 / חמ"ל / מפל"ג / לא ידוע
  role            text check (role <> ''),-- מ"פ / מ"מ / סמל / מ"כ / לוחם ...
  rifle_level     int,                    -- רובאי
  phone           text,
  email           text,
  is_schedulable  boolean not null default true,  -- H2: מפלג / חמ"ל => false
  notes           text,
  -- Soft removal (מצבת חיילים tab): null = active. An archived soldier is out
  -- of every roster read (generator, validator, pickers, fairness, presence)
  -- but keeps all history rows and keeps holding their unique full_name /
  -- personal_number, so a re-import cannot resurrect them as a duplicate.
  archived_at     timestamp
);

-- H6c whitelist: no rows = soldier may serve anywhere; else only these
-- positions (replaces the old soldiers.allowed_positions text[] of names).
create table soldier_allowed_positions (
  soldier_id  bigint   not null references soldiers on delete cascade,
  position_id smallint not null,          -- FK added after positions is created
  primary key (soldier_id, position_id)
);

create table soldier_qualifications (
  soldier_id    bigint not null references soldiers on delete cascade,
  qualification text   not null,          -- 'נהג דוד','נהג טיגריס','חובש','מאג',...
  primary key (soldier_id, qualification)
);

-- Sparse unavailability periods. No row => soldier is available (H1).
-- Replaces the sheet's full presence matrix and the short-exits tab.
create table unavailability (
  id         bigint generated always as identity primary key,
  soldier_id bigint not null references soldiers on delete cascade,
  period     tsrange not null check (upper(period) > lower(period)),
  -- known kinds only: the full-day + partial statuses import/cleanup.py emits
  -- (FULL_BLOCK + PARTIAL), plus 'יציאה' (the short-exits tab import)
  kind       text not null check (kind in (
               'חופש','לא מגויס','לא מגוייס','שחרור','גיוס','מחלה',
               'יציאה','יציאה בבוקר','יציאה ב14:00','יציאה בערב',
               'חזרה ב14:00','חזרה בערב')),
  note       text
);
create index unavailability_soldier_period on unavailability using gist (soldier_id, period);
-- Same-kind overlaps are double entry (the sheet import must uphold this);
-- CROSS-kind overlaps are intentional (a return-day partial row overlays the
-- tail of the full-block range) and stay allowed.
alter table unavailability add constraint unavailability_no_same_kind_overlap
  exclude using gist (soldier_id with =, kind with =, period with &&);

-- Half-day exit requests (H9). Own table — NOT unavailability, which the sheet
-- import truncates and rebuilds; requests must survive re-imports. A row IS an
-- approved exit (auto-approved). The generator merges periods into the blocked
-- windows at load time and packs the soldier's shifts around them.
create table exit_requests (
  id          bigint generated always as identity primary key,
  soldier_id  bigint not null references soldiers on delete cascade,
  period      tsrange not null check (upper(period) > lower(period)),
  created_by  text,                        -- requester email (audit only)
  -- naive LOCAL wall-clock (server TZ is UTC on Supabase — bare now() would
  -- store UTC and skew 2-3h vs every other timestamp in the schema)
  created_at  timestamp not null default timezone('Asia/Jerusalem', now()),
  note        text
);
-- No separate (soldier_id, period) index: the exclusion constraint below is
-- backed by exactly that gist index, and it serves every lookup (a second copy
-- only doubled the write cost — dropped 2026-07-26, db/query-review-2026-07-26.sql).
alter table exit_requests add constraint exit_requests_no_overlap
  exclude using gist (soldier_id with =, period with &&);

-- NB: no blocks_day column — H5 (daily duties occupy the whole schedule day)
-- is enforced by construction: daily slots span 14:00–14:00, H4 gives one
-- Level-1 position per day, and H3's overlap exclusion blocks anything else.
create table positions (
  id            smallint primary key,
  name          text unique not null,     -- 'סיור','עמדות הגנה','כוננות','מנוחה',...
  mission_class text not null check (mission_class in ('static','dynamic','readiness','rest','other')),
  is_scheduled  boolean not null default true,   -- חמל => false
  config        jsonb not null default '{}'
);

create table sub_positions (
  id            smallint primary key,
  position_id   smallint not null references positions,
  name          text not null,            -- 'שג','בונקר','מזרחית','דרומית','מפקד כרמל חטיבה',...
  unique (position_id, name),
  unique (position_id, id)                -- composite-FK target (position_candidates)
);

alter table soldier_allowed_positions
  add constraint soldier_allowed_positions_position_id_fkey
  foreign key (position_id) references positions;

-- Closed candidate lists, id-based (replaces the name arrays that lived in
-- positions.config: 'candidate_pool' and 'seat_rules'[].soldiers — a spelling
-- mismatch there silently hid a soldier for a week, 2026-07-19):
--   sub_position_id NULL = position-level pool (קצין מוצב candidate_pool)
--   sub_position_id set  = named candidates for that seat (חפק seat_rules)
-- priority: NULL = unordered (fairness-rotated); 1..n = ordered list (קשר).
-- Seat-rule METADATA (roles/qual/ordered/commander/release_unpicked) stays in
-- positions.config->'seat_rules'; only the soldier lists live here.
-- Seeded per-deployment by db/seed-candidates.sql (after the roster import).
create table position_candidates (
  id              smallint generated always as identity primary key,
  position_id     smallint not null references positions,
  sub_position_id smallint,
  soldier_id      bigint   not null references soldiers,
  priority        smallint check (priority >= 1),
  foreign key (position_id, sub_position_id)
    references sub_positions (position_id, id),
  unique nulls not distinct (position_id, sub_position_id, soldier_id)
);

-- Versioned slot template; concrete per-day slots are derived (day_slots view).
create table slot_templates (
  id                   smallint generated always as identity primary key,
  position_id          smallint not null references positions,
  sub_position_id      smallint references sub_positions,
  start_time           time not null,
  duration_minutes     int  not null check (duration_minutes > 0),
  seats                smallint not null default 1 check (seats > 0),
  commander_first_seat boolean not null default false,  -- H6: first seat = commander
  valid_from           date not null,
  valid_to             date                              -- null = still active
);

-- Two PERMANENT template versions of the same (position, sub, start) must never
-- be active on the same day — day_slots would emit the slot twice. day_slots
-- treats valid_to as INCLUSIVE, so validity ranges are closed '[]'
-- (null valid_to = open-ended). Requires btree_gist (created above).
-- DAY-SCOPED rows (valid_from = valid_to — the "add/replace a shift on this one
-- day" mechanism used by the חמל + מבנה יומי tabs) are EXEMPT via the WHERE
-- predicate, so a day template may share (position, sub, start_time) with the
-- permanent one it replaces (a duration-only change on a single day). MUST be
-- `is distinct from`, not `<>` — `<>` would drop valid_to-null rows out of the
-- constraint entirely.
alter table slot_templates add constraint slot_templates_no_overlap
  exclude using gist (
    position_id with =,
    (coalesce(sub_position_id, -1)) with =,
    start_time with =,
    daterange(valid_from, valid_to, '[]') with &&
  ) where (valid_from is distinct from valid_to);

-- ...and the complementary index for the rows that exclusion leaves out. The
-- day-scoped rows (valid_from = valid_to) ARE the חמל + מבנה יומי per-day shift
-- structure, read and deleted by (position_id, valid_from) on every save/GET;
-- without this the exclusion GiST is the only index leading with position_id
-- and it never contains them.
create index slot_templates_day_scoped
  on slot_templates (position_id, valid_from) where valid_from = valid_to;

-- Per-position seat-count changes (seats PER SLOT). Managed by hand —
-- resolved by the day_slots view. Scoping:
--   valid_from  schedule day the override starts on (inclusive).
--   valid_to    optional EXCLUSIVE end, compared against the slot's concrete
--               period START — a single schedule day D is [D, day_start(D+1));
--               null = open-ended (the original "onward" behavior).
--   start_time  optional template start_time match — null applies to every
--               slot of the position, set targets one shift (e.g. 18:00 סיור).
--   slot_template_id  optional target of ONE specific template row (FK, day-
--               scoped delete-cascaded). null = the classic position/start_time
--               match; set pins exactly one slot — the מבנה יומי tab uses it to
--               resize/cancel a single shift even when a cancelled permanent
--               template and its day-scoped replacement share (position,
--               start_time). The template carries the sub, so sub-level
--               targeting comes free.
--   seats = 0   cancels the matched slot(s): day_slots omits them entirely,
--               so the generator redistributes the crew and the validator
--               raises no coverage gap.
-- Most specific wins: a slot_template_id match beats a start_time match, which
-- beats a position-wide row, then the latest valid_from, then the newest row.
create table seat_overrides (
  id          smallint generated always as identity primary key,
  position_id smallint not null references positions,
  valid_from  date not null,
  valid_to    timestamp,
  start_time  time,
  slot_template_id smallint references slot_templates(id) on delete cascade,
  seats       smallint not null check (seats >= 0),
  note        text,
  constraint seat_overrides_uniq
    unique nulls not distinct (position_id, valid_from, start_time, slot_template_id)
);

-- slot_template_id is only the 4th column of seat_overrides_uniq, so nothing
-- leads with it: without this index every `delete from slot_templates` (the
-- מבנה יומי / חמל tabs drop the day's day-scoped templates wholesale on each
-- save) seq-scans seat_overrides per deleted row to enforce the ON DELETE
-- CASCADE, and day_slots' `o.slot_template_id = st.id` probe runs per slot.
create index seat_overrides_template
  on seat_overrides (slot_template_id) where slot_template_id is not null;

-- T4 chained duties as data.
create table chain_rules (
  id               smallint primary key,
  target_position  smallint not null references positions,  -- כרמל / כוננות / כונן גשש
  target_start     time not null,
  source_position  smallint not null references positions,  -- עמדות הגנה / סיור
  source_start     time not null,
  source_day_offset int not null default 0,                 -- -1 = source shift from previous schedule day
  pick             text not null default 'all'
                   check (pick in ('all','min_tracker_hours')),
  -- a duplicated rule would double-fill a chained window
  unique (target_position, target_start, source_position, source_start, source_day_offset)
);

-- Tunables actually read by the code (src/config.ts loadTunables):
-- rest_rules, daily_cap_hours, readiness_hour_weight. The 14:00 day anchor
-- and the 00:00-06:00 night window are hardcoded mirrors in time.ts + the
-- helper functions above BY DESIGN (changing them mid-deployment would
-- silently reinterpret all stored data).
create table config (
  key   text primary key,
  value jsonb not null
);

-- The weekly מגן-commander decision (§7 step 5), id-based with history —
-- replaces the old config key 'magen_commander' (a soldier NAME string).
-- The decision effective on schedule day D = the row with the latest
-- valid_from <= D. Written by the weekly-shavtzak flow.
create table magen_commander_history (
  valid_from date primary key,             -- first schedule day the decision applies to
  soldier_id bigint not null references soldiers,
  decided_at timestamp not null default timezone('Asia/Jerusalem', now()),
  note       text
);

-- ── Decision / fact tables (generator + human locks) ────────────────────────

create table schedule_days (
  day          date primary key,          -- schedule day starting day_start(day)
  status       text not null default 'draft'
               check (status in ('draft','generated','approved','published')),
  generated_at timestamp,
  approved_by  text,                       -- email of the officer who published (publish flow)
  published_at timestamptz,                -- when the day was published (publish flow)
  report_html  text,                       -- self-contained generation report (built at persist time)
  validation   jsonb not null default '[]'  -- snapshot of last validation run
);

-- Level 1: one top-level position (or מנוחה) per soldier per schedule day (H4).
create table day_assignments (
  day         date not null references schedule_days,
  soldier_id  bigint not null references soldiers,
  position_id smallint not null references positions,
  locked      boolean not null default false,
  source      text not null default 'auto' check (source in ('auto','manual','chain')),
  primary key (day, soldier_id)
);

-- Level 2: concrete assignments — the fact table (≙ sheet's "כל השבצק").
create table shift_assignments (
  id                bigint generated always as identity primary key,
  day               date not null references schedule_days,
  position_id       smallint not null references positions,
  sub_position_id   smallint references sub_positions,
  soldier_id        bigint not null references soldiers,
  period            tsrange not null check (upper(period) > lower(period)),
  seat_index        smallint not null default 1 check (seat_index >= 1),
  is_commander_seat boolean not null default false,
  locked            boolean not null default false,
  source            text not null default 'auto'
                    check (source in ('auto','manual','chain','import')),
  blocks_overlap    boolean not null default true,  -- false for readiness rows (H3 exception)
  violations        jsonb not null default '[]',    -- recorded fallbacks/forced warnings
  rationale         jsonb not null default '[]'     -- structured "why picked" entries (src/rationale.ts)
);
create index shift_assignments_day on shift_assignments (day);
create index shift_assignments_soldier on shift_assignments (soldier_id);

-- One row per concrete seat. Imported history is exempt: the sheet had no
-- seat concept, so source='import' rows all carry seat_index=1 within a slot.
create unique index shift_assignments_seat_key
  on shift_assignments (day, position_id, sub_position_id, period, seat_index)
  nulls not distinct
  where source <> 'import';

-- H3 at the DB level: overlapping assignments are impossible for blocking rows.
alter table shift_assignments add constraint no_double_booking
  exclude using gist (soldier_id with =, period with &&) where (blocks_overlap);

-- On-demand shift windows (חמל tab, 2026-07-24; reusable for מגן internal
-- shifts later) are stored as DAY-SCOPED slot_templates rows (valid_from =
-- valid_to = the schedule day) — the generic "add a shift on this one day"
-- mechanism. day_slots materializes them per day; seat_overrides resizes/
-- cancels them. חמל carries is_scheduled=false and NO permanent template, so a
-- virgin day emits no חמל slot; the חמל tab writes day-scoped templates only for
-- the windows shown (empty custom windows persist that way). חמל is manual-only:
-- the generator never auto-fills it. The picks are ordinary shift_assignments
-- rows whose period is the concrete shift window (computed like the day_slots
-- lateral) — see api/hamal.ts.

-- Emails allowed to see the scheduler tabs in the viewer app (SPEC §12),
-- independent of sheet role. Managed by hand in the Supabase dashboard.
create table shavtzak_admins (
  email    text primary key,     -- lowercased
  note     text,
  added_at timestamp not null default timezone('Asia/Jerusalem', now())
);

-- חמל-tab access is NOT a separate table: a חמל member is any soldier whose
-- role is a חמל staff role (the חמל position's config.staff_all_roles), matched
-- to the logged-in user by soldiers.email. The חמל tab is shown to admins OR
-- חמל members (viewer-side gate). See api/admins.ts. The index below serves the
-- case-insensitive email lookup.
create index soldiers_email_lower_idx on soldiers (lower(email));

-- Normalized-name lookup (api/exit-requests.ts resolveSoldier's fallback: a
-- name typed with different quote marks or doubled spaces must still resolve).
-- MUST STAY IN LOCKSTEP WITH normalizeName() in scheduler/src/text.ts:
--     (s ?? '').replace(/[״"׳'`]/g, '').replace(/\s+/g, ' ').trim()
-- Exact mirror: translate's `from` list is NBSP U+00A0, BOM U+FEFF, ״ " ׳ ' `
-- and its `to` is two spaces — NBSP/BOM (matched by JS \s but NOT by Postgres
-- \s) become plain spaces, the five quote characters have no counterpart and
-- are deleted; the \s+ collapse and btrim then mirror the last two JS steps.
-- All three functions are IMMUTABLE. NOT unique — two rows may normalize
-- alike (only full_name itself is unique); the caller takes the first match.
create index soldiers_name_normalized on soldiers (
  (btrim(regexp_replace(
     translate(full_name, chr(160) || chr(65279) || '״"׳''`', '  '),
     '\s+', ' ', 'g')))
);

create table sheet_sync_log (
  id         bigint generated always as identity primary key,
  direction  text not null check (direction in ('import','export')),
  target     text,
  day        date,
  status     text,
  detail     jsonb,
  created_at timestamp not null default timezone('Asia/Jerusalem', now())
);

-- ── Derived views ───────────────────────────────────────────────────────────

-- Presence matrix (what the sheet stores explicitly) — derived on demand.
create or replace function presence(from_day date, to_day date)
returns table (soldier_id bigint, day date, status text)
language sql stable as $$
  select s.id, d.day::date,
         coalesce(
           (select u.kind from unavailability u
             where u.soldier_id = s.id and u.period && day_range(d.day::date)
             order by hours(u.period * day_range(d.day::date)) desc limit 1),
           'נוכח')
  from soldiers s
  cross join generate_series(from_day, to_day, interval '1 day') d(day)
  where s.archived_at is null
$$;

-- Concrete slots per schedule day (template × calendar × seat overrides).
-- Zero-seat resolutions (cancelled slots) are omitted entirely.
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

-- Fairness counters as of a given day (rolling windows end at day_start(as_of)).
-- include_drafts (owner 2026-07-26, הוגנות tab toggle): true = a day's DRAFT
-- rows supersede its published rows (what the generator needs while building a
-- week); false = count only real published work. Default true keeps every
-- existing caller (load.ts, tests) on the old behaviour.
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
      and (sa.locked
           or case when include_drafts
                     then sa.source in ('auto','chain')
                          or not exists (select 1 from shift_assignments d
                                          where d.day = sa.day
                                            and d.source in ('auto','chain'))
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
