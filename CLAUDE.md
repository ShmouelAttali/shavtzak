# shavtzak — project guide

## Working style (owner request, 2026-07-19; cost-tuned 2026-07-19)

- **Subagents for large independent tasks only**: when the owner gives several
  substantial, independent tasks (a feature, a DB import, a broad analysis),
  run each in its own subagent concurrently with disjoint file scopes. Do
  small edits, quick lookups, and sequentially-dependent work **inline** —
  each subagent restarts with an empty context and re-pays setup (reading
  CLAUDE.md/SPEC, rediscovering files), so for small tasks it costs several
  times the tokens of inline work.
- **No recursive fan-out by default**: a subagent handles its own sub-pieces
  (docs+code+tests) inline unless each piece is itself substantial enough to
  justify a fresh agent's setup cost. Don't propagate fan-out instructions
  into agent prompts automatically.
- Ask the owner questions **in English** (options/labels may quote Hebrew
  domain terms).

## The generation report ("the report", דוח חילול)

When the owner says **"the report of the shavtzak generation"** he means the
self-contained HTML pages built by `scheduler/src/report.ts` (pure builders;
`cli.ts` assembles the inputs and writes them). `cli generate` writes a page
per generated day + a weekly index to `scheduler/reports/` by default
(`--report-dir` overrides, `--no-report` skips); a rendered example lives in
`scheduler/reports/sample/` (e.g. `2026-07-20.html`). "Line/step N" refers to
the numbered steps of the day page's ניתוח התהליך (process) section. Tests:
`scheduler/tests/report.test.ts`.

## Rules overhaul (2026-07-18) — owner's 18-item list, all implemented

- **Everyone works, no מנוחה**: flex seats (`positions.config.flex_seats`) —
  מגן 10–12 absorbs surplus, סיור shrinks 4→3/shift on shortage; leftover
  absorb into מגן; validator `rest_bucket` warning; coverage judged vs flex
  min. Manual seat_override may enlarge מגן beyond 12 (manual wins); shrinking
  below min loses to everyone-works.
- **קצין מוצב**: closed pool of 8 — unordered, fairness-rotated,
  NON-exclusive; enforced in `allowedIn()` (every fill path) + validator.
  (Since 19/7: id rows in `position_candidates`; `candidate_pool` is just a
  boolean marker.)
- **Hard rules H6d**: every סיור crew ≥1 נהג דוד, התקפי ≥1 נהג טיגריס
  (L1 driver quota after commander quota; L2 driver seat after commander
  seat; validator `driver`). התקפי template now `commander_first_seat=true`.
- **H8 absolute**: <4h rest is a hard block — no בדוחק (only R5 duty-rest
  exempts). R3 גשש: ONLY the 22–07 night window counts as load (tracker hours
  + effective-rest; day windows free). Bus time is **08:00** (was 10:00).
- **Priorities**: static-streak (T3) and new on-call streak (T6: 3rd day of
  only static+כוננות, validator `oncall_streak`) rank ABOVE night fairness
  (P2) — owner: constant static is worse than constant nights. New P4b key:
  different static post per soldier within the same 24h (sub rotation).
- **התקפי**: soft 2×(1 מפקד + 3 same-מחלקה) via `group_size:4`; מפקד כרמל =
  commander from crew first, else highest רובאי. מפקד def: מ"מ/סמל/מ"כ/מ"ח.
- **T4 completion**: chained standbys (כרמל/גשש) whose descending crew went
  home are completed with fresh soldiers (arrivals preferred, fairness order);
  validator warns on genuine-shortfall completions, errors when an available
  crew member was skipped or the window was already covered.
- **מפלג position** (id 14): רס"פ/סרס"פ/מנהלה staff — daily 14:00–14:00 row,
  restricted to it (staff_all_roles); presence follows the sheet's מפלג tab
  סטטוס (לא מגיע → `is_schedulable=false`; that was the בנימין קיי bug).
