-- ============================================================================
-- Live-DB delta (Supabase) — FK migration + integrity constraints, 2026-07-19.
-- Companion of the same-day schema.sql baseline update; one-off, do not replay
-- on a schema.sql-built DB.
--
-- What it does (single transaction, aborts whole on any failure):
--   1. New id-based tables: position_candidates, magen_commander_history,
--      soldier_allowed_positions.
--   2. Migrates the name-based configs into them (candidate_pool,
--      seat_rules[].soldiers, config.magen_commander, soldiers.allowed_positions),
--      with abort-on-unresolved-name guards.
--   3. Strips the name lists from jsonb / drops the text[] column.
--   4. Adds the integrity constraints from the 2026-07-19 schema review
--      (unique full_name, non-empty ranges, seat uniqueness, same-kind
--      unavailability exclusion, checks, local-naive audit defaults).
-- Verified against prod data 2026-07-19: every constraint passes; expected
-- position_candidates rows = 15.
-- ============================================================================

begin;

-- SQL mirror of src/text.ts normalizeName
create function pg_temp.norm(t text) returns text language sql immutable as
$$ select btrim(regexp_replace(translate(t, '״׳"''`', ''), '\s+', ' ', 'g')) $$;

-- ── 1. New tables ────────────────────────────────────────────────────────────

alter table sub_positions add constraint sub_positions_position_id_id_key
  unique (position_id, id);

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

create table magen_commander_history (
  valid_from date primary key,
  soldier_id bigint not null references soldiers,
  decided_at timestamp not null default timezone('Asia/Jerusalem', now()),
  note       text
);

create table soldier_allowed_positions (
  soldier_id  bigint   not null references soldiers on delete cascade,
  position_id smallint not null references positions,
  primary key (soldier_id, position_id)
);

-- ── 2. Data migration ────────────────────────────────────────────────────────

-- candidate_pool → position_candidates (sub NULL, unordered)
insert into position_candidates (position_id, sub_position_id, soldier_id, priority)
select p.id, null, s.id, null
from positions p,
     jsonb_array_elements_text(p.config->'candidate_pool') n(name)
join soldiers s on pg_temp.norm(s.full_name) = pg_temp.norm(n.name)
where jsonb_typeof(p.config->'candidate_pool') = 'array';

-- seat_rules[].soldiers → position_candidates (per sub; priority iff ordered)
insert into position_candidates (position_id, sub_position_id, soldier_id, priority)
select p.id, sp.id, s.id,
       case when coalesce((r->>'ordered')::boolean, false)
            then n.ord::smallint end
from positions p
cross join lateral jsonb_array_elements(p.config->'seat_rules') r
cross join lateral jsonb_array_elements_text(r->'soldiers') with ordinality n(name, ord)
join sub_positions sp on sp.position_id = p.id
                     and pg_temp.norm(sp.name) = pg_temp.norm(r->>'sub')
join soldiers s on pg_temp.norm(s.full_name) = pg_temp.norm(n.name);

