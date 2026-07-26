# DB schema review — findings & migration plan (2026-07-19)

Analysis-only deliverable. Nothing here has been applied; read-only SQL was run
against local `shavtzak_replay` (prod replica, a few days stale) and production
Supabase. Prod schema matches `schema.sql` exactly (no drift). Prod PG 17.6,
local Docker PG 16.14 — both support `UNIQUE NULLS NOT DISTINCT` (PG15+), which
the proposed DDL uses.

## 1. Executive summary

1. **FK migration (the driver)**: recommend **normalized tables** — one
   `position_candidates` table replaces both `candidate_pool` and
   `seat_rules[].soldiers`; a tiny `config_soldier` key→soldier_id table
   replaces the `magen_commander` name in `config`; `soldiers.allowed_positions
   text[]` becomes `soldier_allowed_positions`. id-arrays-in-jsonb rejected: no
   FK enforcement, which was the whole point.
2. All configured names currently resolve against the roster in **both** DBs
   (the spelling bug is already fixed live), so data migration is clean today.
   The misspelling still exists in the repo file `scheduler/db/rules-2026-07-18.sql:23`
   (`יוחאי יעקבסון` vs roster `יוחאי יעקובסון`) — historical, becomes moot.
3. `soldiers.full_name` unique index is **safe** (0 duplicates in both DBs) and
   is the keystone: import matching and the data migration both key on it.
4. H4 (one Level-1 bucket per soldier per day) is **already enforced** by the
   `day_assignments` PK — no change needed.
5. `shift_assignments` seat-duplicate protection must **exempt imported rows**:
   2,317 `source='import'` rows share `seat_index=1` within the same slot;
   auto/chain/manual rows are clean → partial unique index.
6. A plain `unavailability` overlap exclusion would **fail on prod** (11
   cross-kind overlapping pairs, by import design); a same-kind exclusion
   passes today but couples the import pipeline to it — owner call.
7. Performance: **no new indexes justified.** ~3k assignment rows; every hot
   query either hits an existing index or seq-scans a tiny table. The
   `no_double_booking` exclusion already provides a gist index. Revisit at
   ~50k rows.
8. Misc integrity: non-empty-range checks, `seat_index >= 1`, audit-timestamp
   defaults are UTC-skewed on Supabase (server TZ = UTC, everything else is
   Asia/Jerusalem wall-clock), one `role=''` row, stale platoon comment.

## 2. FK migration design (recommended)

### 2.1 Options weighed

| Option | Integrity | Code churn | Verdict |
|---|---|---|---|
| A. Normalized tables | Real FKs; deleting/renaming a soldier can never orphan a list | Moderate: `load.ts` gains 2 queries; comparisons switch from `nrm(name)` to `soldier_id` | **Recommended** |
| B. id-arrays in jsonb (`candidate_pool: [17, 23, …]`) | None — a typo'd id is as silent as a typo'd name; needs a validator lint forever | Small | Rejected |
| C. Hybrid (ids in jsonb + trigger validation) | Trigger-enforced | Small + trigger complexity | Rejected — more moving parts than A for less integrity |

Option A also kills the `normalizeName` dependence on these paths and lets the
`config_names` validator lint be **deleted** (FK + migration guards replace it).

### 2.2 DDL (goes into `schema.sql` baseline + live delta)

```sql
-- enable composite FK (position, sub) — guarantees a seat rule's sub belongs
-- to the same position
alter table sub_positions add constraint sub_positions_position_id_id_key
  unique (position_id, id);

-- One table for both closed lists:
--   sub_position_id NULL  = position-level pool (קצין מוצב candidate_pool)
--   sub_position_id set   = named candidates for that seat (חפק seat_rules)
-- priority: NULL = unordered (fairness-rotated); 1..n for ordered lists (קשר)
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

-- Soldier-valued config decisions (today: one row, key='magen_commander').
-- Replaces the name string in the config table with an FK.
create table config_soldier (
  key        text primary key,
  soldier_id bigint not null references soldiers,
  updated_at timestamp not null default timezone('Asia/Jerusalem', now())
);

-- H6c whitelist, normalized (replaces soldiers.allowed_positions text[])
create table soldier_allowed_positions (
  soldier_id  bigint   not null references soldiers on delete cascade,
  position_id smallint not null references positions,
  primary key (soldier_id, position_id)
);
```

`seat_rules` **stays in jsonb** but loses its `soldiers` arrays — the remaining
keys (`sub`, `roles`, `qual`, `ordered`, `commander`, `release_unpicked`) are
rule *metadata*, not soldier references. `roles`/`qual`/`staff_all_roles`/
`driver_qual` are role/qualification strings — see §6 Q3.