- **Staffing the two role-crews** (there is NO מפלג tab and no members table):
  **מפלג** = set תפקיד to רס"פ/סרס"פ/מנהלה in מצבת חיילים + keep
  משובץ בשבצ"ק → the generator seats them daily and NOWHERE else; out for one
  day = נוכחות, permanently = uncheck משובץ בשבצ"ק, one-off swap = click the
  name in צור שבצק. **חמל** = תפקיד `חמל` (that alone puts them in the חמל
  tab's picker AND grants the tab via `api/admins.ts`), then pick them per
  shift in the חמל tab. `api/admins.ts` must pin its join to THE חמל position
  (marker `staff_all_roles ? 'חמל'`, as `api/hamal.ts` does) — unscoped, it
  handed the חמל tab to מפלג's staff too (fixed 2026-07-26,
  `tests/admins.test.ts`).
- **מגן commander**: weekly decision persisted in `magen_commander_history`
  (latest valid_from ≤ day wins; was `config.magen_commander` until the
  2026-07-19 FK migration); generator reserves him + anchors the crew's
  platoon. Use the **`weekly-shavtzak` skill** to generate a week (asks +
  persists).
- יהונתן רוט: whitelist (`soldier_allowed_positions` since 19/7) =
  עמדות הגנה/כרמל חטיבה/תורנים.
- Live delta: `db/rules-2026-07-18.sql` (applied); baseline schema/seed
  updated in step.

## Current state (2026-07-17)

Everything below is implemented, tested (both suites — see Testing policy),
and live against the shared Supabase project:

- **Scheduler DB** on Supabase (schema in `scheduler/db/schema.sql`, template
  seed in `db/seed.sql` — the **consolidated baseline**; historical migrations
  are archived in `db/migrations/archive/` and must NEVER be replayed onto a
  schema.sql-built DB). One-off live-DB deltas go in standalone files like
  `db/consolidation-2026-07-17.sql`. Real history fully re-imported 2026-07-17
  (2,214 rows, 24/6–18/7, correct חפק/תורנים attribution) + `unavailability`
  rebuilt from the roster matrix. Positions model:
  **מגן** (10, continuity crew, one מחלקה), **התקפי** (8, standing readiness
  14:00–14:00 + ad-hoc attacks as separate non-overlapping rows), כרמל/גשש are
  chained overlays, seat counts per date/shift via `seat_overrides`. Daily duties
  (מגן/חפק/תורנים/קצין מוצב) carry `config.daily: true` (implies night_exempt
  + full_rest_after + yomi_display; explicit keys override — תורנים opts out
  of full_rest_after). Tunables genuinely read from `config`: `rest_rules`,
  `daily_cap_hours`, `readiness_hour_weight` (`src/config.ts`).
- **Generator + validator** (`scheduler/src/`): two-level generation per
  SPEC §6-7, CLI `generate`/`validate` (draft-only — approval + sheet sync-out
  NOT built, by design). Module layout: `generate.ts` is a thin pipeline over
  `load.ts` (read SQL) → `state.ts` (SoldierState + Gen bag + assign) →
  `level1.ts` (partition) → `chains.ts` (T4, two passes around Level 2) →
  `level2.ts` (slot fill + rationale) → `persist.ts` (write SQL), with shared
  primitives in `rank.ts` / `rest.ts` / `pairs.ts` / `text.ts` / `config.ts`.
  P5 driver-fit + מ"כ spread and R3 גשש effective-rest are implemented.
