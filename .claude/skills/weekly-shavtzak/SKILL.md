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

## Gotchas

- Generation MUST run day-by-day in date order (the CLI does this) — each day's
  fairness counters include the previous drafts.
- If the user changes the מגן commander mid-week, regenerate only the days from
  the change onward; earlier days keep the old crew (continuity handles the
  transition).
- Never run the test suite against this DB; tests use the local Docker
  `shavtzak_test` database only.
