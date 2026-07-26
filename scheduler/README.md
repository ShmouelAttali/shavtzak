# Shavtzak Scheduler

| File | What |
|---|---|
| `SPEC.md` | Full rules spec: hard constraints, rest, rotation, chained duties (T4), priority-list fairness + scoring fallback, two-level generation model |
| `db/schema.sql` | Postgres DDL: source tables, decision/fact tables, derived views, helper functions. Double-booking blocked at DB level (`EXCLUDE USING gist`) |
| `db/seed.sql` | Current position/slot template (as of 2026-07-15), chain rules, config defaults |
| `import/import_history.py` | One-time import: sheet CSV exports → SQL (soldiers + `כל השבצק` history as `shift_assignments source='import'`) |
| `src/` | Generator (TypeScript): `cli.ts` entry, `generate.ts` Level 1 + Level 2 + T4 chains, `load.ts` context, `time.ts` 14:00-anchored time model |

## Connect to the DB

One env var, everywhere:

```bash
export SCHEDULER_DATABASE_URL='postgres://USER:PASSWORD@HOST:5432/postgres'
```

- **Supabase (shared/production)**:
  - Account: **shavtzakshilo@gmail.com** — for the password ask **Elyashiv Lavi**.
  - Project: `shavtzak-scheduler`, org `shavtzak`, region `eu-central-1` —
    dashboard: https://supabase.com/dashboard/project/yoaymfryftsqqjjyvwym
  - Connection string — use the **pooler** host (IPv4; the direct
    `db.<ref>.supabase.co` host is IPv6-only and unreachable from Vercel):
    - **Session pooler** (port 5432) — one connection per client, good for
      long-lived processes (CLI, local dev):
      `postgres://postgres.yoaymfryftsqqjjyvwym:<DB_PASSWORD>@aws-0-eu-central-1.pooler.supabase.com:5432/postgres`
    - **Transaction pooler** (port 6543) — connection-per-statement, better for
      short-lived serverless functions (Vercel):
      `postgres://postgres.yoaymfryftsqqjjyvwym:<DB_PASSWORD>@aws-0-eu-central-1.pooler.supabase.com:6543/postgres`
  - `<DB_PASSWORD>` is the *database* password (different from the account password):
    Dashboard → Project Settings → Database, or on Elyashiv's Mac from the keychain:
    `security find-generic-password -s supabase-shavtzak-db -w`
    (account password is under service `supabase-shavtzak`).
- **Local dev**: leave unset — defaults to the Docker container from "Try it" below
  (`postgres://postgres:test@localhost:55432/postgres`).

## Tests

```bash
npm test          # 25 tests: time helpers, generator invariants, validator rules
```

Integration tests run against a dedicated `shavtzak_test` database inside the
local Docker container (see "Try it") — **never against Supabase**. They rebuild
the schema, seed a synthetic 60-soldier roster, generate 3 days, and assert the
SPEC invariants (no double-booking, rest floor, daily cap, chain sourcing,
single tracker, lock survival, H1/H4, fairness spread) plus validator
negative cases.

## Generate a schedule

```bash
npm install
npx tsx src/cli.ts generate 2026-07-16              # one day, persisted
npx tsx src/cli.ts generate 2026-07-16 2026-07-22   # a week, sequential
npx tsx src/cli.ts generate 2026-07-16 --dry-run    # print, don't save
```

Human overrides: set `locked=true` (or `source='manual'`) on `day_assignments` /
`shift_assignments` rows — the generator schedules around them and never deletes them.

To resize or cancel specific shifts **before** generating, insert a
`seat_overrides` row instead of editing assignments: scope it to a date range
(`valid_from` inclusive schedule day, `valid_to` exclusive timestamp — one day D
is `valid_from = D`, `valid_to = 'D+1 14:00'`; null = onward) and optionally to
one shift (`start_time` = the template start, e.g. `18:00` for the evening
סיור). `seats = 0` cancels the matched slot(s) — the `day_slots` view omits
them and the generator redistributes the crew. Most specific row wins:
`start_time` match > position-wide, then latest `valid_from`, then newest row.

## Verified (2026-07-14, local postgres:16 in Docker)

- schema + seed apply cleanly; 47 derived slots/day from templates.
- `no_double_booking` rejects overlapping assignment, allows readiness overlap (H3 exception).
- Day anchors: `schedule_day_of('… 02:00')` → previous day; `night_range` = 00:00–06:00 next morning.
- Import dry-run: 1,836 history rows parsed (0 skipped), 1,786 loaded; **50 rejected as genuine overlaps in the manual history** (mostly יומי 06–22 + timed shift same soldier same day).
- `soldier_fairness('2026-07-15')` reproduces the Apps Script engine's "עומס 7 ימים" figures (exact for clean soldiers; ±0.5–5h where window anchor / rejected-overlap rows differ).
- **Generator, 7 consecutive days (15–21/7) on top of real history**: all ~104 rows/day
  filled (0 unfilled seats), 0 daily-cap violations, nights spread 0–1, defense shifts
  auto-paired 8h apart (06&18, 10&22, 14&02), T4 chains verified (carmel follows defense
  descents with רובאי-senior commander; konenut windows follow patrol crews; tracker
  picks min-hours crew member). Wide weekly-hours spread (6.5–55.5h) is deliberate
  catch-up: soldiers with zero history load (e.g. returned from abroad) absorb duty
  first and the spread converges over subsequent weeks.

## Try it

```bash
docker run -d --name shavtzak-pg -e POSTGRES_PASSWORD=test -p 55432:5432 postgres:16
docker exec -i shavtzak-pg psql -U postgres < db/schema.sql
docker exec -i shavtzak-pg psql -U postgres < db/seed.sql
python3 import/import_history.py --roster 'מצבת החיילים.csv' --history 'כל השבצק.csv' \
  | docker exec -i shavtzak-pg psql -U postgres
docker exec -i shavtzak-pg psql -U postgres \
  -c "select * from soldier_fairness('2026-07-15') limit 5"
```

## Next phases

1. ~~Generator~~ (done — `src/`).
2. ~~Supabase provisioning + import~~ (done — see "Connect to the DB").
3. ~~Import cleanup~~ (overlap rows as `blocks_overlap=false`, name dedupe,
   `unavailability` from roster matrix — `import/cleanup.py`).
4. ~~Validator~~ (SPEC §8 — `src/validate.ts`, runs after every generation and via
   `npx tsx src/cli.ts validate <day>`; results in `schedule_days.validation`).
5. ~~Operational UI~~ (SPEC §12 — draft + fairness tabs in the viewer app;
   `api/_handlers/draft.ts`, `api/_handlers/fairness.ts`). Deployment note: set
   `SCHEDULER_DATABASE_URL` in the Vercel project env (Dashboard → Settings →
   Environment Variables, for the Production + Preview environments, then
   redeploy) — locally it lives in `.env.local`. Use a **pooler** URI, not the
   direct `db.<ref>.supabase.co` host (IPv6, unreachable from Vercel):
   - Transaction pooler (recommended for serverless):
     `...@aws-0-eu-central-1.pooler.supabase.com:6543/postgres`
   - Session pooler (also works):
     `...@aws-0-eu-central-1.pooler.supabase.com:5432/postgres`
6. Sheet sync-out (append approved days to `כל השבצק`) — NOT started; everything is
   draft-only by design.
