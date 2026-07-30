---
name: postgres-scheduler
description: The FROZEN Postgres-backed scheduler half of this repo — the automatic shift-schedule generator (scheduler/), its rules (SPEC.md H/R/T/P), and the seven DB-backed admin tabs (צור שבצק, הוגנות, מבנה יומי, מצבת חיילים, נוכחות, חמל, ניהול יציאות). Owner decision 2026-07-30: no new work goes here; the active surface is the Google-Sheet-based viewer (see CLAUDE.md). Load this only when a task explicitly touches the generator, the scheduler DB/schema, or one of those seven tabs — e.g. "why did the generator seat X", "regenerate the week", "the הוגנות tab is wrong", "apply a migration".
---

# Postgres scheduler (frozen)

**Status (owner, 2026-07-30): FROZEN.** All new work happens in the
Google-Sheet-based viewer app (root `src/` + the three sheet handlers). Do not
extend the generator, the SPEC rules, or these tabs unless the owner names them
explicitly. When you *do* touch scheduling logic, the old discipline still
applies: read `scheduler/SPEC.md` first, and **every rule change updates BOTH
`scheduler/SPEC.md` (technical) and `scheduler/LOGIC.he.md` (pure Hebrew, no
field names)** — the owner checks they match.

## What exists

- **Scheduler** (`scheduler/`): generator + validator over Postgres (Supabase),
  spec in `scheduler/SPEC.md` (rules H/R/T/P, the 14:00→14:00 day anchor, the
  positions catalog), Hebrew rules in `scheduler/LOGIC.he.md`.
  Module layout: `generate.ts` is a thin pipeline over `load.ts` (read SQL) →
  `state.ts` (SoldierState + Gen bag + assign) → `level1.ts` (partition) →
  `chains.ts` (T4, two passes around Level 2) → `level2.ts` (slot fill +
  rationale) → `persist.ts` (write SQL), with shared primitives in `rank.ts` /
  `rest.ts` / `pairs.ts` / `text.ts` / `config.ts`.
- **The generation report** ("the report", דוח חילול): self-contained HTML pages
  built by `scheduler/src/report.ts` (pure builders; `cli.ts` assembles inputs
  and writes them). `cli generate` writes a page per day + a weekly index to
  `scheduler/reports/` (`--report-dir` overrides, `--no-report` skips); rendered
  example in `scheduler/reports/sample/`. "Line/step N" = the numbered steps of
  the day page's ניתוח התהליך section. Tests: `scheduler/tests/report.test.ts`.
- **Seven DB-backed tabs** (all admin-gated, all 🔒): צור שבצק (draft), הוגנות
  (fairness), מבנה יומי (per-day shift structure), מצבת חיילים (roster editor),
  נוכחות (presence editor), חמל, ניהול יציאות (exit requests). Handlers:
  `api/_handlers/{draft,fairness,day-structure,roster,presence,hamal,exit-requests,publish,unpublish,report,admins}.ts`
  — everything under `api/_handlers/` that imports `../_db.js`.
- **DB**: schema `scheduler/db/schema.sql` + template seed `db/seed.sql` = the
  **consolidated baseline**. Historical migrations in `db/migrations/archive/`
  must NEVER be replayed onto a schema.sql-built DB. One-off live deltas are
  standalone files (`db/<topic>-<date>.sql`). Connection + psql-via-Docker +
  import pipeline: the **`supabase-access` skill**.
- **Commands**: `cd scheduler && npm install`,
  `npx tsx src/cli.ts generate 2026-07-16 [2026-07-20] [--dry-run]`,
  `npm run typecheck`, `npm test` (node:test + tsx, serial, against the local
  Docker `shavtzak_test` DB — **never** Supabase).
  A whole week: the **`weekly-shavtzak` skill**.

## Conventions that bite

- **Schedule day = 14:00 → 14:00**; night = 00:00–06:00; all times naive local
  (`timestamp`/`tsrange`). Helpers `day_start()`, `night_range()`,
  `schedule_day_of()` in `db/schema.sql`, mirrored in `src/time.ts`.
  (The Google Sheet has NO such anchor — see CLAUDE.md.)