- **Viewer app**: two officer-only tabs — צור שבצק (date range +
  צור שבצ"ק button → `api/draft.ts`; clicking a name opens the manual
  replacement picker — `PUT /api/draft` writes a manual+locked row the
  generator then re-seats verbatim. A **published day is editable** (owner
  2026-07-26): only the wholesale ops (regenerate, מחק טיוטה) stay frozen at
  409. **Double-booking is resolved, not refused**: the client finds the
  overlap itself (`src/lib/draftConflicts.ts` — 14:00-anchored label spans,
  `יומי` = whole day, `meta.blocksOverlap=false` readiness overlays never
  clash), shows it as a ⚠ per candidate in the picker, and confirms naming the
  seat to vacate; approving sends `force:true` and the server deletes those
  rows BEFORE seating him in one transaction (order matters —
  `no_double_booking`), returning the evicted seats (now לא מאויש).
  **A replacement never blocks the screen** (owner 2026-07-26): the popup closes
  on the pick and the round trip is shown ON the affected seats — the clicked
  seat plus every force-vacated one (`pendingSeatKeys` → `useDraft.pendingSeats`
  → `PendingSeatsCtx`) render a spinner and swallow clicks, so several
  replacements can run at once and only the rows actually being moved are
  locked (a day with pending seats still blocks its own wholesale buttons).
  A failure surfaces as a dismissible banner, not in the (already closed) popup;
  concurrent reloads are ordered by a sequence guard in `useDraft.load`.
  **מחק טיוטה** = `DELETE /api/draft?day=`,
  the manual twin of the stale-draft cleanup — drops the day's whole draft incl.
  manual/locked edits, keeps `source='import'` history and manual-only positions
  (`is_scheduled=false` → חמל), reverts the day to `status='draft'` and clears
  the stored report; published days are frozen (409, unpublish first);
  its ValidationPanel shows the live
  validator errors/warnings with rule-code chips, matching the report's
  חריגות card) and הוגנות (Sunday-anchored week,
  compliance dashboard: one exceptions-only card per SPEC rule fed by running
  the validator over the window's days, plus fairness-spread / position-balance
  cards → `api/fairness.ts`). **הוגנות draft scope** (owner 2026-07-26): the tab
  counts the already-scheduled **published** work by default; a `כלול טיוטות`
  checkbox (`?drafts=1`) factors drafts in, where a day holding a draft
  contributes its draft INSTEAD of its published rows — never both, so nothing
  is double-counted. `locked` rows are human truth and count in either mode.
  Implemented as `soldier_fairness(as_of, include_drafts boolean default true)`
  (delta `db/fairness-draft-scope-2026-07-26.sql`); the default keeps `load.ts`
  and the generator on the draft-inclusive behaviour they need, and the old
  1-arg signature is DROPPED — leaving both makes a 1-arg call ambiguous
  ("function soldier_fairness(date) is not unique"). Tab visibility also
  granted by the `shavtzak_admins` DB table (`api/admins.ts`). Plus a חמל tab
  (per-shift manual staffing, 10:00-cycle tiling), a **מבנה יומי** tab (admin,
  per-DAY shift-structure editor), a **מצבת חיילים** tab (admin, roster editor)
  and a **נוכחות** tab (admin, presence editor) — all below. All restricted tabs
  carry a 🔒.
- **מבנה יומי tab** (2026-07-26, `api/day-structure.ts` +
  `src/components/DayStructure.tsx` + `useDayStructure`): admin-only editor for
  ONE schedule day's shift structure (add/remove/rename position group =
  `positions` row + its positions = `sub_positions`; change shift start/end/seats;
  NO cross-shift validation, NO soldier lists). Declarative whole-day-replace PUT
  over the EXISTING slot infra (generator reads `day_slots` unchanged): seat
  change → template-targeted single-day `seat_override`; removed → `seats=0`;
  added/moved/duration-changed → day-scoped `slot_templates`; new group →
  `positions` row (static, is_scheduled); rename = day-scoped delete+create
  (collision → 409). Scope excludes חמל / מפלג / rest. Explicit save (no
  autosave) + leave guard. UI: groups are **collapsed by default** (click a card
  header to open; כווץ הכל/הרחב הכל toggles all — pure `anyExpanded`/`toggleAll`,
  `tests/day-structure-collapse.test.ts`; a reload re-mints uids, re-collapsing
  everything) and every add button (קבוצה/תפקיד/משמרת) sits at the TOP of what it
  appends to. Schema delta `db/day-structure-2026-07-26.sql`
  (seat_overrides.slot_template_id + day-scoped exemption on
  slot_templates_no_overlap) — mirrored in schema.sql and applied to Supabase.
  Its "remove a shift" path (a `seats=0` override) was **rejected in
  production** until 2026-07-26: `seat-overrides-hourly-2026-07-19.sql` added
  `seats_nonneg (>= 0)` but never dropped `seats_check (> 0)` from
  `fk-migration-2026-07-19.sql`, so the stricter check kept winning on the live
  DB while every schema.sql-built database accepted `seats=0`. Dropped by
  `db/seat-overrides-drop-stale-check-2026-07-26.sql` (applied). Lesson: a
  delta that RELAXES a constraint must drop the old one — and only a live-vs-
  `schema.sql` diff catches it, since tests rebuild from the baseline.
