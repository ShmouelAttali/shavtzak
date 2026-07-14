# Shavtzak Scheduler — Phase 1: Spec + DB

| File | What |
|---|---|
| `SPEC.md` | Full rules spec: hard constraints, rest, rotation, chained duties (T4), priority-list fairness + scoring fallback, two-level generation model |
| `db/schema.sql` | Supabase Postgres DDL: source tables, decision/fact tables, derived views, helper functions. Double-booking blocked at DB level (`EXCLUDE USING gist`) |
| `db/seed.sql` | Current position/slot template (as of 2026-07-15), chain rules, config defaults |
| `import/import_history.py` | One-time import: sheet CSV exports → SQL (soldiers + `כל השבצק` history as `shift_assignments source='import'`) |

## Verified (2026-07-14, local postgres:16 in Docker)

- schema + seed apply cleanly; 47 derived slots/day from templates.
- `no_double_booking` rejects overlapping assignment, allows readiness overlap (H3 exception).
- Day anchors: `schedule_day_of('… 02:00')` → previous day; `night_range` = 00:00–06:00 next morning.
- Import dry-run: 1,836 history rows parsed (0 skipped), 1,786 loaded; **50 rejected as genuine overlaps in the manual history** (mostly יומי 06–22 + timed shift same soldier same day).
- `soldier_fairness('2026-07-15')` reproduces the Apps Script engine's "עומס 7 ימים" figures (exact for clean soldiers; ±0.5–5h where window anchor / rejected-overlap rows differ).

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

## Next phases (not started)

1. Generator (Level 1 daily partition + Level 2 slot fill per SPEC §7).
2. Validator function (SPEC §8) writing `schedule_days.validation`.
3. Sheet sync-out (append approved days to `כל השבצק`).
