---
name: supabase-access
description: Connect to and operate on the shared shavtzak-scheduler Supabase Postgres — credentials, psql-via-Docker (no host psql), applying migrations, importing sheet history, and replacing draft days with real data. Use for any read/write against the production scheduler DB, "apply migration to Supabase", "import from the sheet", or SCHEDULER_DATABASE_URL questions.
---

# Supabase access (scheduler production DB)

## Connection

- Supabase account **shavtzakshilo@gmail.com** (password: ask Elyashiv Lavi), project `shavtzak-scheduler`, region eu-central-1:
  https://supabase.com/dashboard/project/yoaymfryftsqqjjyvwym
- Session-pooler URI:
  `postgres://postgres.yoaymfryftsqqjjyvwym:<DB_PASSWORD>@aws-0-eu-central-1.pooler.supabase.com:5432/postgres`
- DB password on Elyashiv's Mac (or Dashboard → Project Settings → Database):

```bash
DB_PASS=$(security find-generic-password -s supabase-shavtzak-db -w)
URI="postgres://postgres.yoaymfryftsqqjjyvwym:${DB_PASS}@aws-0-eu-central-1.pooler.supabase.com:5432/postgres"
```

- **No `psql` on the host.** Use the local Docker container's psql (network out works fine):

```bash
docker exec -i shavtzak-pg psql "$URI" < some.sql        # run a file
docker exec shavtzak-pg psql "$URI" -c "select ..."      # one-liner
```

- App/CLI code connects via one env var: `export SCHEDULER_DATABASE_URL="$URI"`.
  Local-dev fallback when unset: `postgres://postgres:test@localhost:55432/postgres`.
- **Gotcha:** `scripts/dev-api.ts` re-reads `.env`/`.env.local` at import time and
  **overwrites** `process.env` — a shell-exported `SCHEDULER_DATABASE_URL` does NOT
  reach the dev API. To point it elsewhere, edit `.env.local` or use a wrapper that
  resets the var after importing the script (handlers + pg pool load lazily per request).
- **Gotcha — killed `docker exec` ≠ killed query:** a host-side timeout/kill of
  `docker exec ... psql` does NOT kill psql inside the container — the statement
  (even a whole transaction) may complete and COMMIT after the "timeout". Before
  retrying anything, query the DB to see what actually happened; a retry that
  assumes rollback can double-apply or conflict.
- **Batch writes over the WAN pooler:** row-by-row inserts cost ~100ms+ each
  through the pooler (880 single inserts blew a 2-minute timeout). For anything
  beyond a few dozen rows, emit one multi-row `insert ... values (...),(...)`
  statement (same pattern `persist()` uses).

## Applying schema changes

`scheduler/db/schema.sql` + `db/seed.sql` are the **consolidated baseline** —
tests and fresh builds use only them. `db/migrations/` is **archived**
(`db/migrations/archive/` + README): those files were applied to Supabase
historically and must **NEVER be replayed** onto a schema.sql-built DB (the
id-13 reuse would delete the live בבית position). New live-DB deltas go in a
standalone, idempotent, one-off file (e.g. `db/consolidation-2026-07-17.sql`):
edit schema.sql/seed.sql first (tests rebuild from them), mirror the delta in
the one-off file, apply to local Docker, run the test suite, then apply to
Supabase with the file-run pattern above.

## Importing real assignments from the Google Sheet

### ASK FIRST — always scope the refresh before touching anything