### 2.3 Data migration (live delta, single transaction)

```sql
begin;

-- SQL mirror of src/text.ts normalizeName (strip ״"׳'` + collapse whitespace)
create function pg_temp.norm(t text) returns text language sql immutable as
$$ select btrim(regexp_replace(translate(t, '״׳"''`', ''), '\s+', ' ', 'g')) $$;

-- candidate_pool → position_candidates (sub NULL, unordered)
insert into position_candidates (position_id, sub_position_id, soldier_id, priority)
select p.id, null, s.id, null
from positions p,
     jsonb_array_elements_text(p.config->'candidate_pool') n(name)
join soldiers s on pg_temp.norm(s.full_name) = pg_temp.norm(n.name);

-- seat_rules[].soldiers → position_candidates (per sub; priority iff ordered)
insert into position_candidates (position_id, sub_position_id, soldier_id, priority)
select p.id, sp.id, s.id,
       case when coalesce((r->>'ordered')::boolean, false)
            then n.ord::smallint end
from positions p,
     jsonb_array_elements(p.config->'seat_rules') r,
     jsonb_array_elements_text(r->'soldiers') with ordinality n(name, ord)
join sub_positions sp on sp.position_id = p.id
                     and pg_temp.norm(sp.name) = pg_temp.norm(r->>'sub')
join soldiers s on pg_temp.norm(s.full_name) = pg_temp.norm(n.name);

