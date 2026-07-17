# מפרט מערכת שבצ"ק אוטומטית — Shavtzak Scheduler Spec (rev 2)

> Phase 1: assignment-rules spec + database design. DB (Supabase Postgres) is the
> source of truth; the Google Sheet becomes a synced output so the existing viewer
> app and manual workflows keep working.
>
> Rules consolidated from the Google Sheet (פלוגת גוש עלי-שילה) and its Apps Script
> tools: Recommendations Engine v2.6, שבצ"ק Validator, fillCarmelHativa,
> fillCarmelAlef, hours reports — plus new decisions made during spec review.

---

## 1. Core vocabulary

| Term | Meaning |
|---|---|
| Soldier | Roster member: platoon (עלי/שילה/גבעות צפון/גבעות דרום/מפלג), role (מ"פ/סמ"פ/מ"מ/סמל/מ"כ/מ"ח/לוחם…), rifle level (רובאי), qualifications (נהג דוד, נהג טיגריס, חובש, מאג, קלע, חמליסט…) |
| Schedule day | **14:00 → 14:00 next day** — the single day unit for Level-1 assignment, konenut, rest accounting, daily caps. A shift belongs to the schedule day containing its start |
| Night | **00:00–06:00** (fairness night-count window; configurable) |
| Position (עמדה) | Top-level Level-1 unit: סיור, עמדות הגנה (merged שג+בונקר+מזרחית+דרומית), מגן, התקפי, חפק, חמל (standing role crew), תורנים, קצין מוצב, מנוחה (rest on base), בבית (fully unavailable). כרמל חטיבה + כונן גשש are chained overlays |
| Slot | Concrete (position, sub-position, time-range, seat#) needing one soldier. Level-2 unit |
| Mission class | `static` (עמדות הגנה) / `dynamic` (סיור) / `readiness` (התקפי, כרמל, כונן גשש) / `other` (daily 14:00–14:00 duties: מגן, חפק, תורנים, קצין מוצב — outside T2/T3 rotation) — drives rotation + rest-transparency |
| Chained duty | Duty auto-staffed by the crew descending from a source shift (rule T4): כרמל חטיבה, כונן גשש |

## 2. Position/slot catalog (current template)

Template is **data, not code** — versioned in DB (`slot_templates.valid_from/valid_to`).
History shows 39 distinct position names over 20 days; templates change mid-deployment.

| Position | Slots × times | Duration |
|---|---|---|
| סיור | 4 seats × 06:00, 14:00, 22:00 | 8h |
| עמדות הגנה (שג/בונקר/מזרחית/דרומית) | 4 posts × 06,10,14,18,22,02 | 4h |
| מגן | 10 seats, **14:00–14:00** | daily; **continuity crew, one מחלקה** (kept day-to-day unless seat count or a manual change intervenes; repeats back-to-back at gap 0 — R5) |
| התקפי | 8 seats | **14:00–14:00** standing readiness crew; ad-hoc attack missions are recorded as separate mission rows and **must not overlap the readiness row** (H3 — the old attack↔readiness exception is removed) |
| חפק | 4 named seats (מפקד/קשר/חובש/נהג), **14:00–14:00** | daily; **dedicated candidates per seat — see H6b** |
| תורנים | 2 seats, **14:00–14:00** | full schedule day; class `other` — outside T2/T3 rotation; **soft T5**: at most one תורנות per soldier per rolling 7 days |
| כונן גשש | chained to סיור — see T4c | windows: 22–07, 07–14, 14–22 |
| קצין מוצב | 1 seat, **14:00–14:00** | full schedule day (no hours — the whole day) |
| חמל | **14:00–14:00**, variable crew | standing crew: every present role-חמל soldier daily (`staff_all_roles`); readiness class (rest-transparent); members whitelisted to חמל only (H6c) |
| כרמל חטיבה / מפקד כרמל חטיבה | 3+1 × 14,18,22,02,06,10 | 4h — same grid as עמדות הגנה |

Ad-hoc attack missions (פטרול, צ'קפוסט…) are recorded manually as extra
mission rows when they happen; they may **not** overlap a readiness row —
the readiness assignment must be trimmed/replaced for the attack window (H3).

**Boundary rule for daily missions** (resolved 2026-07-17, **effective
2026-07-19** via `slot_templates` versioning): all daily duties — מגן, חפק,
התקפי, קצין מוצב, תורנים, חמל — run **14:00–14:00**, so a daily mission
occupies exactly its schedule day and blocks nothing the day after; nothing
crosses the 14:00 boundary anymore. Days up to 18/07 keep their real
06:00–22:00 מגן/חפק windows (imported history — the validator judges them by
the templates that were in force). An assignment's counted hours still belong
to the schedule day containing its start (relevant for history rows that did
cross the boundary).

## 3. Hard constraints (H — never violated)

- **H1 Availability**: soldier with an active unavailability period (חופש, לא מגויס, short exits) can't be assigned during it. Partial-day periods (יציאה בערב, חזרה ב14:00) block only their window.
  **Bus-at-10:00 semantics** for whole-day home ranges in the roster matrix: a
  departing soldier works until 10:00 of his first home day; a returnee is
  available from 10:00 of his first present day, straight to a position — no
  rest needed (rest is measured from his last actual shift, and home counts
  as rest).
  **Replacement pairs** (partial-day completion): a slot seat may be covered
  by TWO soldiers who replace each other mid-slot — a *departing* soldier
  available from the slot start until his unavailability begins, and an
  *arriving* soldier available once his unavailability ends. The handover is
  the departing soldier's leave time (with bus-at-10:00 home blocks both
  sides meet at 10:00; the arriver may be back earlier and simply waits).
  This is a completion mechanism only, ranked like the pull-from-מנוחה path
  (after the primary candidate list and the מנוחה pull, before a בדוחק
  fallback): it runs only when no single fully-available candidate exists,
  and each half must pass every other hard rule cleanly (rest floor H8, daily
  cap R4, role gates, whitelists H6b/H6c — no בדוחק halves). The seat is
  recorded as two assignment rows whose periods split the slot at the
  handover (so the DB overlap constraint and the validator see real,
  non-overlapping intervals), and each half counts hours/nights by its real
  period. Pairs are NOT applied to readiness slots, chained overlays (T4), or
  staff_all_roles positions. Seat-rule positions get a restricted variant:
  a pair may split a named seat only when BOTH members come from that seat's
  own candidate list (see H6b) — never as a substitute from outside it. The
  validator's slot-coverage check counts a split-covered seat as fully
  staffed and still flags a partially-covered one (see §8).
- **H2 Excluded pools**: מפלג / חמ"ל members not scheduled (flag on soldier).
- **H3 No overlap**: no two time-overlapping assignments per soldier — **no
  exceptions**: a soldier is either on an active mission or on כוננות, never
  both (the former readiness↔attack exemption is removed). Enforced at
  the DB level for mission rows (`no_double_booking` EXCLUDE constraint), in
  the generator (`fits` rejects overlap with both mission and readiness
  intervals), and by the validator (`overlap`, `readiness_overlap` — a
  readiness row overlapping a mission row is an error; `blocks_overlap=false`
  DB semantics are unchanged for historical imports).
- **H3b No double standby**: a soldier cannot hold two overlapping readiness duties (e.g. התקפי and כרמל חטיבה simultaneously) — readiness rows don't block at the DB level, so this is enforced by the generator's chain pool and the validator (`double_readiness`).
- **H4 One position per schedule day**: exactly one Level-1 position (or מנוחה) per soldier per 14:00–14:00 day.
- **H5 Full-day blockers**: daily 14:00–14:00 duties (מגן, חפק, קצין מוצב, תורנים) and the התקפי readiness day occupy the whole schedule day — no other regular mission that day (H4 covers the Level-1 side; H3 forbids any overlap, with no attack exemption).
- **H6 Role gates**: קצין מוצב → סמל/מ"מ only. First seat of סיור/התקפי crew → commander. מ"מ/סמל never on עמדות הגנה.
- **H6b Named-seat positions** (`seat_rules` on the position config; currently חפק):
  each sub-position seat is filled only from its dedicated candidate list, in
  priority order —
  מפקד: role מ"פ, else סמ"פ; קשר: יהודה חושן → אור חיים בלונדר → יחיעם אושפיזאי
  (ordered); חובש: כפיר לנדסמן / שחר מיכאלי; נהג: אמיר יונייב / יאיר מובשוביץ
  (unordered pairs rotate by fairness P2-P6).
  **No substitutes**: if no candidate is available the seat stays EMPTY and an
  issue + validation warning is raised (never completed from מנוחה or בדוחק).
  **In-list pair handover**: when no single candidate covers the whole window
  but a departing candidate and an arriving candidate from the SAME list
  together do, they split the seat at the handover (H1 pair semantics, bus at
  10:00). Both come from the seat's own list, so "no substitutes" holds;
  ordered rules pick the pair by list priority, unordered by fairness. A
  single fully-available candidate always wins over a pair.
  **Exclusivity**: candidates (incl. role matches מ"פ/סמ"פ) serve ONLY in their
  seat-rule position — the generator reserves them and the validator errors on
  any other assignment. Exception (`release_unpicked`, the קשר rule): once the
  seat is covered, the unchosen candidates return to the general pool for that
  day. Unchosen candidates of non-release rules go to מנוחה.
- **H6c Per-soldier position whitelist** (`soldiers.allowed_positions`, null =
  unrestricted): a listed soldier may serve ONLY in those positions (chains
  included) — he competes normally inside them and rests otherwise. Currently:
  אריאל ביר → סיור. Enforced with H6b through one generator mechanism
  (`allowedIn`) and validated (`allowed_positions` rule).
  Contrast: H2 `is_schedulable=false` = outside the system entirely (חמל,
  מפלג); H6b = must-serve in a dedicated seat; H6c = may-serve-only.
- **H7 Crew integrity**: no duplicate soldier in a crew/slot. (The former
  מגן package rule is obsolete: מגן is a standalone continuity crew.)
- **H8 Rest floor**: < 4h rest before task → blocked (allowed only as flagged "בדוחק" fallback needing human approval).

## 4. Rest rules (R)

- **R1** — two regimes, both configurable:
  - *Generation* (candidate filtering): < 4h rest → blocked (H8, fallback-only);
    4–8h rest → allowed with warning for tasks ≤ 4h, fallback-only for tasks > 4h.
  - *Validation* (post-hoc): a gap < 4h between timed shifts (incl. vs previous
    day) is an **error**; 4–8h is a **warning** (a hard-8h error rule would
    flag every legal short-task pick the generation regime allows). R5-exempt
    14:00-boundary starts are skipped.
- **R2**: readiness (התקפי/כרמל/כונן גשש) is **rest-transparent** (assumed sleeping) and its hours are counted separately from mission hours.
- **R3 כונן גשש**: the demanding part is the morning departure (~05:30–07:00); rest check for the night window uses effective duration ~1.5h; prefer soldiers who slept the night.
- **R4 Daily cap**: ≤ 8 mission-hours per schedule day (readiness hours excluded). >8h = error; available soldier with 0 missions and not in מנוחה bucket = warning.
- **R5 Post-daily-task rest**: finishing a **daily 14:00–14:00 task** — a
  position flagged `full_rest_after` in its config: **מגן, חפק, התקפי,
  קצין מוצב** — counts as a full 8h rest for assignments starting at/after
  **14:00 of the next schedule day** (a gap of 0 at the 14:00 boundary is
  fine). This is also what lets the מגן continuity crew repeat back-to-back
  (14:00→14:00 then again 14:00→14:00) without a rest violation.
  **Exception — תורנים**: deliberately NOT flagged. Finishing תורן מטבח at
  14:00 grants no exemption: at least **4 hours** of rest are required before
  the next assignment (earliest next start 18:00), and 4–8h rest follows the
  normal R1 generation regime — allowed with warning for tasks ≤ 4h,
  fallback-only ("בדוחק") for longer tasks.
- **R6 Consecutive nights**: a night assignment (non-readiness shift intersecting
  00:00–06:00) on two consecutive schedule days = warning; three or more = error.
  `night_exempt` 24h duties (מגן, חפק, תורנים, קצין מוצב — the soldier sleeps)
  span the night window but do **not** count as nights, matching the P2
  fairness exemption. Validated post-hoc (`consecutive_nights`) over a 7-day
  lookback.

## 5. Rotation rules (T)

- **T1**: avoid same exact position on consecutive days.
- **T2**: avoid same mission class on consecutive days; alternating static/dynamic preferred.
- **T3**: 2+ consecutive static-only days → must break with a dynamic day (strong).
  Post-hoc: a 3rd consecutive static-only day is reported as a warning
  (`static_streak`).
- **T4 Chained duties** — deterministic staffing; the crew that just descended covers the standby:
  - **T4a כרמל חטיבה**: carmel shift starting at hour H = the 4 soldiers who finished עמדות הגנה at H, on the same 6×4h grid (defense 06–10 → carmel 10–14, …, 18–22 → carmel 22–02, 22–02 → carmel 02–06; previous day 10–14 → carmel 14–18). Commander seat = highest רובאי among them. Min staffing 3 regular + 1 commander (validated).
  - **T4b כוננות התקפית** — *retired*: the התקפי position is a standing Level-1
    crew (8 soldiers, 14:00–14:00) rather than patrol-chained windows; ad-hoc
    attack missions are separate rows that replace/trim the readiness (H3).
  - **T4c כונן גשש**: tied to סיור descents, **one soldier per descending patrol crew**:
    - סיור ירד ב-22:00 → כונן גשש 22:00–07:00
    - סיור ירד ב-06:00 → כונן גשש 07:00–14:00
    - סיור ירד ב-14:00 → כונן גשש 14:00–22:00
    - Selection within the crew: minimize + equalize cumulative tracker hours (pick crew member with lowest `tracker_hours_total`; ties broken by fairness order). Tracker time counts as readiness hours.
- **T5 תורנות שבועית (soft)**: at most one תורנות per soldier per rolling 7
  days. A **ranking preference, not a hard block**: when ranking candidates
  for תורנים, anyone with a תורנות in the last 7 days sorts after everyone
  without one (key placed right after the R1 quasi-constraint in the priority
  tuple). When nobody else exists the repeat is allowed, and the validator
  reports a warning (`second_toranut_week`).

## 6. Fairness & selection — priority list first, scoring fallback

### 6.1 Primary mechanism — lexicographic priority list

When choosing soldiers for a position/slot, order candidates by P1→P6; a lower-numbered
rule decides unless it ties, then the next rule breaks the tie:

| P | Rule | Window |
|---|---|---|
| P1 | Hard constraints H1–H8 (filter, eliminates) | — |
| P2 | Fewest **night assignments** (00–06). Readiness assignments do **not** count as nights (sleeping assumption, R2) | rolling 7 days; whole-deployment tie-break |
| P3 | Fewest **weighted mission hours** (readiness hours × low weight, default 0.25) | rolling 7 days |
| P4 | Rotation compliance: T3 streak-breakers first, then T2 class alternation, then T1 not-same-position | vs yesterday/streak |
| P5 | Role fit: commander where needed; נהג טיגריס on attack; נהג דוד on night patrol; מ"כ spread (avoid 2 static-commanders same hour); same-platoon-as-commander | current crew |
| P6 | Most rest since last shift | — |

Implementation notes on the ranking tuple: (a) when ranking for a concrete
slot start, candidates with a full 8h rest before it sort before all others
(R1 quasi-constraint — this is what spaces a soldier's two 4h shifts 8h
apart); (b) the T5 weekly-תורנות demotion key sits right after it; (c) P3
compares weighted hours in **8-hour buckets** (one duty-day) so small
differences don't override rotation (P4); exact hours only break remaining
ties. P5 is currently implemented as the commander quota + same-platoon
(מגן) only; the driver-fit and מ"כ-spread clauses are not yet wired in.

### 6.2 Fallback — compact scoring

If the priority list ties or is infeasible (e.g. crew needs conflicting P5 roles),
score remaining candidates with a small weight set (configurable in DB `config`,
defaults derived from engine v2.6, pruned of per-position weights):

| Weight | Default (lower score = better) |
|---|---|
| weekly weighted-hours | 1.4/h |
| weekly night count | 7 |
| short rest 4–8h | 28 |
| same class yesterday | 18; static-streak penalty 55 / break bonus −25 |
| role needed/missing (commander / tiger driver) | −26/+90, −35/+100 |
| fallback "בדוחק" base | +400 |

Dropped from v2.6: per-position 7-day count weights (static ×5 / tour ×3 / attack ×8),
same-position penalties (+24/+42) — replaced by P4 rotation rules and Level-1 position
balancing.

### 6.3 Level-1 position balance (across-position fairness)

Per-soldier `position_count[p]` over the deployment; when forming daily groups, prefer
soldiers with the lowest count for that position. Objective: minimize spread of
night_count first, weighted_hours second, per-position counts third.

## 7. Two-level generation

- **Level 1** (per 14:00–14:00 day): partition available soldiers into positions +
  מנוחה, sized by template seat counts, honoring locks, chained-duty pre-assignments
  (T4 sources from yesterday's/today's patrol & defense groups), and the priority list.
- **Level 2**: fill concrete slots inside each position (hours, seats, night rotation
  within group by night_count, commander first-seat) honoring H/R/T rules.
- Human can lock any row at either level; the generator schedules around locks; any
  forced violation is recorded on the row (`violations` jsonb) and surfaced.
- Multi-day: generate sequentially; each day sees previous drafts' counters.

## 8. Validation (post-generation & on manual edit)

Checks per day (parity with the Apps Script validator): rest ≥8h incl. previous day
(R5-exempt starts — at/after 14:00 of the day following a `full_rest_after` daily
task — are not flagged; a תורנים→14:00 immediate start is), overlaps (incl.
`readiness_overlap` — a readiness row overlapping a mission row, H3 strict), double
standby (H3b), chained-duty sourcing (carmel/tracker crews match their source
shifts), carmel min staffing, ≤8h/day, assignment vs availability,
present-but-unassigned, unknown soldier names, consecutive nights (R6: 2 = warning,
3+ = error; `night_exempt` duties excluded), static streak (T3: 3rd static-only day
= warning), weekly תורנות repeats (T5: 2+ תורנות days within 7 days = warning
`second_toranut_week`). Slot coverage counts the **minimum concurrent**
assignment rows over each slot window, so a seat covered by an H1 replacement pair
(two rows splitting at the handover) is fully staffed, while a partially-covered
seat is flagged. Results snapshot stored on
`schedule_days.validation` (jsonb) — written automatically after every generation
(`persist`) and available via CLI `validate <day>`.

## 9. Database design

See `db/schema.sql` (full DDL) and `db/seed.sql` (current template seed).

Principles:
- **Small hand-managed source tables; derived data = views.** e.g. no stored presence
  matrix — sparse `unavailability` periods; no row ⇒ soldier available; the per-day
  presence matrix and all fairness counters are views.
- **Seat counts change over time via `seat_overrides`** (position, valid_from,
  seats-per-slot; latest wins) — resolved by the `day_slots` view, managed by hand.
- **Position behavior flags live in `positions.config` jsonb**: `continuity`,
  `same_platoon` (מגן), `night_exempt`, `full_rest_after`, `open_for_attack`.
- Facts (`shift_assignments`) and decisions (`day_assignments`, locks) are tables.
- Double-booking is impossible at the DB level: `EXCLUDE USING gist
  (soldier_id WITH =, period WITH &&) WHERE (blocks_overlap)` on `shift_assignments`
  (readiness rows set `blocks_overlap=false`, implementing H3's exception).
- T4 chain rules are rows in `chain_rules`, not code.
- All tunables (night window, day anchor, rest thresholds, scoring weights, priority
  list) live in `config` (key → jsonb).

### Import (one-time, from the sheet)

- `מצבת החיילים` → `soldiers`; date-status matrix compressed into `unavailability`
  periods (consecutive non-נוכח runs → one row).
- `הסמכות` + roster hints → `soldier_qualifications`.
- `כל השבצק` (~1,870 rows) → `shift_assignments` (source='import') — seeds fairness
  counters with real accumulated load.
- `יציאות לזמן קצר` → `unavailability` (kind='יציאה').
- שבצק slot list → `positions` / `sub_positions` / `slot_templates` / `chain_rules`.

### Sheet sync-out

On day approval: append that day's `shift_assignments` to `כל השבצק`
(תאריך/העמדה/סוג/השעה/החייל) via the existing service-account key. Viewer app + old
validator keep working. Optional: render the daily שבצק-tab layout.

## 10. Open items

- ~~Daily missions vs 14:00 anchor~~ — **resolved (2026-07-17, effective
  2026-07-19)**: daily missions re-anchored to 14:00–14:00 windows (מגן and חפק
  moved from 06:00–22:00, via template versioning so history days keep their
  real windows); every duty nests cleanly inside one schedule day and the former
  tail/boundary handling is obsolete (§2 boundary rule rewritten accordingly).
- Night 00–06 replaces the engine's 22–06 in all counters — historical comparisons
  will differ slightly.
- מנוחה is an explicit Level-1 bucket (present-but-unassigned becomes impossible by
  construction; validator check remains as a safety net).
- History data quality: import dry-run found **50 genuinely overlapping rows** in
  כל השבצק (mostly יומי + timed shift, same soldier, same day). Decide per row on
  real import: drop, trim, or mark `blocks_overlap=false`.

## 11. Import data-quality decisions (resolved)

- The 50 genuinely-overlapping history rows (יומי mission alongside a timed shift,
  same soldier, same day) are imported with `blocks_overlap=false` — day-duty
  semantics, matching the Apps Script engine's treatment.
- Soldier-name spelling variants (e.g. קלין/קליין) are merged automatically:
  normalized-name match (quotes stripped, spaces collapsed, single-letter edit
  distance within the same platoon); the roster spelling is kept and history rows
  re-pointed. Every merge is logged.
- `unavailability` is built from the roster's date-status matrix: consecutive
  non-נוכח runs become one period row anchored to 14:00 day boundaries.

## 12. Operational UI (viewer app)

Two officer-only tabs (client-side gating via COMPANY_ROLES, consistent with the
existing סיכום פלוגתי tab) added to the existing React viewer:

- **שבצק חדש (טיוטה)** — daily draft view. Date picker with optional multi-day range;
  renders drafts from the DB in the same station-group layouts as the sheet-based
  שבצק tab. Shows per-day status badge, per-assignment violation markers, the day's
  validation panel (errors/warnings), and the מנוחה list. A **צור שבצ"ק** button
  triggers generation for the selected day(s) via the API; regeneration replaces
  only `source in ('auto','chain')` unlocked rows. Days remain in the draft family
  (`generated`) — approval/publish and sheet sync-out are explicitly out of scope.
- **הוגנות** — weekly compliance + fairness dashboard. Date picker selects the
  rolling-7-day window end (Sunday-anchored). Top: summary strip (total
  errors/warnings across the window, or "all rules hold"). Then one card per
  rule criterion (exceptions-only: green ✓ when clean, otherwise the offending
  soldiers/days) — rest, daily cap, consecutive nights (R6), static streak (T3),
  availability, overlaps/double standby, chain sourcing + carmel staffing, seat
  rules, position restrictions, slot coverage, present-but-unassigned. Findings
  come from running the validator over each day of the window. Below: fairness
  cards — nights 7d and weighted-hours 7d spread (min/max/avg/stddev with
  top/bottom outlier names) and per-position balance from `position_counts`.
  Platoon filter applies to all cards.

Data flows through two Vercel serverless endpoints (`api/draft.ts`, `api/fairness.ts`)
reading the scheduler DB via `SCHEDULER_DATABASE_URL`; endpoints are open like the
existing sheet endpoints (no server-side auth) per current app security model.