-- config.magen_commander (name) → magen_commander_history (id), effective today
insert into magen_commander_history (valid_from, soldier_id, note)
select current_date, s.id, 'migrated from config.magen_commander'
from config c
join soldiers s on pg_temp.norm(s.full_name) = pg_temp.norm(c.value #>> '{}')
where c.key = 'magen_commander';

-- soldiers.allowed_positions text[] → soldier_allowed_positions
insert into soldier_allowed_positions (soldier_id, position_id)
select s.id, p.id
from soldiers s,
     unnest(s.allowed_positions) ap(name)
join positions p on pg_temp.norm(p.name) = pg_temp.norm(ap.name);

-- GUARDS: abort if any name failed to resolve
do $$
declare src bigint; dst bigint;
begin
  select count(*) into src from positions p,
    jsonb_array_elements_text(p.config->'candidate_pool')
    where jsonb_typeof(p.config->'candidate_pool') = 'array';
  select count(*) into dst from position_candidates where sub_position_id is null;
  if src <> dst then raise exception 'candidate_pool: % names -> % rows', src, dst; end if;

  select count(*) into src from positions p,
    jsonb_array_elements(p.config->'seat_rules') r,
    jsonb_array_elements_text(r->'soldiers');
  select count(*) into dst from position_candidates where sub_position_id is not null;
  if src <> dst then raise exception 'seat_rules: % names -> % rows', src, dst; end if;

  select count(*) into src from config where key = 'magen_commander';
  select count(*) into dst from magen_commander_history;
  if src <> dst then raise exception 'magen_commander did not resolve'; end if;

  select count(*) into src from soldiers s, unnest(s.allowed_positions);
  select count(*) into dst from soldier_allowed_positions;
  if src <> dst then raise exception 'allowed_positions: % names -> % rows', src, dst; end if;
end $$;

-- ── 3. Remove the name-based sources ────────────────────────────────────────

-- keep the closed-list marker, drop the names (membership now = table rows)
update positions set config = jsonb_set(config, '{candidate_pool}', 'true')
 where jsonb_typeof(config->'candidate_pool') = 'array';
update positions
   set config = jsonb_set(config, '{seat_rules}',
        (select jsonb_agg(r - 'soldiers')
           from jsonb_array_elements(config->'seat_rules') r))
 where config ? 'seat_rules';
delete from config where key = 'magen_commander';
alter table soldiers drop column allowed_positions;

-- ── 4. Integrity constraints (2026-07-19 review) ────────────────────────────

-- soldiers: names are data keys — exactly one soldier per name
alter table soldiers add constraint soldiers_full_name_key unique (full_name);
update soldiers set role = null where role = '';
alter table soldiers add constraint soldiers_role_check check (role <> '');

alter table slot_templates
  add constraint slot_templates_duration_minutes_check check (duration_minutes > 0),
  add constraint slot_templates_seats_check check (seats > 0);
alter table seat_overrides
  add constraint seat_overrides_seats_check check (seats > 0);
alter table chain_rules
  add constraint chain_rules_target_position_target_start_source_position_s_key
  unique (target_position, target_start, source_position, source_start, source_day_offset);

alter table unavailability
  add constraint unavailability_period_check check (upper(period) > lower(period));
-- same-kind overlap = double entry (cross-kind overlaps are intentional import
-- shapes and stay allowed); the sheet re-import must uphold this
alter table unavailability add constraint unavailability_no_same_kind_overlap
  exclude using gist (soldier_id with =, kind with =, period with &&);

alter table shift_assignments
  add constraint shift_assignments_period_check check (upper(period) > lower(period)),
  add constraint shift_assignments_seat_index_check check (seat_index >= 1);
-- one row per concrete seat; imported history (no seat concept) exempt
create unique index shift_assignments_seat_key
  on shift_assignments (day, position_id, sub_position_id, period, seat_index)
  nulls not distinct
  where source <> 'import';

-- audit timestamps: local naive wall-clock (server TZ is UTC — bare now()
-- skewed these 2-3h vs the rest of the schema; existing rows left as-is)
alter table exit_requests   alter column created_at set default timezone('Asia/Jerusalem', now());
alter table shavtzak_admins alter column added_at   set default timezone('Asia/Jerusalem', now());
alter table sheet_sync_log  alter column created_at set default timezone('Asia/Jerusalem', now());

commit;

-- ── Post-apply verification (read-only) ─────────────────────────────────────
-- select count(*) from position_candidates;                      -- expect 15
-- select * from magen_commander_history;                         -- צבי שור's id, valid_from today
-- select count(*) from soldier_allowed_positions;                -- expect 4
-- select count(*) from positions
--   where jsonb_typeof(config->'candidate_pool') = 'array'
--      or config->'seat_rules' @? '$[*].soldiers';               -- expect 0
-- select count(*) from config where key = 'magen_commander';     -- expect 0