-- magen_commander → config_soldier
insert into config_soldier (key, soldier_id)
select 'magen_commander', s.id
from config c
join soldiers s on pg_temp.norm(s.full_name) = pg_temp.norm(c.value #>> '{}')
where c.key = 'magen_commander';

-- allowed_positions text[] → soldier_allowed_positions
insert into soldier_allowed_positions (soldier_id, position_id)
select s.id, p.id
from soldiers s,
     unnest(s.allowed_positions) ap(name)
join positions p on pg_temp.norm(p.name) = pg_temp.norm(ap.name);

-- GUARDS: abort if any name failed to resolve (count source names vs rows)
do $$
declare src bigint; dst bigint;
begin
  select count(*) into src from positions p,
    jsonb_array_elements_text(p.config->'candidate_pool');
  select count(*) into dst from position_candidates where sub_position_id is null;
  if src <> dst then raise exception 'candidate_pool: % names -> % rows', src, dst; end if;

  select count(*) into src from positions p,
    jsonb_array_elements(p.config->'seat_rules') r,
    jsonb_array_elements_text(r->'soldiers');
  select count(*) into dst from position_candidates where sub_position_id is not null;
  if src <> dst then raise exception 'seat_rules: % names -> % rows', src, dst; end if;

  select count(*) into src from config where key = 'magen_commander';
  select count(*) into dst from config_soldier where key = 'magen_commander';
  if src <> dst then raise exception 'magen_commander did not resolve'; end if;

  select count(*) into src from soldiers s, unnest(s.allowed_positions);
  select count(*) into dst from soldier_allowed_positions;
  if src <> dst then raise exception 'allowed_positions: % names -> % rows', src, dst; end if;
end $$;

-- Only after guards pass: remove the name-based sources
update positions set config = config - 'candidate_pool'
 where config ? 'candidate_pool';
update positions
   set config = jsonb_set(config, '{seat_rules}',
        (select jsonb_agg(r - 'soldiers')
           from jsonb_array_elements(config->'seat_rules') r))
 where config ? 'seat_rules';
delete from config where key = 'magen_commander';
alter table soldiers drop column allowed_positions;

commit;
```

Expected prod row counts: `position_candidates` = 8 (pool) + 7 (seat rules:
קשר 3, חובש 2, נהג 2) = **15**; `config_soldier` = 1; `soldier_allowed_positions`
= rows for the 2 soldiers that currently have arrays.

### 2.4 Seed / fresh-DB flow change

`seed.sql` runs **before** soldiers exist (they come from
`import/import_history.py`), so the baseline seed cannot insert
`position_candidates` rows. Plan:

- `seed.sql`: keep positions/seat_rules **without** any `soldiers` arrays and
  without `candidate_pool`.
- New **`scheduler/db/seed-candidates.sql`**: the current name manifests as
  `insert … select … join soldiers on norm(full_name)=norm(name)` statements
  with the same abort-on-unresolved guards; applied **after** the history
  import. Local-dev instructions in CLAUDE.md gain this one line.

### 2.5 Code-touch list (from full repo sweep)

| File | Change |
|---|---|
| `scheduler/src/model.ts` | Add a typed `PositionConfig`; `SeatRule.soldiers?: string[]` → resolved candidate soldier-ids; add `candidates` to the load context |
| `scheduler/src/load.ts` | +2 queries (`position_candidates`, `config_soldier`); `allowed_positions` now via `soldier_allowed_positions` join aggregated to position names (keeps `allowedIn` signature unchanged) |
| `scheduler/src/state.ts:101-118` | `allowedIn`: pool gate compares `soldier_id ∈ pool_ids` (drops `nrm`) |
| `scheduler/src/level1.ts:116-140` | seat-rule pre-pass: resolve candidates by soldier_id (byId map replaces byName) |
| `scheduler/src/level1.ts:235-285, 346-364` | closed-list pre-pass + מגן-commander reservation by soldier_id |
| `scheduler/src/generate.ts:88-112` | `ReportMeta.pools` / `magenCommander`: id → display name via roster map |
| `scheduler/src/validate.ts:390-496, 547-572` | seat-rule + role-gate checks by soldier_id |
| `scheduler/src/validate.ts:769-795` | **delete** the `config_names` lint (obsolete — FK + migration guards) |
| `scheduler/src/report.ts:535-548, 823-864`, `rationale.ts` | display names resolved from roster (cosmetic) |
| `.claude/skills/weekly-shavtzak/SKILL.md:25,38-39` | read/write `config_soldier` (`insert … select id from soldiers where full_name = …` + guard on FOUND) |
| `scheduler/db/schema.sql`, `seed.sql`, new `seed-candidates.sql` | §2.2 / §2.4 |
| `db/fk-migration-2026-07-19.sql` (new) | §2.3 live delta |
| `scheduler/SPEC.md` §9 + CLAUDE.md | document new tables; mark the name-list convention as DONE. `LOGIC.he.md` unaffected (storage detail, not an officer rule) |

Unaffected: `api/_handlers/draft.ts` / `api/_handlers/fairness.ts` / `api/_handlers/exit-requests.ts` /
`api/_handlers/admins.ts` (they consume validator output or don't touch these configs;
`draft.ts:91`'s `config ? 'staff_all_roles'` stays), `import/import_history.py`,
viewer components (render finding rule-names only).

### 2.6 Test impact

Fixtures stay **name-lookup-based** (testing policy): helpers insert candidates
via `insert into position_candidates … select id from soldiers where full_name = $1`.
Touched suites: `helpers.ts`, `poolfirst`, `seatrules`, `seatpairs`,
`rolegates`, `validator` (drop the `config_names` test; add an FK-violation
negative test), `miflag`, `oncall`, `exits`, `generator`, `restbucket`.

## 3. Table-by-table findings

**soldiers**
- [correctness] `alter table soldiers add constraint soldiers_full_name_key unique (full_name);`
  — names are matching keys for import + seed-candidates; 0 duplicates in both
  DBs. (A future real namesake must get a disambiguated name — §6 Q2.)
- [cosmetic] `update soldiers set role = null where role = '';` (1 row) +
  `check (role <> '')`.
- [cosmetic] Schema comment says platoon = `עלי / שילה / …`; real values are
  `1 / 2 / 3 / חמ"ל / מפל"ג / לא ידוע`. Fix the comment.
- [cosmetic] `phone` / `email` are 100% NULL (135 rows). Keep (future roster
  import may fill them) — just noting.
- [integrity] `allowed_positions` dropped by the §2 migration.

**soldier_qualifications** — fine as is (composite PK, cascade).

**positions** — `name` unique exists; hand-assigned smallint ids fine.
`config` loses its name lists per §2; gains a typed interface in code.

**sub_positions**
- [integrity] `unique (position_id, id)` (§2.2) to support the composite FK.

**slot_templates**
- [integrity] `check (duration_minutes > 0)`, `check (seats > 0)` — the
  no-overlap exclusion already covers the natural key (identical ranges
  overlap), so no extra unique needed.

**seat_overrides** — natural key unique exists; [integrity] `check (seats > 0)`.

**chain_rules**
- [integrity] `unique (target_position, target_start, source_position,
  source_start, source_day_offset)` — a duplicated rule would double-fill a
  chained window; cheap insurance on a 9-row table.

**config** — key PK fine; after §2 it holds only numeric/object tunables
(matches SPEC's "honest list" principle).

**schedule_days** — PK + status check fine. `generated_at` is code-written;
see the timestamp note below.

**day_assignments** — **H4 already enforced** by PK `(day, soldier_id)`; FKs
all present. No change.

**shift_assignments**
- [correctness] seat-duplicate protection, exempting imported history (which
  stores everything as `seat_index=1`):
  ```sql
  create unique index shift_assignments_seat_key
    on shift_assignments (day, position_id, sub_position_id, period, seat_index)
    nulls not distinct
    where source <> 'import';
  ```
  Passes on prod today (0 non-import duplicates across 597 auto/chain rows).
- [integrity] `check (upper(period) > lower(period))` (0 violations),
  `check (seat_index >= 1)`.

**unavailability**
- [integrity] `check (upper(period) > lower(period))` (0 violations).
- [owner call — §6 Q5] same-kind overlap exclusion:
  `exclude using gist (soldier_id with =, kind with =, period with &&)` —
  passes today, but a **plain** (soldier_id, period) exclusion would fail on
  11 prod pairs (see §4) and same-kind couples every future re-import to the
  constraint. Default recommendation: **skip** (the import truncates+rebuilds
  this table; the constraint would mostly police the importer, and the
  cross-kind overlaps are intentional).

**exit_requests** — already the model citizen (non-empty check, overlap
exclusion, cascade FK).

**shavtzak_admins / sheet_sync_log** — fine; `sheet_sync_log` has 0 rows
(sync-out not built yet — expected).

**Audit timestamps (cross-table)** [integrity-minor]: Supabase runs at
`timezone = UTC`, so `default now()` on naive `timestamp` columns stores UTC
wall-clock while all scheduling data is Asia/Jerusalem wall-clock (verified:
03:06 local stored as 00:06). Affected: `exit_requests.created_at`,
`shavtzak_admins.added_at`, `sheet_sync_log.created_at`, `config_soldier.updated_at`
(new), plus code-written `schedule_days.generated_at`. Fix:
```sql
alter table exit_requests   alter column created_at set default timezone('Asia/Jerusalem', now());
alter table shavtzak_admins alter column added_at   set default timezone('Asia/Jerusalem', now());
alter table sheet_sync_log  alter column created_at set default timezone('Asia/Jerusalem', now());
```
(+ audit the one `new Date()`/`now()` write path in `persist.ts` at
implementation time). Existing rows: 2–3h skew on audit-only columns — not
worth rewriting.

## 4. Duplicate / violation audit (prod + replica)

| Proposed constraint | Prod data status |
|---|---|
| `soldiers.full_name` unique | **PASSES** — 0 duplicates (135 soldiers, both DBs) |
| seat-key unique (non-import) | **PASSES** — 0 duplicates among 597 auto/chain rows. Would **FAIL without** the `source <> 'import'` filter: import rows routinely have 4–12 rows per (day, position, period) all with seat_index=1 |
| non-empty `period` checks | **PASSES** — 0 empty/inverted ranges in `unavailability` (881) and `shift_assignments` (2,988) |
| plain `unavailability` exclusion (soldier, period) | **FAILS** — 11 overlapping pairs, all cross-kind, e.g. soldier 28: `חופש ["2026-07-10 10:00","2026-07-13 10:00")` overlaps `חזרה ב14:00 ["2026-07-13 00:00","2026-07-13 14:00")` — deliberate import shape (return-day partial overlays the full block) |
| same-kind `unavailability` exclusion | **PASSES** — 0 same-kind overlaps |
| config name lists vs roster | **PASSES** — candidate_pool (8), seat_rules soldiers (7), magen_commander, all resolve in both DBs. Repo file `db/rules-2026-07-18.sql:23` still contains the misspelling `יוחאי יעקבסון` (already-applied one-off; leave as history) |
| `allowed_positions` vs position names | **PASSES** — all 4 distinct values match `positions.name` |

Volumes (prod): soldiers 135, unavailability 881, exit_requests 5,
shift_assignments 2,988, day_assignments 930, schedule_days 33 (24/6–26/7),
slot_templates 70, seat_overrides 0, chain_rules 9, config 4.

## 5. Performance review — no new indexes

Full query-shape catalog was extracted from `load.ts`, `validate.ts`,
`persist.ts`, `api/_handlers/draft.ts`, `api/_handlers/fairness.ts`, `api/_handlers/exit-requests.ts`,
`api/_handlers/admins.ts`, `cli.ts`. Conclusions:

- Existing indexes already cover the id/day-keyed shapes:
  `shift_assignments(day)`, `(soldier_id)`, the `no_double_booking` gist
  (which IS an index on `(soldier_id, period) where blocks_overlap`), PKs, and
  the two gist `(soldier_id, period)` indexes.
- `soldier_fairness()` full-scans `shift_assignments` per call (per generation
  day + per fairness request) — but `night_count_total` / `tracker_hours_total`
  genuinely need unbounded history, and 3k rows ≈ sub-millisecond. Revisit at
  ~50k rows (years away at ~90 rows/day).
- Period-only `&&` scans (`load.ts:43,48,50`, `validate.ts:49,64,76`,
  `persist.ts:43`) seq-scan tables of 5–3k rows — fine. If history ever grows:
  `create index … using gist (period)` on `shift_assignments` — **not now**.
- `api/_handlers/exit-requests.ts:130-135` filters by `schedule_day_of(lower(period))`
  (non-sargable) — 5 rows; code-side note only.
- [cosmetic] the `presence()` DB function is defined but never invoked from
  any TS code — keep (handy for ad-hoc SQL) or note as dormant.

## 6. Ordered implementation plan (after approval)

Baseline (`scheduler/db/schema.sql` + `seed.sql`, edited in place) and one live
delta `scheduler/db/fk-migration-2026-07-19.sql`, applied in this order:

1. **Baseline edits** — `schema.sql`: add §2.2 tables, `soldiers_full_name_key`,
   the check constraints and seat-key index from §3, timestamp defaults, drop
   `allowed_positions`, fix the platoon comment. `seed.sql`: strip `soldiers`
   arrays + `candidate_pool` from position configs. New
   `scheduler/db/seed-candidates.sql` (§2.4).
2. **Code changes** (§2.5) + test updates (§2.6), against a schema-built local
   DB; run `scheduler npm test` (143+ tests) + `npm run typecheck`.
3. **Live delta** `fk-migration-2026-07-19.sql`, one transaction:
   §2.2 DDL → §2.3 data moves → guards → jsonb strip + column drop →
   §3 constraints (unique full_name, checks, seat-key index, chain_rules
   unique, timestamp defaults).
4. **Apply to Supabase** (psql-via-Docker per supabase-access skill), then
   verification queries:
   ```sql
   select count(*) from position_candidates;                -- expect 15
   select key, soldier_id from config_soldier;              -- magen_commander → id of צבי שור
   select count(*) from soldier_allowed_positions;          -- expect rows for 2 soldiers
   select count(*) from positions where config ? 'candidate_pool'
       or config->'seat_rules' @? '$[*].soldiers';          -- expect 0
   select count(*) from config where key = 'magen_commander'; -- expect 0
   ```
   then generate a draft day with `--dry-run` and run the validator over the
   current week — 0 new errors, and `config_names` findings gone.
5. **Docs**: SPEC §9, CLAUDE.md convention marked migrated, weekly-shavtzak
   SKILL.md SQL.
6. Commit sequence: (a) schema/seed baseline + delta file, (b) code + tests,
   (c) docs — or one PR with those three commits.

Rollback: the delta is a single transaction — any guard failure aborts it
whole. Post-commit rollback = re-add the jsonb keys from `config_soldier` /
`position_candidates` content (reverse mapping is lossless).

## 7. Open questions for the owner

1. **magen_commander storage**: recommended `config_soldier` key→soldier_id
   (single current value, matching today's semantics). Alternative: a dated
   `magen_commander_history(week_start date pk, soldier_id)` that preserves
   weekly decisions — nicer audit trail, slightly more code. Which?
2. **`soldiers.full_name` unique**: OK that a future genuine namesake must be
   entered with a disambiguator (e.g. + last initial of platoon)? Recommend yes.
3. **Roles**: `soldiers.role` / `staff_all_roles` / `seat_rules[].roles` are
   free-text role strings with no catalog (18 distinct values incl. one `''`
   and qualification-like values `נהג דוד`/`קלע`/`נגב` used as roles). A
   `roles` table feels like overkill at this scale — recommend **no table**;
   optionally add a validator lint that configured role strings match some
   soldier's role. Same call for `driver_qual`/`qual` vs a qualifications
   catalog. Agree?
4. **ON DELETE for soldiers with history**: `shift_assignments`/`day_assignments`
   FKs are NO ACTION (delete blocked while history exists) — recommend keeping
   (archival = `is_schedulable=false`). Confirm?
5. **unavailability same-kind overlap exclusion**: add it (couples the sheet
   re-import to the constraint) or skip (recommended)?
6. **Audit-timestamp fix**: switch defaults to `timezone('Asia/Jerusalem', now())`
   (recommended, keeps naive-local convention) vs migrating audit columns to
   `timestamptz` (inconsistent with the rest of the schema)?
