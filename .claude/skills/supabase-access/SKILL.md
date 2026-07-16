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

## Applying migrations

Migrations live in `scheduler/db/migrations/`. Apply to Supabase with the file-run
pattern above, and keep `scheduler/db/schema.sql` in sync (tests rebuild from it).
Local Docker first, then Supabase.

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
4. **Strip the `insert into soldiers` lines** before running against Supabase,
   keeping only genuinely new names. Reason: the original import came from CSV
   *downloads* where personal numbers were floats (`7569145.0`); the values API
   yields clean ints (`7569145`), so `on conflict (personal_number) do nothing`
   does NOT match and every soldier duplicates (131/133 PNs in prod are the `.0`
   form). Assignment inserts then resolve `(select id from soldiers where
   full_name=... limit 1)` nondeterministically.
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

### Known import mappings

- `חפק` and `תורנים נוספים` map to position `אחר` (id 99) — no keyword match
  (`תורן` ≠ substring of `תורנים` due to final-nun). Consistent with history;
  hours still count for fairness.
- After importing real data over former draft days, later drafts (generated
  against the draft fairness picture) are stale — regenerate them.

## Safety

- Drafts (`source in ('auto','chain')`, unlocked) are regenerable — safe to delete.
  `source='import'`/`'manual'` and `locked` rows are truth — never bulk-delete.
- Tests must NEVER run against Supabase (they use local `shavtzak_test`).
