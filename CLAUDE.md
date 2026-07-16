# shavtzak — project guide

## Current state (2026-07-15)

Everything below is implemented, tested (34 tests: `scheduler/` 29 + root 5),
and live against the shared Supabase project:

- **Scheduler DB** on Supabase (schema in `scheduler/db/schema.sql`, template
  seed in `db/seed.sql`, applied migrations in `db/migrations/`). Real history
  imported (1,836 rows, 24/6–14/7) + `unavailability` built from the roster
  matrix. Positions model after rework: **מגן** (10, continuity crew, one
  מחלקה), **התקפי** (8, standing readiness 14:00–14:00, staffs the תגבצ
  windows + ad-hoc attacks), תגבצ has no own crew (`staffed_by`), כרמל/גשש are
  chained overlays, seat counts per date via `seat_overrides`.
- **Generator + validator** (`scheduler/src/`): two-level generation per
  SPEC §6-7, CLI `generate`/`validate`, drafts 15–19/7 generated (draft-only —
  approval + sheet sync-out NOT built, by design).
- **Viewer app**: two officer-only tabs — שבצק חדש (טיוטה) (date range +
  צור שבצ"ק button → `api/draft.ts`) and הוגנות (Sunday-anchored week,
  spread cards, sortable table → `api/fairness.ts`). Tab visibility also
  granted by the `shavtzak_admins` DB table (`api/admins.ts`).
- **Local dev**: `npm run dev:api` (port 3001) + `npm run dev` (vite 5173);
  env in `.env`/`.env.local` (git-ignored). Vercel prod needs
  `SCHEDULER_DATABASE_URL` set in project env — NOT done yet; nothing pushed
  to the remote either.
- **Read `scheduler/SPEC.md` before touching scheduling logic** — every rule
  (H/R/T/P), the 14:00 day anchor, and the positions catalog live there.

Next candidates: approval flow + sheet sync-out (`כל השבצק` append), lock/edit
from UI, server-side Clerk auth on the API, מגן internal shift scheduling.

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

- **Supabase (shared/production)**: see the **`supabase-access` skill**
  (`.claude/skills/supabase-access/SKILL.md`) for credentials, the
  psql-via-Docker pattern (no host psql), applying migrations, and the
  sheet-import pipeline with its gotchas (float personal numbers, readiness-row
  duplication, 14:00 boundary). Quick ref: project `shavtzak-scheduler`
  (yoaymfryftsqqjjyvwym, eu-central-1), password
  `security find-generic-password -s supabase-shavtzak-db -w`.
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

## Testing policy

**Every new feature must come with tests.** Scheduler logic goes in
`scheduler/tests/` (`npm test` there — node:test + tsx, runs serially against a
dedicated `shavtzak_test` database in the local Docker container, **never
against Supabase**). Pattern: unit-test pure helpers directly; integration-test
generator/validator changes by asserting SPEC invariants over generated days
(see `tests/generator.test.ts`); add a negative case per new validation rule.
New API endpoints: add handler-level tests (invoke the handler with a mock
req/res like `scripts/dev-api.ts` does). Run the relevant suite before
committing.

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
