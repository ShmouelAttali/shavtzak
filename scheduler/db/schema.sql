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

create table soldiers (
  id              bigint generated always as identity primary key,
  personal_number text unique not null,
  full_name       text not null,
  platoon         text not null,          -- עלי / שילה / גבעות צפון / גבעות דרום / מפלג
  role            text,                   -- מ"פ / מ"מ / סמל / מ"כ / לוחם ...
  rifle_level     int,                    -- רובאי
  phone           text,
  email           text,
  is_schedulable  boolean not null default true,  -- H2: מפלג / חמ"ל => false
  notes           text
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
  period     tsrange not null,
  kind       text not null,               -- 'חופש','לא מגויס','יציאה','מחלה',...
  note       text
);
create index unavailability_soldier_period on unavailability using gist (soldier_id, period);

create table positions (
  id            smallint primary key,
  name          text unique not null,     -- 'סיור','עמדות הגנה','כוננות','מנוחה',...
  mission_class text not null check (mission_class in ('static','dynamic','readiness','rest','other')),
  is_scheduled  boolean not null default true,   -- חמל => false
  blocks_day    boolean not null default false,  -- H5: קצין מוצב, משימות יומי
  config        jsonb not null default '{}'
);

create table sub_positions (
  id            smallint primary key,
  position_id   smallint not null references positions,
  name          text not null,            -- 'שג','בונקר','מזרחית','דרומית','מפקד כרמל חטיבה',...
  required_role text,                     -- 'commander' | 'senior_commander' | null (H6)
  unique (position_id, name)
);

-- Versioned slot template; concrete per-day slots are derived (day_slots view).
create table slot_templates (
  id                   smallint generated always as identity primary key,
  position_id          smallint not null references positions,
  sub_position_id      smallint references sub_positions,
  start_time           time not null,
  duration_minutes     int  not null,
  seats                smallint not null default 1,
  commander_first_seat boolean not null default false,  -- H6: first seat = commander
  valid_from           date not null,
  valid_to             date                              -- null = still active
);

-- Per-position seat-count changes over time (seats PER SLOT; latest
-- valid_from <= day wins). Managed by hand — resolved by the day_slots view.
create table seat_overrides (
  id          smallint generated always as identity primary key,
  position_id smallint not null references positions,
  valid_from  date not null,
  seats       smallint not null,
  note        text,
  unique (position_id, valid_from)
);

-- T4 chained duties as data.
create table chain_rules (
  id               smallint primary key,
  target_position  smallint not null references positions,  -- כרמל / כוננות / כונן גשש
  target_start     time not null,
  source_position  smallint not null references positions,  -- עמדות הגנה / סיור
  source_start     time not null,
  source_day_offset int not null default 0,                 -- -1 = source shift from previous schedule day
  pick             text not null default 'all'
                   check (pick in ('all','highest_rifle','min_tracker_hours'))
);

-- All tunables: night window, day anchor, rest thresholds, scoring weights,
-- priority list, readiness hour weight, excluded keywords...
create table config (
  key   text primary key,
  value jsonb not null
);

-- ── Decision / fact tables (generator + human locks) ────────────────────────

create table schedule_days (
  day          date primary key,          -- schedule day starting day_start(day)
  status       text not null default 'draft'
               check (status in ('draft','generated','approved','published')),
  generated_at timestamp,
  approved_by  text,
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
  period            tsrange not null,
  seat_index        smallint not null default 1,
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

-- H3 at the DB level: overlapping assignments are impossible for blocking rows.
alter table shift_assignments add constraint no_double_booking
  exclude using gist (soldier_id with =, period with &&) where (blocks_overlap);

-- Emails allowed to see the scheduler tabs in the viewer app (SPEC §12),
-- independent of sheet role. Managed by hand in the Supabase dashboard.
create table shavtzak_admins (
  email    text primary key,     -- lowercased
  note     text,
  added_at timestamp not null default now()
);

create table sheet_sync_log (
  id         bigint generated always as identity primary key,
  direction  text not null check (direction in ('import','export')),
  target     text,
  day        date,
  status     text,
  detail     jsonb,
  created_at timestamp not null default now()
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
$$;

-- Concrete slots per schedule day (template × calendar × seat overrides).
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

-- Fairness counters as of a given day (rolling windows end at day_start(as_of)).
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
    select sa.soldier_id, sa.period, sa.day, p.mission_class, p.name as position_name
    from shift_assignments sa
    join positions p on p.id = sa.position_id
    where p.mission_class <> 'rest'
  )
  select s.id,
    count(*) filter (where b.period && night_range(b.day)
                       and b.period && tsrange(w.t_start, w.t_end)
                       and b.mission_class <> 'readiness')             as night_count_7d,
    count(*) filter (where b.period && night_range(b.day)
                       and lower(b.period) < w.t_end
                       and b.mission_class <> 'readiness')             as night_count_total,
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
    select soldier_id, period, day, mission_class, position_name,
           count(*) over (partition by soldier_id, position_name) as cnt
    from base
  ) b on b.soldier_id = s.id and lower(b.period) < w.t_end
  group by s.id, w.t_end
$$;
