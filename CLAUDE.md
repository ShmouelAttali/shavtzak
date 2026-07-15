# shavtzak — project guide

Two parts in this repo:

1. **Viewer app** (root): React + Vite + TS, RTL Hebrew, deployed on Vercel. Read-only
   dashboard over the company Google Sheet (roster, duty roster, exits). Serverless
   endpoints in `api/` read the sheet via a Google service account. See root `README.md`.
2. **Scheduler** (`scheduler/`): automatic shift-schedule generator. Postgres is the
   source of truth; the Google Sheet becomes a synced output. Spec: `scheduler/SPEC.md`
   (read it before touching scheduling logic — all rules H/R/T/P are defined there).

## Database connection (scheduler)

Everything connects through one env var:

```bash
export SCHEDULER_DATABASE_URL='postgres://USER:PASSWORD@HOST:5432/postgres'
```

- **Supabase (shared/production)**: account **shavtzakshilo@gmail.com** (password:
  ask Elyashiv Lavi). Project `shavtzak-scheduler`, region eu-central-1:
  https://supabase.com/dashboard/project/yoaymfryftsqqjjyvwym
  Session-pooler URI:
  `postgres://postgres.yoaymfryftsqqjjyvwym:<DB_PASSWORD>@aws-0-eu-central-1.pooler.supabase.com:5432/postgres`
  — DB password from Dashboard → Project Settings → Database, or on Elyashiv's Mac:
  `security find-generic-password -s supabase-shavtzak-db -w`.
  Schema + seed + history already applied (2026-07-15: 133 soldiers, 1,786 rows).
- **Local dev** (default when the env var is unset —
  `postgres://postgres:test@localhost:55432/postgres`):

  ```bash
  docker run -d --name shavtzak-pg -e POSTGRES_PASSWORD=test -p 55432:5432 postgres:16
  docker exec -i shavtzak-pg psql -U postgres < scheduler/db/schema.sql
  docker exec -i shavtzak-pg psql -U postgres < scheduler/db/seed.sql
  python3 scheduler/import/import_history.py \
      --roster 'מצבת החיילים.csv' --history 'כל השבצק.csv' \
      | docker exec -i shavtzak-pg psql -U postgres
  ```

  (CSV files = File → Download → CSV of the sheet tabs; a parsed copy of all tabs may
  exist in the session scratchpad under `tabs/`.)

## Scheduler commands

```bash
cd scheduler && npm install
npx tsx src/cli.ts generate 2026-07-16 [2026-07-20] [--dry-run]   # generate day(s)
npm run typecheck
```

Generated rows land in `shift_assignments` (`source='auto'|'chain'`) and
`day_assignments`; human edits should set `locked=true` or `source='manual'` — the
generator never deletes those. Fairness counters are the `soldier_fairness(date)`
DB function — computed from assignments, never stored.

## Conventions & gotchas

- Schedule day = **14:00 → 14:00**; night = 00:00–06:00; all times naive local
  (`timestamp`/`tsrange`, no time zones). Helpers: `day_start()`, `night_range()`,
  `schedule_day_of()` in `scheduler/db/schema.sql`, mirrored in `scheduler/src/time.ts`.
- Double-booking is enforced by the DB (`no_double_booking` EXCLUDE constraint);
  readiness rows (כוננות/כרמל/כונן גשש) set `blocks_overlap=false`.
- Postgres trap that already bit once: `least(hours(empty_range), 8)` = 8, because
  `hours()` of an empty range is NULL and `least` ignores NULLs — always guard with
  a `&&` filter.
- Hebrew names are data keys in several places (positions, sub-positions); keep exact
  spelling incl. quotes (נורמליזציה strips ״/"/׳).
- The viewer app (root) must keep working untouched — scheduler writes to the sheet
  only via the sync-out step (not yet implemented).
