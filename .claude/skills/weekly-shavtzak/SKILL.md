---
name: weekly-shavtzak
description: Generate a weekly שבצ"ק (7 days of drafts) against the Supabase scheduler DB — asks who commands the מגן this week, persists that decision (magen_commander_history table) so the next run reuses it, generates day by day, validates, and reports issues. Use for "צור שבצק שבועי", "generate next week", "generate the weekly schedule", or any multi-day draft generation request.
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
(the `magen_commander_history` table, read by Level 1 — the decision for
day D is the row with the latest `valid_from` <= D, so history is kept).

1. Read the decision currently effective for the week:
   ```sql
   select s.full_name
   from magen_commander_history h
   join soldiers s on s.id = h.soldier_id
   where h.valid_from <= '<week-start>'
   order by h.valid_from desc limit 1;
   ```
2. **Ask the user** who commands the מגן this week, showing the persisted name
   (if any) as the default — e.g. "מי מפקד המגן השבוע? (הפעם הקודמת: X)".
   If the user confirms the existing name, skip the write.
3. Validate the answer against the roster (the insert below matches
   `full_name` EXACTLY — always use the spelling this query returns):
   ```sql
   select full_name, platoon, role from soldiers
   where is_schedulable and full_name like '%<part>%';
   ```
4. Persist (id-resolved; a new `valid_from` keeps the weekly history):
   ```sql
   insert into magen_commander_history (valid_from, soldier_id)
   select '<week-start>'::date, id from soldiers where full_name = '<name>'
   on conflict (valid_from) do update
     set soldier_id = excluded.soldier_id,
         decided_at = timezone('Asia/Jerusalem', now());
   ```
   **Guard**: `INSERT 0 0` (zero rows) means the name matched nobody in the
   roster — nothing was persisted. Abort, re-run the step-3 lookup, and
   re-ask the user; never proceed to generation with an unpersisted decision.

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

Every generate run also writes an **HTML generation report** automatically to
`scheduler/reports/` (git-ignored): one `<day>.html` per day + a
`week-<start>-<end>.html` index for ranges. `--no-report` skips it;
`--report-dir <dir>` overrides the output directory. Reports are written on
`--dry-run` too (that's the point of a dry run).

## Step 4 — walk through the HTML report

Open `scheduler/reports/week-<start>-<end>.html` (and the day pages it links
to) and walk the owner through the main findings:

- the week index's per-day cards — error/warning counts and key shortages at a
  glance; drill into any red day's page;
- on a day page: the שלב 1 narrative bullets (flex sizing, closed-list picks,
  מגן commander status, structural shortages), the שלב 2 grids' ⚠ cells, the
  שרשורים table's השלמה badges, and the חריגות section;
- the week fairness table (days on base / shifts / nights / weighted hours,
  with min/max/avg/SD footer) — call out outliers.

## Step 5 — report

Summarize for the user, per day:
- error-level findings (rest, coverage, driver, role_gate, chain) — these need
  human action;
- notable warnings: `rest_bucket` (someone idle — should not happen unless the
  surplus exceeds מגן's 12), `oncall_streak`, `second_toranut_week`;
- generation issues that indicate real staffing gaps: `חסרים X חיילים`,
  `חסרים נהגים`, `לא אויש`, empty חפק seats.

Remind the user the drafts are visible in the צור שבצק tab and remain
draft-only (no sheet sync-out).

### Diagnosing recurring errors before reporting them

Don't just relay validator errors — check whether they're a data gap the
generator can't solve:

- **קצין מוצב unfilled** → check pool availability per day: the pool is
  `position_candidates` rows with `sub_position_id is null` (join `soldiers`
  for names) vs `unavailability`. Note: if the only available pool member is
  also the persisted מגן commander (`magen_commander_history`), he's
  reserved to מגן and the seat stays empty — flag that trade-off to the user.
- **אין נהג דוד / נהג טיגריס** → count available qualified drivers via
  `soldier_qualifications` (qualification = 'נהג דוד' / 'נהג טיגריס'). 2
  drivers can't cover all daily סיור shifts under rest rules — a real
  shortage, not a generator bug.
- **A day that collapses (many לא אויש)** → count soldiers whose
  `unavailability` **covers the whole schedule day** (`u.period @>
  tsrange(D 14:00, D+1 14:00)`) — those are the truly absent. Do NOT count
  by mere overlap (`&&`): on exit/arrival days most overlaps are
  partial-day and those soldiers ARE schedulable around their windows
  (e.g. mass-exit 25/07 had 80 partial-day overlaps but 97 soldiers
  present for part of the day — an `&&` count says 17 available, wildly
  wrong). Report three numbers: absent-whole-day (`@>`), partial-day
  (`&&` and not `@>`), present-clean (no overlap). Mass-exit days
  (weekends) can still genuinely be uncoverable at specific hours.

## Step 6 — fairness check

The week report's fairness table already covers the basics; use this deeper
query when the owner wants per-day-normalized load.

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
  pool lives in `position_candidates` (id-based, `sub_position_id is null`;
  `config.candidate_pool` is only a boolean marker), driver quals in
  `soldier_qualifications.qualification` — there is no config key for either.
- A range "20-07 14:00 to 26-07 14:00" is schedule days 2026-07-20..2026-07-25
  (each day is D 14:00 → D+1 14:00) — pass `generate 2026-07-20 2026-07-25`.
