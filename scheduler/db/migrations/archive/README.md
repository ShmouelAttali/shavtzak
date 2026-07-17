# Archived migrations (2026-07-15 … 2026-07-17)

These migrations were applied to the shared Supabase database historically,
in filename order. They are kept **for the record only**.

As of **2026-07-17**, `db/schema.sql` + `db/seed.sql` is the consolidated
baseline: a fresh database is built from those two files (plus the history
import) and already contains everything these migrations produced. One-off
deltas for the live DB now go in standalone files under `db/`
(e.g. `db/consolidation-2026-07-17.sql`), applied by hand via the
supabase-access skill.

**NEVER replay this archive onto a schema.sql-built database.** The scripts
assume the pre-consolidation state and are destructive out of context — most
notably `2026-07-15-positions-rework.sql` deletes position id 13 (then the
old ad-hoc התקפי) which the consolidated seed reuses for the live **בבית**
position; replaying it would delete בבית and its assignments.