- **Soldier identity = FK, never a copied name** (owner, 2026-07-19): a name
  appears ONCE, in `soldiers.full_name` (UNIQUE); every other reference is a
  `soldier_id`. The id tables: `position_candidates` (closed lists; sub NULL =
  position pool, sub set = named seat; priority NULL = fairness-ordered),
  `magen_commander_history` (weekly decision, latest `valid_from ≤ day` wins),
  `soldier_allowed_positions` (H6c). The ONLY file where names may appear is
  `db/seed-candidates.sql` — the human-editable manifest, applied AFTER the
  roster import; it aborts on any unresolved name. Any new soldier list MUST be
  an id table.
- **Check for an existing config before adding one**: daily-duty classification
  is `positions.config.daily` (resolved by `effectiveConfig()`), on-call is
  `mission_class='readiness'`. Never add a parallel flag or hardcode position
  names for a distinction the schema already expresses.
- **Resizing/cancelling a specific shift = `seat_overrides` rows**, not
  hand-edited assignments: day/range-scoped (`valid_from` inclusive day,
  `valid_to` exclusive ts) + optional `start_time`; `seats=0` cancels the slot.
- **Double-booking** is enforced by the DB (`no_double_booking` EXCLUDE);
  readiness rows (כוננות/כרמל/כונן גשש) set `blocks_overlap=false`.
- Generated rows land in `shift_assignments` (`source='auto'|'chain'`) and
  `day_assignments`; human edits set `locked=true` or `source='manual'` and the
  generator never deletes them. Fairness counters are the
  `soldier_fairness(as_of, include_drafts)` DB function — computed, never stored.
- Postgres trap: `least(hours(empty_range), 8)` = 8, because `hours()` of an
  empty range is NULL and `least` ignores NULLs — always guard with `&&`.
- **A delta that RELAXES a constraint must DROP the old one.** `seats_nonneg
  (>= 0)` was added while `seats_check (> 0)` stayed, so `seats=0` worked on
  every schema.sql-built DB and was rejected in production for a week. Only a
  live-vs-`schema.sql` diff catches this class of drift; tests rebuild from the
  baseline and see nothing.
- **Load-order independence**: adding a zero-row predicate to `load.ts`'s roster
  query once changed generated schedules — the query had no `ORDER BY`, so its
  plan-dependent row order became the `state` Map order and three decisions read
  that order raw. Any new `[...state.values()]` whose order feeds a decision
  needs its own tie-break (SPEC §H2b; pinned by `tests/magensunday.test.ts`).
- **A qualification is NOT a role** (owner, 2026-07-26): the sheet's תפקיד
  column mixes them. תפקיד/מחלקה are CLOSED dropdowns in מצבת חיילים and the API
  400s on a value outside the catalog, because setting תפקיד is the only way
  into חמל / מפלג and a typo silently breaks role matching in the generator.
- **Report ↔ צור שבצק alignment**: both surfaces derive every warning from the
  same code — `validateDay` runs live on GET, and the shared pure helpers
  `requiredSeats()` (config.ts), `staffedSeats()` (coverage.ts) and
  `violationCoveredByRationale()` (rationale.ts) keep the rest in lockstep.
  **Coverage is counted by OVERLAP, never by the rendered time label.** A new
  rule belongs in `validate.ts` (shown in both) or `rationale.ts` (rendered in
  both).
- **Presence is DB-owned** (owner, 2026-07-26): sheet re-imports must not
  rebuild it, so `import/cleanup.py` part 3 sits behind `--rebuild-presence`,
  default OFF (initial imports only).

## Testing

Scheduler logic → `scheduler/tests/` (`npm test` there). Unit-test pure helpers
directly; integration-test generator/validator changes by asserting SPEC
invariants over generated days (`tests/generator.test.ts`); add a negative case
per new validation rule. In fixtures, resolve positions / sub-positions by
**name lookup**, never by hardcoded seed ids.

## Never built, by design

Approval flow + sheet sync-out (`כל השבצק` append) and server-side Clerk auth on
the API were the next candidates when the DB half was frozen. Drafts stay
drafts; the Google Sheet is still written by hand.
