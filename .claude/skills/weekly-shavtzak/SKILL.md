---
name: weekly-shavtzak
description: Generate a weekly שבצ"ק (7 days of drafts) against the Supabase scheduler DB — asks who commands the מגן this week, persists that decision (config key magen_commander) so the next run reuses it, generates day by day, validates, and reports issues. Use for "צור שבצק שבועי", "generate next week", "generate the weekly schedule", or any multi-day draft generation request.
---

# Weekly שבצ"ק generation

Generates a week of draft days on the **production Supabase DB**. Connection
details, credentials and the psql-via-Docker pattern: see the
`supabase-access` skill (quick ref: `DB_PASS=$(security find-generic-password
-s supabase-shavtzak-db -w)`, pooler URI, `docker exec shavtzak-pg psql`).

```bash
export SCHEDULER_DATABASE_URL="postgres://postgres.yoaymfryftsqqjjyvwym:${DB_PASS}@aws-0-eu-central-1.pooler.supabase.com:5432/postgres"
```

## Step 1 — the מגן commander decision (persisted)

The מגן crew is anchored on a weekly commander decision: the generator
reserves him to מגן first and prefers his מחלקה for the rest of the crew
(config key `magen_commander`, read by Level 1).

1. Read the current decision:
   ```sql
   select value from config where key = 'magen_commander';
   ```
2. **Ask the user** who commands the מגן this week, showing the persisted name
   (if any) as the default — e.g. "מי מפקד המגן השבוע? (הפעם הקודמת: X)".
   If the user confirms the existing name, skip the write.
3. Validate the answer against the roster (exact spelling matters — quotes are
   normalized, but prefer the roster spelling):
   ```sql
   select full_name, platoon, role from soldiers
   where is_schedulable and full_name like '%<part>%';
   ```
4. Persist (jsonb string value):
   ```sql
   insert into config (key, value) values ('magen_commander', '"<full_name>"')
   on conflict (key) do update set value = excluded.value;
   ```

## Step 2 — pre-flight

- Confirm the date range with the user (default: the next 7 schedule days,
  Sunday-anchored if they say "השבוע"/"שבוע הבא").
- Check the roster/unavailability picture is current — if the user mentions
  the sheet changed, run the sheet-import pipeline first (`supabase-access`
  skill). The מפלג tab's `סטטוס` column must be reflected in
  `soldiers.is_schedulable` (לא מגיע → false).
- Days that already carry locked/manual rows are respected automatically;
  unlocked auto/chain rows are replaced by regeneration.

## Step 3 — generate + validate

```bash
cd scheduler
npx tsx src/cli.ts generate <start> <end>     # sequential, each day sees prior drafts
```

The CLI prints per-day issues; validation snapshots are stored automatically.
Re-validate explicitly if needed: `npx tsx src/cli.ts validate <day>`.

## Step 4 — report

Summarize for the user, per day:
- error-level findings (rest, coverage, driver, role_gate, chain) — these need
  human action;
- notable warnings: `rest_bucket` (someone idle — should not happen unless the
  surplus exceeds מגן's 12), `oncall_streak`, `second_toranut_week`;
- generation issues that indicate real staffing gaps: `חסרים X חיילים`,
  `חסרים נהגים`, `לא אויש`, empty חפק seats.

Remind the user the drafts are visible in the שבצק חדש (טיוטה) tab and remain
draft-only (no sheet sync-out).

### Diagnosing recurring errors before reporting them

Don't just relay validator errors — check whether they're a data gap the
generator can't solve:

- **קצין מוצב unfilled** → check pool availability per day
  (`positions.config->'candidate_pool'` names vs `unavailability`). Note: if
  the only available pool member is also the persisted `magen_commander`, he's
  reserved to מגן and the seat stays empty — flag that trade-off to the user.
- **אין נהג דוד / נהג טיגריס** → count available qualified drivers via
  `soldier_qualifications` (qualification = 'נהג דוד' / 'נהג טיגריס'). 2
  drivers can't cover all daily סיור shifts under rest rules — a real
  shortage, not a generator bug.
- **A day that collapses (many לא אויש)** → count soldiers with an
  `unavailability` row overlapping that schedule day; mass-exit days
  (weekends) genuinely can't be covered.

## Step 5 — fairness check

Raw `shift_assignments` hours are misleading (מגן/כוננות daily rows count
24h). Use the `soldier_fairness(as_of)` DB function's `weighted_hours_7d`,
normalized by days-on-base (days without an unavailability row covering that
evening). Healthy: SD ≲ 3 around the mean per-day load; top loads should be
either short-stay soldiers (present 1–2 days) or already flagged by
`consecutive_nights`/`oncall_streak` warnings. Example query shape:

```sql
with f as (select * from soldier_fairness('<end_date>')),
b as (select s.id, s.full_name,
        (select <n_days> - count(*) from generate_series(...) dd
         where exists (select 1 from unavailability u where u.soldier_id=s.id
           and u.period @> ((dd + time '20:00')::timestamp))) days_present
      from soldiers s where s.is_schedulable)
select b.full_name, b.days_present, f.weighted_hours_7d, f.night_count_7d,
       round(f.weighted_hours_7d/b.days_present,1) per_day
from f join b on b.id=f.soldier_id where b.days_present>0 order by per_day desc;
```

## Gotchas

- Generation MUST run day-by-day in date order (the CLI does this) — each day's
  fairness counters include the previous drafts.
- If the user changes the מגן commander mid-week, regenerate only the days from
  the change onward; earlier days keep the old crew (continuity handles the
  transition).
- Never run the test suite against this DB; tests use the local Docker
  `shavtzak_test` database only.
- `unavailability` has a `period` tsrange column (not `range`); the קצין מוצב
  pool lives in `positions.config->'candidate_pool'`, driver quals in
  `soldier_qualifications.qualification` — there is no config key for either.
- A range "20-07 14:00 to 26-07 14:00" is schedule days 2026-07-20..2026-07-25
  (each day is D 14:00 → D+1 14:00) — pass `generate 2026-07-20 2026-07-25`.