- **כרמל חטיבה night = ONE 8h window** (owner 2026-07-26): the template's
  6×4h grid was never real — every imported day since 28/06 writes the night as
  one 22:00→06:00 row manned by exactly the עמדות הגנה 18:00-22:00 crew, so the
  22:00-02:00 crew gets **no standby at all**. Template 22:00 → 480 min, the
  02:00 windows and T4a chain rule 6 (כרמל 02:00 ← עמדות 22:00) are gone. Delta
  `db/carmel-night-8h-2026-07-26.sql` (applied), baseline in `db/seed.sql`,
  SPEC §T4a + positions catalog + LOGIC.he.md updated.
- **Report ↔ צור שבצק tab alignment** (2026-07-26): both surfaces derive
  every warning/error from the same code — the tab re-runs `validateDay` live
  on GET (same findings as the report's חריגות card), and shared pure helpers
  keep the rest in lockstep: `requiredSeats()` (config.ts — flex coverage
  math), `staffedSeats()` (coverage.ts — how many of a slot's seats are
  actually manned; both used by validate.ts §10 + api/draft.ts's לא-מאויש
  markers) and `violationCoveredByRationale()` (rationale.ts — the
  raw-violation↔caveat dedup, used by RationalePopup + report cells).
  **Coverage is counted by OVERLAP, never by the rendered time label**: a real
  row sliced differently from its template still staffs it. api/draft.ts used
  to match labels, so a כרמל/גשש night written as one 8h row against 4h
  template slots showed phantom "לא מאויש" over a fully manned shift while the
  validator saw nothing wrong (fixed 2026-07-26 — 87 false markers across
  24/06–26/07, plus 8 real gaps the tab had been hiding). The generator's free-text
  issues ("אין מועמד ל...") are deliberately NOT shown in the tab — they are
  process narration and live only in the stored report (פתח דוח button). Any
  new rule belongs in validate.ts (message shown in both) or rationale.ts
  (rendered in both).
- **מצבת חיילים tab** (2026-07-26, `api/roster.ts` → **`/api/roster`**
  (`/api/soldiers` is the SHEET endpoint) + `src/components/Roster.tsx` +
  `useRoster` + pure `src/lib/rosterFilter.ts`): admin-only roster editor —
  read-only table + per-row edit popup + `+ חייל חדש`. Edits `soldiers`
  (מספר אישי/שם/מחלקה/תפקיד/רובאי/פלאפון/מייל/הערות/is_schedulable),
  `soldier_qualifications`, `soldier_allowed_positions` (H6c) and that
  soldier's `position_candidates` rows, plus an `אדמין שבצ"ק` checkbox writing
  `shavtzak_admins` by email (replaces hand-editing it in the dashboard).
  POST/PUT are a declarative whole-soldier replace echoing the full GET.
  **תפקיד and מחלקה are CLOSED dropdowns** (owner 2026-07-26) — free text let a
  typo silently break role/platoon matching in the generator (`staff_all_roles`
  restriction, seat rules, `isCommanderRole`, and the two EXACT-match SQL paths
  `api/admins.ts` / `api/hamal.ts`). The API enforces it: PUT/POST 400 on a
  role/platoon outside the payload's own catalog ('' role stays legal → NULL).
  `roles` = observed ∪ `ROLE_CATALOG` (the commander spellings, which can't be
  derived — `crewOrder.ts`'s `DEFAULT_COMMANDER_ROLES` are *normalized*) ∪ the
  roles the DB declares (`staff_all_roles` + `seat_rules[].roles`, same sources
  as validate.ts's `config_roles` lint), deduped by `normalizeName` with the
  OBSERVED spelling winning (`mergeRoleCatalog`). That union is load-bearing:
  **setting תפקיד is the only way into חמל / מפלג**, so an observed-only list
  would make them unassignable whenever nobody holds the role. `platoons` has no
  catalog — a genuinely NEW מחלקה needs SQL (stated in the popup).
  **A qualification is NOT a role** (owner 2026-07-26): the sheet's תפקיד column
  mixes the two and `import_history.py` copies it verbatim, so `soldiers.role`
  held נהג דוד / נהג טיגריס / חובש / נגב / קלע / מט"ב for 15 soldiers who ALL
  also carried the matching `soldier_qualifications` row — duplication that
  surfaced in the closed dropdown as if those were roles. `mergeRoleCatalog`
  now subtracts the qualification catalog (`qualifications` = `QUAL_CATALOG` ∪
  in use) from the OBSERVED side only; `declared`/`ROLE_CATALOG` are
  authoritative and never filtered — note חפק's חובש / נהג דוד seats are
  declared as `qual`, never as a role, so nothing legitimately declares one.
  The 15 became לוחם (`db/role-not-qualification-2026-07-26.sql`, applied,
  guarded on the qual row already existing). Leaves exactly 11 roles: מ"פ,
  סמ"פ, מ"מ, סמל, מ"כ, מ"ח, לוחם, חמל, רס"פ, סרס"פ, מנהלה. A fresh sheet import
  of a NEW soldier can still land a qual in תפקיד — they'd 400 in the editor,
  which surfaces the bad data rather than blessing it.
  Filters: active/removed, free text (name/מס' אישי/mail), תפקיד (+ מפקדים
  pseudo-option), הסמכה (+ closed-list and מוגבלי-עמדות pseudo-options) —
  the qualification filter reuses `hasQualification()` so a qual spelled only
  in the תפקיד text still matches, and the popup warns when unchecking such a
  qual is a no-op. **Removal is soft**: `הסר חייל` toggles a mode showing an ✕
  per row → sets `soldiers.archived_at`; the חיילים שהוסרו view restores.
  Archived ⇒ out of every roster read AND of `shavtzak_admins`. Schema delta
  `db/roster-tab-2026-07-26.sql` (`soldiers.archived_at` + `presence()` /
  `soldier_fairness()` filtered) — mirrored in schema.sql and **applied to
  Supabase 2026-07-26**.
  Unavailability is deliberately NOT edited here — it has its own **נוכחות**
  tab (below).
- **נוכחות tab** (2026-07-26, `api/presence.ts` → `/api/presence` +
  `src/components/Presence.tsx` + `usePresence` + pure
  `src/lib/presencePlan.ts`): admin-only presence editor over `unavailability`.
  **Source-of-truth decision (owner, 2026-07-26): presence is DB-OWNED** — sheet
  re-imports must not rebuild it, so `import/cleanup.py` part 3 is now behind
  `--rebuild-presence`, default OFF (initial imports only; the flag is also
  documented in the `supabase-access` skill). No schema change.
  Editable states are **full-day only** and DERIVED FROM THE DB: the
  `unavailability` kind CHECK constraint ∩ the full-day kinds
  (חופש/מחלה/לא מגויס/שחרור/גיוס, the two מגויס spellings collapsed onto the
  canonical one), prefixed by נוכח. The partial kinds (יציאה בבוקר / ב14:00 /
  בערב, חזרה ב14:00 / בערב, short-exit יציאה) are display-only — shown greyed,
  and replaced wholesale when their day is edited. `exit_requests` is untouched.
  **PUT is a declarative per-day replace for ONE soldier** (`{soldier_id, days:
  [{day,status}]}`, 400 on a partial/unknown status): consecutive same-kind days
  become ONE row `[firstDay bus, lastDay+1 bus)` with `bus(d)` = 08:00 on Sunday
  / 06:00 otherwise (cleanup.py's mapping, per the boundary's OWN day); rows
  covering a touched day are deleted and re-emitted, so runs merge with adjacent
  untouched same-kind rows and a נוכח day splits a block in two — all in one
  transaction, all computed by the pure `planPresenceWrite()`.
  Two views (per-soldier with a "מ־X עד־Y סמן כ־" bulk action, per-date matrix
  with a click-a-cell popup), the מצבת חיילים filter bar reused verbatim
  (extracted to `src/components/RosterFilters.tsx`), explicit save + leave guard.
  **CALENDAR-day semantics**: the read direction is `presenceMatrix()` in the
  same pure module, NOT the `presence()` DB function — that one buckets by
  `day_range()` (the 14:00→14:00 SCHEDULE day), so a one-day block would light
  up two cells. `presence()` has no other caller.
- **Level-1 load-order independence** (2026-07-26, found via the tab above):
  adding `and archived_at is null` to `load.ts`'s roster query — a predicate
  removing ZERO rows — changed generated schedules, because the query had no
  `ORDER BY`, its plan-dependent row order became the `state` Map order, and
  three decisions read that order raw. Fixed: `order by s.id` in the query;
  התקפי's group anchors `rankGroup`-ordered; the same-platoon anchor breaks
  count ties by מחלקה name; seat-rule role matches break same-role ties by id.
  Pinned by `tests/magensunday.test.ts` (reverses the roster Map, asserts an
  identical partition). **Any new `[...state.values()]` whose order feeds a
  decision needs its own tie-break.** See SPEC §H2b.
- **Sunday מגן fill order** (owner 2026-07-26): on a Sunday continuity is off
  and the crew is rebuilt, so מגן is demand-filled FIRST (right after the
  closed list) while every מחלקה is whole — otherwise it anchors on a pool
  סיור/התקפי already thinned. Weekdays keep the old order (continuity has
  already reserved the crew). SPEC §7 step 8, LOGIC.he.md step 8.
- **Local dev**: `npm run dev:api` (port 3001) + `npm run dev` (vite 5173);
  env in `.env`/`.env.local` (git-ignored). Vercel prod needs
  `SCHEDULER_DATABASE_URL` set in project env — NOT done yet; nothing pushed
  to the remote either.
- **Read `scheduler/SPEC.md` before touching scheduling logic** — every rule
  (H/R/T/P), the 14:00 day anchor, and the positions catalog live there.
- **Every rule change updates BOTH docs**: `scheduler/SPEC.md` (technical) and
  `scheduler/LOGIC.he.md` (pure-Hebrew rules for the officers — no field names
  or implementation detail). The owner checks they match exactly.

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
  psql-via-Docker pattern (no host psql), applying schema changes (consolidated
  baseline — the migrations dir is archived, never replay it), and the
  sheet-import pipeline with its gotchas (readiness-row duplication, 14:00
  boundary, reverse-diff for sheet edits). Quick ref: project `shavtzak-scheduler`
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
  docker exec -i shavtzak-pg psql -U postgres < scheduler/db/seed-candidates.sql
  ```

  Order matters: `seed-candidates.sql` (id-based candidate/whitelist lists)
  resolves names against the imported roster, so it runs AFTER
  `import_history.py` — it aborts on any unresolved name.

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
req/res like `scripts/dev-api.ts` does). In test fixtures, resolve positions /
sub-positions by **name lookup**, never by hardcoded seed ids (seed renumbering
silently breaks id-coupled tests). Run the relevant suite before committing.

## Conventions & gotchas

- **Soldier identity = foreign key, never a copied name** (owner decision,
  2026-07-19, after a one-letter pool-spelling bug silently hid יוחאי יעקובסון
  from קצין מוצב): a soldier's name may appear ONCE in the DB —
  `soldiers.full_name` (UNIQUE). Every other reference is a `soldier_id` FK.
  **The FK migration is DONE (2026-07-19)** — three id tables replaced the
  name-list configs: `position_candidates` (closed lists — sub NULL =
  position pool like קצין מוצב, sub set = named seat candidates like חפק;
  priority NULL = unordered/fairness, 1..n = ordered; `config.candidate_pool`
  is now just a boolean marker and `seat_rules` keeps metadata only),
  `magen_commander_history` (weekly decision, latest valid_from ≤ day wins —
  the `magen_commander` config key no longer exists), and
  `soldier_allowed_positions` (H6c — replaced the dropped
  `soldiers.allowed_positions` text[]). The ONLY file where soldier names may
  appear outside the roster is `scheduler/db/seed-candidates.sql` — the
  human-editable manifest, applied AFTER the roster import (aborts on any
  unresolved name). Any new soldier list MUST be an id table in the DB —
  never a name array, never hardcoded in code. The old `config_names`
  validator check is gone (FKs make dangling names impossible); the
  `config_roles` check now warns on configured role strings
  (`staff_all_roles`, `seat_rules[].roles`) matching no soldier's role, or
  qualification strings (`driver_qual`, seat-rule `qual`) matching no known
  qualification.

- **ALWAYS check if there's already a config that fulfills your need before
  adding a new one** — e.g. daily-duty classification is `positions.config.daily`
  (resolved by `effectiveConfig()`), on-call is `mission_class='readiness'`;
  never introduce a parallel flag or hardcode position names for a distinction
  the schema already expresses.

- **Manually resizing/cancelling specific shifts before generation** =
  `seat_overrides` rows, NOT hand-edited assignments: day/range-scoped
  (`valid_from` inclusive day, `valid_to` exclusive ts) + optional `start_time`
  for one shift; `seats=0` cancels the slot (day_slots omits it, generator
  redistributes). Delta: `scheduler/db/seat-overrides-hourly-2026-07-19.sql`.
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