A sheet refresh has a much wider blast radius than it looks (a single "sync the
sheet" once rewrote shifts, the roster and the whole `unavailability` table).
**Before fetching or writing anything, ask the owner two questions** — do not
infer the answers, do not widen the scope you were given:

1. **Which dates?** Exact schedule days (14:00→14:00), e.g. "24/07 and 25/07".
   Never extend to neighbouring days on your own — if a neighbouring day is
   still a draft while the sheet already holds real data for it, *report* that
   and let the owner decide; do not import it.
2. **Which data?** — default is **שבצק only**:
   - **שבצק only** (the usual answer): `shift_assignments` from the `כל השבצק`
     tab. Touch nothing else.
   - **שבצק + נוכחות**: also reconcile `unavailability` from the `מצבת החיילים`
     presence matrix. **Only on explicit request** — see the נוכחות warning
     below.
   - **everything**: also roster fields, qualifications, dedupe (`cleanup.py`
     parts 2 & 3). Rare; confirm the blast radius first.

> **נוכחות (`נוכח`/`חופש`) is NOT reliably in sync with the שבצק**
> (owner, 2026-07-26). The officers keep scheduling from the שבצק tab while the
> presence matrix lags. Take the שבצק rows **as-is** and do not "fix" them
> against the roster. Expect leftover `availability` validator errors on
> imported days — they are the two tabs disagreeing, not an import bug. Never
> rebuild `unavailability` as a side effect of a shift import.

Pipeline: fetch tabs → filter to the agreed schedule days → `import_history.py`
→ SQL → psql.

1. **Fetch tabs via the Sheets values API** (service account key in root `.env`,
   `GOOGLE_SERVICE_ACCOUNT_KEY` base64 + `GOOGLE_SHEET_ID`), tabs `כל השבצק` and
   `מצבת החיילים`, write as CSV.
2. **Filter the history CSV to only the new sheet dates** (`תאריך` column,
   `DD/MM/YYYY`) — for schedule days D..E that is sheet dates **D..E+1**. The
   import SQL has NO dedupe for readiness rows (`blocks_overlap=false`) —
   re-importing existing dates silently duplicates them (blocking rows are
   caught by the `no_double_booking` EXCLUDE, row-by-row). **Never pipe the
   generated SQL twice** (e.g. once to count inserts, once to grep errors —
   that re-runs it).
3. Generate SQL, bounding the output by **schedule-day timestamps** so the
   sheet-date spill into the neighbouring days is dropped instead of colliding
   with their drafts (`--start-ts`/`--end-ts` filter on the row's computed
   start; this is what keeps a "just 24-25/07" refresh from touching day 23):

   ```bash
   python3 scheduler/import/import_history.py --roster roster.csv --history filtered.csv \
       --start-ts '2026-07-24 14:00' --end-ts '2026-07-26 14:00' > import.sql
   ```
4. **Verify every soldier name resolves before importing** (normalize with
   `import_history.nkey` and diff against `select full_name from soldiers`) —
   assignment inserts resolve soldiers by `full_name ... limit 1`, so an
   unknown/misspelled name silently drops or misattributes rows. Soldier
   inserts no-op cleanly via `on conflict (personal_number)`. Keep `--roster`
   even in a שבצק-only refresh: it is what lets a **newly enlisted** soldier
   (e.g. מנדי הלפרין, גיוס 21/07/2026) exist so his shifts resolve. It only
   inserts missing `soldiers` rows — it does not touch `unavailability`.
5. If a day being imported already exists as a draft, **delete its unlocked draft
   rows first** (locked/manual survive):

```sql
delete from shift_assignments where day in ('YYYY-MM-DD', ...) and source in ('auto','chain') and not locked;
delete from day_assignments   where day in ('YYYY-MM-DD', ...) and source='auto' and not locked;
-- ... run import.sql inserts ...
update schedule_days set status='published' where day in ('YYYY-MM-DD', ...);
```

6. Verify:

```sql
select day, source, count(*) from shift_assignments where day between 'START' and 'END' group by 1,2 order by 1,2;
select count(*) total, count(distinct full_name) names from soldiers;  -- must be equal
```

### Schedule-day boundary trap

Sheet dates are calendar dates; DB days are 14:00→14:00 (`schedule_day_of`). Rows
dated D with start < 14:00 land on schedule day **D−1**. So "import day D" really
means: import sheet dates **D and D+1's morning rows**; conversely importing sheet
date D also completes schedule day D−1's tail. Let `infer_period` +
`schedule_day_of()` sort out where each row lands, and bound the result with
`--start-ts/--end-ts` at the schedule-day edges — that is the only way to refresh
day D without writing into a neighbour that is still a draft.

### Night-row cutover (2026-07-21) — the sheet changed convention

Up to **20/07/2026** a row dated D with an hour `< 06:00` meant D+1 (the sheet's
block ran 06:00→06:00); from **21/07/2026** the officers write the true calendar
date and there is no carry. `NIGHT_CUTOVER` in `import_history.py` encodes this;
never "fix" older rows to the new convention.

How it was pinned down (repeat this if the convention ever shifts again): compare
the sheet's `02:00` rows for one position against what the DB already holds.
Sheet 19/07 02:00 == DB `2026-07-20 02:00`, but sheet 21/07 and 22/07 02:00 ==
DB `2026-07-21` / `2026-07-22 02:00`. The transition also leaves a **one-date
gap** — עמדות הגנה has no 02:00 row on sheet date 20/07 and חמל none on 21/07,
because that night's row moved to the following date's block. A missing 02:00 row
around a convention change is the fingerprint, not missing data.

### Import notes

- **Daily-window cutover (2026-07-19)**: `infer_period` maps יומי/hour-less
  rows dated **before** 19/07 to the historical windows (מגן/חפק 06:00–22:00,
  התקפי/כרמל 06:00→06:00, תורנים 07:30–22:00) and rows **from** 19/07 to the
  14:00→14:00 schedule day. Never "fix" old rows to the new anchor.
- **Precise incremental import**: for a partial refresh (new sheet dates over
  existing data), compute want-vs-have with `infer_period`-derived keys
  (cleanup.py's construction) and import only the missing rows — piping the
  whole date range again duplicates readiness rows. Run the assignment inserts
  WITHOUT a wrapping transaction: genuine יומי-alongside-shift overlaps must
  fail row-by-row against `no_double_booking`, then be re-added with
  `blocks_overlap=false`.
- **Find the rejected rows by diffing want-vs-have, never by parsing the psql
  log.** `psql -a` interleaves echoed statements with `ERROR`/`DETAIL` lines and
  naive pairing miscounts (two attempts gave 13 and 10 for the same 11 real
  failures). Instead re-derive the want-set with `infer_period` and diff it
  against `select s.full_name, p.name, lower(period), upper(period) ... where
  source='import'`; the `MISSING` list is exactly what to re-insert with
  `blocks_overlap=false`, and it doubles as the post-import proof (`want N ==
  have N`, zero missing, zero extra). Typical rejects: `תפיסת בית 12:00-23:59`
  on top of the previous day's `כח <שם>` 14:00→14:00, and a morning
  `עמדות הגנה` shift on top of a יומי duty.
- **Bus-boundary reconciliation** (נוכחות scope only — skip it on a שבצק-only
  refresh): when imported real shifts run PAST a soldier's 08:00 block start
  (morning handovers at 09:00/10:00), anchor that block's start to the real
  descent time or the day flags false `availability` errors. Solvable purely in
  SQL — join `unavailability` to that day's `source='import'` rows, take
  `max(upper(a.period))`, then `update` the window's start (and `delete` the
  windows the descent swallows whole):

  ```sql
  create temporary table descent on commit drop as
  select u.soldier_id, u.period old_period, max(upper(a.period)) real_descent
    from unavailability u
    join shift_assignments a on a.soldier_id = u.soldier_id and a.day = 'D'
     and a.source = 'import' and upper(a.period) > lower(u.period)
   where lower(u.period) >= 'D+1 00:00' and lower(u.period) < 'D+1 14:00'
   group by u.soldier_id, u.period;
  ```

- **NEVER run `cleanup.py`'s Part 3 (`truncate unavailability`) to refresh
  presence.** The rebuild is naive-bus-hour and would wipe every hand-reconciled
  boundary across all past months (a 2026-07-26 diff was 220 adds / 211 removes,
  almost all of them boundary hours being reset from 09:00/10:00 back to 08:00).
  When נוכחות really is in scope, do **interval surgery clipped to the requested
  schedule days**: delete the overlapping row, re-insert the pieces outside the
  window, leaving every out-of-window boundary untouched.

- **כונן גשש 8h windows (sheet format since 19/07)**: rows now come as
  סוג=`נוספים` with a single time (14:00/22:00/06:00) meaning an 8-hour
  chained window. FIXED 19/07: `SINGLE_TIME_DURATION` in
  `import_history.py` now has a `כונן גשש: 8` entry, so these parse
  normally (`blocks_overlap=false` comes from the existing canon list). On
  an older checkout without the fix they are silently skipped by import AND
  by cleanup/diff want-sets and show up as false "stale" rows in a reverse
  diff.
- **Real rows that cross 14:00 into a still-draft next day** (e.g. תורנים
  with explicit times `7:30-20:30`) collide with that draft's rows on
  `no_double_booking`. Delete the conflicting unlocked `auto` row (drafts are
  regenerable/stale anyway) and insert the real row blocking — do NOT
  mislabel a real blocking duty with `blocks_overlap=false`.
- **Stored validation snapshots** (`schedule_days.validation`) are NOT NULL,
  default `'[]'::jsonb`. Refresh them with
  `SCHEDULER_DATABASE_URL=$URI npx tsx src/cli.ts validate <day>` (it writes the
  column). If the CLI can't be run (e.g. scheduler/src mid-edit), reset
  refreshed days to `'[]'::jsonb` rather than leaving the stale draft-era
  snapshot.
- Sheet position names map to DB positions via keyword matching
  (`POSITION_MAP` in `import_history.py`); unmatched names fall to the
  catch-all `אחר` (id 99). **When a new position name appears in the sheet,
  add a keyword** — and mind Hebrew final-letter forms in substring matches
  (a keyword ending in ן won't match the medial-נ spelling inside a longer
  word). Order matters: a more specific keyword must precede the prefix it
  contains (`חפק2` before `חפק`). Before importing, dry-run
  `canonical_position` over the date range and assert **nothing lands in
  `אחר`** — that check is what surfaces a new position at all.
- **New position vs. new sub-position** (2026-07-26 precedent): a distinct
  standing team becomes a **position** (`חפק2`, id 16 — the second חפק crew);
  an ad-hoc mission whose name changes weekly becomes a **sub-position** of the
  umbrella position `משימות שונות` (id 15) — the sheet writes those as
  `כח <שם>` / `תפיסת בית`. Both are `is_scheduled=false`: the generator never
  invents them, but the imported rows still occupy the soldier for rest,
  double-booking and fairness (`load.ts` reads assignments regardless of
  `is_scheduled`; `api/draft.ts` displays them).
- The importer resolves `sub_position_id` **by name** from the sheet's
  `העמדה` column, scoped to the canonical position (unknown names simply stay
  NULL). So a new named force only needs a `sub_positions` row — no code change.
- **Placeholders in the `החייל` column** are not soldiers: `השתנה` ("changed",
  in `IGNORE_SOLDIERS`) and outsiders written as `name 05X-XXXXXXX`
  (`PHONE_IN_NAME`). Both are skipped.
- Roster inserts use `on conflict (personal_number) do nothing`, so two failure
  modes surface as loud-but-harmless errors: a roster soldier whose
  `full_name` already exists under a **different** personal number
  (`soldiers_full_name_key`), and one with an empty `תפקיד`
  (`soldiers_role_check`). Check whether the soldier appears in the imported
  date range before caring.
- After importing real data over former draft days, later drafts (generated
  against the draft fairness picture) are stale — regenerate them.
- After importing over days that already carry a stored validation snapshot,
  **refresh it** (`npx tsx src/cli.ts validate <day>`) — the draft tab
  validates live, but the stored `schedule_days.validation` column doesn't
  update itself. Expect historical days to flag "errors" against rules that
  postdate them (e.g. the removed attack↔readiness exception) — that's the
  validator judging old reality by current rules, not a data problem.

### Reconciling sheet edits (the sheet is edited retroactively)

`cleanup.py`'s diff only finds rows MISSING from the DB — it never detects DB
rows the sheet no longer has (a swapped/edited shift leaves a stale row behind).
When counts look off, also run the **reverse diff**: recompute the want-set with
`cleanup.py`'s exact key construction (`infer_period(date, position, typ,
time_text, canon)` — mind the argument order — and `ts()` formatting) and list
`have − want`. Wholesale re-import of the affected dates is often simpler and
is safe: delete those days' `source='import'` rows first, re-import, then
re-run `cleanup.py` (its overlap pass re-adds the ~40 known
`blocks_overlap=false` rows the EXCLUDE constraint rejects row-by-row).

## Safety

- Drafts (`source in ('auto','chain')`, unlocked) are regenerable — safe to delete.
  `source='import'`/`'manual'` and `locked` rows are truth — never bulk-delete.
- Tests must NEVER run against Supabase (they use local `shavtzak_test`).
  `python3 -m unittest discover -s scheduler/import` covers the sheet→DB mapping
  (night cutover, `POSITION_MAP`, placeholder names) with no DB at all — run it
  after any `import_history.py` change.
- **Elyashiv runs parallel Claude sessions against this same DB.** A day that was
  a bare draft when you started can be fully generated minutes later. Re-read the
  state right before you delete or overwrite, and keep the write scope to the
  days you were given.
