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

Pipeline: fetch tabs → filter dates → `import_history.py` → SQL → psql.

1. **Fetch tabs via the Sheets values API** (service account key in root `.env`,
   `GOOGLE_SERVICE_ACCOUNT_KEY` base64 + `GOOGLE_SHEET_ID`), tabs `כל השבצק` and
   `מצבת החיילים`, write as CSV.
2. **Filter the history CSV to only the new sheet dates** (`תאריך` column,
   `DD/MM/YYYY`). The import SQL has NO dedupe for readiness rows
   (`blocks_overlap=false`) — re-importing existing dates silently duplicates them
   (blocking rows are caught by the `no_double_booking` EXCLUDE, row-by-row).
   **Never pipe the generated SQL twice** (e.g. once to count inserts, once to grep
   errors — that re-runs it).
3. Generate SQL:
   `python3 scheduler/import/import_history.py --roster roster.csv --history filtered.csv > import.sql`
4. **Verify every soldier name resolves before importing** (normalize with
   `import_history.nkey` and diff against `select full_name from soldiers`) —
   assignment inserts resolve soldiers by `full_name ... limit 1`, so an
   unknown/misspelled name silently drops or misattributes rows. Soldier
   inserts no-op cleanly via `on conflict (personal_number)`.
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
dated D with start < 14:00 land on schedule day **D−1**, and times before 06:00
shift to the next calendar morning. So "import day D" really means: import sheet
dates **D and D+1's morning rows**; conversely importing sheet date D also completes
schedule day D−1's tail. Filtering by sheet date (not schedule day) and letting
`schedule_day_of()` sort it out is correct — just pick the sheet-date range so it
covers whole schedule days and doesn't re-import already-covered sheet dates.

### Import notes

- Sheet position names map to DB positions via keyword matching
  (`POSITION_MAP` in `import_history.py`); unmatched names fall to the
  catch-all `אחר` (id 99). **When a new position name appears in the sheet,
  add a keyword** — and mind Hebrew final-letter forms in substring matches
  (a keyword ending in ן won't match the medial-נ spelling inside a longer
  word).
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
