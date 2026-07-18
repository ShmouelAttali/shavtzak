# מפרט מערכת שבצ"ק אוטומטית — Shavtzak Scheduler Spec (rev 3)

> Phase 1: assignment-rules spec + database design. DB (Supabase Postgres) is the
> source of truth; the Google Sheet becomes a synced output so the existing viewer
> app and manual workflows keep working.
>
> Rules consolidated from the Google Sheet (פלוגת גוש עלי-שילה) and its Apps Script
> tools: Recommendations Engine v2.6, שבצ"ק Validator, fillCarmelHativa,
> fillCarmelAlef, hours reports — plus new decisions made during spec review.
>
> rev 3 (2026-07-18): owner rules overhaul — everyone-works flex sizing (מגן
> 10–12, סיור 3–4), hard crew drivers (H6d), קצין מוצב candidate pool (H6-pool),
> absolute rest floor (H8), T6 on-call streak, T3/T6 ranked above night fairness,
> night-only כונן גשש load (R3), bus at 08:00, מפלג position, weekly מגן
> commander, התקפי commander seat + platoon groups.
>
> rev 3.1 (2026-07-18): half-day exit requests (יציאה קצרה) — H9 exit-day
> exclusions, R7 exit-day rest relaxation, §7 exit pre-passes, §8 exit
> validator keys, §9 `exit_requests` table, §12 soldier-facing tab + endpoint.

---

## 1. Core vocabulary

| Term | Meaning |
|---|---|
| Soldier | Roster member: platoon (עלי/שילה/גבעות צפון/גבעות דרום/מפלג), role (מ"פ/סמ"פ/מ"מ/סמל/מ"כ/מ"ח/לוחם…), rifle level (רובאי), qualifications (נהג דוד, נהג טיגריס, חובש, מאג, קלע, חמליסט…) |
| מפקד (commander) | Any of **מ"מ / סמל / מ"כ / מ"ח (מפקד חוליה)** — satisfies commander seats/quotas (H6). מ"מ/סמל are the *senior* commanders (the only ones gated off עמדות הגנה) |
| Schedule day | **14:00 → 14:00 next day** — the single day unit for Level-1 assignment, konenut, rest accounting, daily caps. A shift belongs to the schedule day containing its start |
| Night | **00:00–06:00** (fairness night-count window; configurable) |
| Position (עמדה) | Top-level Level-1 unit: סיור, עמדות הגנה (merged שג+בונקר+מזרחית+דרומית), מגן, התקפי, חפק, חמל (standing role crew), תורנים, קצין מוצב, מפלג (staff crew), מנוחה (rest on base — a **reported exception**, not a planned outcome; see everyone-works, §2), בבית (fully unavailable). כרמל חטיבה + כונן גשש are chained overlays |
| Slot | Concrete (position, sub-position, time-range, seat#) needing one soldier. Level-2 unit |
| Mission class | `static` (עמדות הגנה) / `dynamic` (סיור) / `readiness` (התקפי, כרמל, כונן גשש) / `other` (daily 14:00–14:00 duties: מגן, חפק, תורנים, קצין מוצב, מפלג — outside T2/T3 rotation) — drives rotation + rest-transparency |
| Chained duty | Duty auto-staffed by the crew descending from a source shift (rule T4): כרמל חטיבה, כונן גשש |

## 2. Position/slot catalog (current template)

Template is **data, not code** — versioned in DB (`slot_templates.valid_from/valid_to`).
History shows 39 distinct position names over 20 days; templates change mid-deployment.

| Position | Slots × times | Duration |
|---|---|---|
| סיור | **3–4** seats (flex) × 06:00, 14:00, 22:00 | 8h; `flex_seats` 3–4 — 4 normally, shrinks one seat per shift down to 3 only on soldier shortage (everyone-works); every crew: **מפקד in the first seat (H6) + נהג דוד (H6d)** |
| עמדות הגנה (שג/בונקר/מזרחית/דרומית) | 4 posts × 06,10,14,18,22,02 | 4h |
| מגן | **10–12** seats (flex), **14:00–14:00** | daily; **continuity crew, one מחלקה** (kept day-to-day unless seat count or a manual change intervenes; repeats back-to-back at gap 0 — R5); `flex_seats` 10–12 — absorbs surplus soldiers up to 12 (everyone-works); commander = the persisted weekly `magen_commander` decision, and his מחלקה anchors the crew's same-platoon preference (§7) |
| התקפי | 8 seats | **14:00–14:00** standing readiness crew; **first seat = מפקד (H6 hard)**; crew must include a **נהג טיגריס (H6d)**; soft composition (`group_size` 4): two groups of (1 מפקד + 3 soldiers), each group preferably from one מחלקה (the groups may differ) — implemented as a commander quota of 2 + same-platoon group fill (P5). Ad-hoc attack missions are recorded as separate mission rows and **must not overlap the readiness row** (H3 — the old attack↔readiness exception is removed) |
| חפק | 4 named seats (מפקד/קשר/חובש/נהג), **14:00–14:00** | daily; **dedicated candidates per seat — see H6b** |
| תורנים | 2 seats, **14:00–14:00** | full schedule day; class `other` — outside T2/T3 rotation; **soft T5**: at most one תורנות per soldier per rolling 7 days |
| כונן גשש | chained to סיור — see T4c | windows: 22–07, 07–14, 14–22; **only the night window counts as load** (R3) |
| קצין מוצב | 1 seat, **14:00–14:00** | full schedule day; manned **only from a fixed candidate pool** — see H6-pool |
| חמל | **14:00–14:00**, variable crew | standing crew: every present role-חמל soldier daily (`staff_all_roles`); readiness class (rest-transparent); members restricted to חמל only via the derived H6c whitelist |
| מפלג | **14:00–14:00**, variable staff crew | the רס"פ/סרס"פ/מנהלה staff do **no shifts**; they appear in the שבצק in this dedicated daily position whenever present on base and are restricted to it (`staff_all_roles`, like חמל). Presence follows the sheet's מפלג tab (סטטוס מגיע/לא מגיע → the soldier's schedulable flag — see Import) |
| כרמל חטיבה / מפקד כרמל חטיבה | 3+1 × 14,18,22,02,06,10 | 4h — same grid as עמדות הגנה; commander seat: prefer a real מפקד from the descending crew, else highest רובאי (T4a) |

**Everyone works** (owner rule, 2026-07-18): **מנוחה is no longer a planned
outcome** — every present soldier must do a shift (~8h) every schedule day
unless at home. All positions are filled first; surplus soldiers then enlarge
מגן up to its flex max (12); מגן's minimum is 10; when soldiers are missing,
flex positions shrink — סיור drops from 4 to a minimum of 3 seats per shift
(`flex_seats` on the position config). An explicit manual seat override may
enlarge מגן **beyond** 12 (the manual decision wins); shrinking below the flex
minimum loses to everyone-works — surplus soldiers still get seats. A soldier
left in מנוחה is reported (generation issue + validator warning `rest_bucket`).
Exception (owner decision 2026-07-19): unchosen candidates of a **non-release
seat rule** (H6b — e.g. the חפק מ"פ/סמ"פ commander seat) are reserved to their
seat with no substitutes, so their מנוחה day is by design — neither report
flags them. Slot coverage is judged against the flex **minimum** (§8).

Ad-hoc attack missions (פטרול, צ'קפוסט…) are recorded manually as extra
mission rows when they happen; they may **not** overlap a readiness row —
the readiness assignment must be trimmed/replaced for the attack window (H3).

**Boundary rule for daily missions** (resolved 2026-07-17, **effective
2026-07-19** via `slot_templates` versioning): all daily duties — מגן, חפק,
התקפי, קצין מוצב, תורנים, חמל, מפלג — run **14:00–14:00**, so a daily mission
occupies exactly its schedule day and blocks nothing the day after; nothing
crosses the 14:00 boundary anymore. Days up to 18/07 keep their real
06:00–22:00 מגן/חפק windows (imported history — the validator judges them by
the templates that were in force). An assignment's counted hours still belong
to the schedule day containing its start (relevant for history rows that did
cross the boundary).

## 3. Hard constraints (H — never violated)

- **H1 Availability**: soldier with an active unavailability period (חופש, לא מגויס, short exits) can't be assigned during it. Partial-day periods (יציאה בערב, חזרה ב14:00) block only their window.
  **Bus-at-08:00 semantics** (changed from 10:00, 2026-07-18; boundaries
  before that date reflect what actually happened and stay at 10:00) for
  whole-day home ranges in the roster matrix: a
  departing soldier works until 08:00 of his first home day; a returnee is
  available from 08:00 of his first present day, straight to a position — no
  rest needed (rest is measured from his last actual shift, and home counts
  as rest).
  **Replacement pairs** (partial-day completion): a slot seat may be covered
  by TWO soldiers who replace each other mid-slot — a *departing* soldier
  available from the slot start until his unavailability begins, and an
  *arriving* soldier available once his unavailability ends. The handover is
  the departing soldier's leave time (with bus-at-08:00 home blocks both
  sides meet at 08:00; the arriver may be back earlier and simply waits).
  This is a completion mechanism only, ranked like the pull-from-מנוחה path
  (after the primary candidate list and the מנוחה pull, before a בדוחק
  fallback): it runs only when no single fully-available candidate exists,
  and each half must pass every other hard rule cleanly (rest floor H8, daily
  cap R4, role gates, whitelists H6b/H6c — no בדוחק halves). The seat is
  recorded as two assignment rows whose periods split the slot at the
  handover (so the DB overlap constraint and the validator see real,
  non-overlapping intervals), and each half counts hours/nights by its real
  period. Pairs DO apply to daily readiness rows (התקפי-style 24h duties) and
  to H6d required-driver seats — on mass-exchange days the departing soldier
  holds the row until the bus and the arriving one takes it from there (both
  halves must hold the driver qualification on a driver seat; readiness
  halves stay rest-transparent, non-blocking rows). Owner decision
  2026-07-19: this replaced the previous readiness/driver-seat exclusion —
  a readiness seat left empty on an exchange day while a leaver+arriver pair
  could cover it was a coverage hole, not a rest saving. Pairs are still NOT
  applied to chained overlays (T4 has its own arrivals-preferred completion)
  or staff_all_roles positions. Seat-rule positions get a restricted variant:
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
- **H5 Full-day blockers**: daily 14:00–14:00 duties (מגן, חפק, קצין מוצב, תורנים, מפלג) and the התקפי readiness day occupy the whole schedule day — no other regular mission that day (H4 covers the Level-1 side; H3 forbids any overlap, with no attack exemption).
- **H6 Role gates**: first seat of **every סיור crew** and of the **התקפי
  crew** → מפקד (מ"מ/סמל/מ"כ/מ"ח) — hard, `commander_first_seat` on both
  templates. מ"מ/סמל never on עמדות הגנה. קצין מוצב is governed by H6-pool
  below; the old סמל/מ"מ role gate remains **only as fallback** when no
  candidate pool is configured for it.
- **H6-pool Candidate-pool positions** (`candidate_pool` on the position
  config; currently קצין מוצב): the position is manned **ONLY** from its fixed
  name list — שמואל אטלי, צבי שור, יוחאי יעקבסון, אורי שאג, אלעד זיו,
  אביאל גיאת, עמיחי ברוורמן, גלעד דביר. The list is **unordered** — the duty
  rotates among the members by fairness (P2–P6). **Non-exclusive** (unlike
  H6b): list members serve anywhere normally when not picked. **Staffed
  first** (owner decision 2026-07-19): a closed-list position gets its pick
  before any other reservation — including the מגן-commander reservation and
  continuity — can consume a pool member (§7 Level-1 step 3); the persisted
  מגן commander is picked from the pool only when no other member is
  available, and מגן then emits a substitute-commander issue. Enforced through
  every fill path (the same `allowedIn` whitelist mechanism as H6b/H6c) and
  validated (`role_gate` error; imported history rows predate the rule and are
  excused).
- **H6b Named-seat positions** (`seat_rules` on the position config; currently חפק):
  each sub-position seat is filled only from its dedicated candidate list, in
  priority order —
  מפקד: role מ"פ, else סמ"פ; קשר: יהודה חושן → אור חיים בלונדר → יחיעם אושפיזאי
  (ordered); חובש: כפיר לנדסמן / שחר מיכאלי; נהג: אמיר יונייב / יאיר מובשוביץ
  (unordered pairs rotate by fairness P2-P6).
  **Qualification guard** (`qual` on a seat rule, e.g. חובש → 'חובש',
  נהג → 'נהג דוד'): the named list stays authoritative, but a pick lacking the
  qualification (checked against soldier_qualifications AND the free-text
  role) is flagged — generation issue + validator warning
  (`seat_qualification`). Never blocks the seat.
  **No substitutes**: if no candidate is available the seat stays EMPTY and an
  issue + validation warning is raised (never completed from מנוחה or בדוחק).
  **In-list pair handover**: when no single candidate covers the whole window
  but a departing candidate and an arriving candidate from the SAME list
  together do, they split the seat at the handover (H1 pair semantics, bus at
  08:00). Both come from the seat's own list, so "no substitutes" holds;
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
  אריאל ביר → סיור; יהונתן רוט → עמדות הגנה + כרמל חטיבה (its T4a chain) +
  תורנים. Enforced with H6b through one generator mechanism
  (`allowedIn`) and validated (`allowed_positions` rule).
  **Derived whitelist — `staff_all_roles`**: a soldier whose role matches a
  `staff_all_roles` position (role חמל → position חמל) is implicitly
  restricted to that position, through the same `allowedIn` mechanism and the
  same validator rule — no explicit `allowed_positions` row needed (an
  explicit row, when present, wins). H6c's column stays for genuine
  per-soldier cases.
  Contrast: H2 `is_schedulable=false` = outside the system entirely (מפלג);
  H6b = must-serve in a dedicated seat; H6c (explicit or role-derived) =
  may-serve-only.
- **H6d Crew drivers** (`driver_qual` on the position config): every **סיור**
  crew must include a **נהג דוד**; the **התקפי** crew must include a
  **נהג טיגריס**. Hard — the required drivers are assigned **before** any
  soft/fairness assignment: Level 1 fills a driver quota (one qualified driver
  per distinct slot start) right after the commander quota; Level 2 reserves
  the seat right after the commander seat as a dedicated driver seat until the
  crew has one. Validated (`driver` rule, error; crews that are entirely
  imported history are excused). The old soft P5 driver preferences remain as
  tie-breakers beyond the one required driver.
- **H7 Crew integrity**: no duplicate soldier in a crew/slot. (The former
  מגן package rule is obsolete: מגן is a standalone continuity crew.)
- **H8 Rest floor — absolute**: < 4h rest before a task → hard block. **Never
  a "בדוחק" fallback, no exceptions** — the only exemptions are the R5
  daily-duty full-rest rule, which is already folded into the rest gap, and
  R7's half-day-exit relaxation (the exit soldier's own exit-day shifts
  only). The generator hard-blocks such picks; the validator reports an error.
- **H9 Half-day exit (יציאה קצרה)**: an approved half-day exit request
  (self-service, auto-approved — see §9/§12) blocks assignment during its
  window like any unavailability (merged into the soldier's blocked windows),
  and on his exit day the soldier additionally gets **no daily 14:00–14:00
  duty** (מגן, חפק, תורנים, קצין מוצב, התקפי standing, מפלג) and **no
  readiness/on-call row** (כרמל חטיבה, כונן גשש) — he may serve only in a
  **shift position**: one that is neither `daily` nor readiness-class (the
  shared `isShiftPosition` predicate; today that resolves to סיור /
  עמדות הגנה — nothing hardcodes position names). Enforced through the single
  restriction gate (`allowedIn`, like H6b/H6c/H6-pool), so every fill path —
  Level 1, Level 2, pairs, chains — puts **someone else** on the chained
  standby (T4 completion). A seat-rule candidate (H6b) with an exit that day
  is skipped — the next candidate on the list takes the seat. Validated:
  `exit_window` / `exit_daily` errors (§8).

## 4. Rest rules (R)

- **R1** — two regimes, both configurable:
  - *Generation* (candidate filtering): < 4h rest → **hard block** (H8
    absolute — never a fallback); 4–8h rest → allowed with warning for tasks
    ≤ 4h, fallback-only for tasks > 4h.
  - *Validation* (post-hoc): a gap < 4h between timed shifts (incl. vs previous
    day) is an **error**; 4–8h is a **warning** (a hard-8h error rule would
    flag every legal short-task pick the generation regime allows). R5-exempt
    14:00-boundary starts are skipped.
  - **Daily-duty exception** (owner decision 2026-07-19): 4h rest **suffices**
    before a daily 14:00–14:00 duty (`config.daily` — מגן/התקפי/תורנים/חפק/
    קצין מוצב): the soldier sleeps inside the duty, so the 4–8h band produces
    no long-task fallback, no generation warning, and no validation warning.
    The < 4h hard block / error is unchanged.
- **R2**: readiness (התקפי/כרמל/כונן גשש) is **rest-transparent** (assumed sleeping) and its hours are counted separately from mission hours.
- **R3 כונן גשש — night window only** (owner decision 2026-07-18): a גשש
  **night window** (22:00–07:00, i.e. any גשש row overlapping its schedule
  day's 00:00–06:00) counts as `gashash_effective_hours` (tunable, default
  1.5) of effective work instead of 9h: its **effective end = window start +
  1.5h** (22:00 → 23:30) joins the rest-gap search in both the generator
  (`restInfo`) and the validator, even though readiness is otherwise
  rest-transparent (R2). Practical effect: a task starting 07:00 next morning
  sees 7.5h rest (short-rest regime), not "fully rested since yesterday's
  patrol". **Day windows (07–14, 14–22) count as no load at all** — they
  contribute no effective-rest end AND no cumulative גשש-hours: the
  `tracker_hours_total` counter (generator and `soldier_fairness` SQL alike)
  accrues **only** night windows. Selection for the night window
  prefers crew members who **slept the previous night** (no counted-night
  assignment in [D 00:00, D 06:00]), then lowest cumulative tracker hours,
  then fairness order (see T4c).
- **R4 Daily cap**: ≤ 8 mission-hours per schedule day (readiness hours excluded). >8h = error; available soldier with 0 missions and not in מנוחה bucket = warning (`unassigned`); available soldier bucketed to מנוחה = warning (`rest_bucket`, everyone-works).
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
- **R7 Exit-day rest relaxation**: on a half-day-exit day (H9), the exit
  soldier's rest is honored when possible; when the remaining window doesn't
  allow it, his shifts may be packed **back-to-back with zero rest** as a
  flagged בדוחק fallback (fit code `exit_rest`) — including a 14:00 start
  right after the previous rotation's 14:00 end. This is the only relaxation
  of the H8 floor; it applies to the exit soldier **alone** and never relaxes
  anyone else's rest, and H4 (one Level-1 position per schedule day) is
  unchanged. Validated as a warning (`exit_rest`) instead of the rest error
  (§8).

## 5. Rotation rules (T)

- **T1**: avoid same exact position on consecutive days.
- **T2**: avoid same mission class on consecutive days; alternating static/dynamic preferred.
- **T1/T2 exemption — structurally fixed crews**: positions whose membership is
  locked by design — continuity (מגן), dedicated seats (`seat_rules`, חפק) and
  role crews (`staff_all_roles`, חמל/מפלג) — take no T1/T2 penalty and no
  "same-as-yesterday" rationale caveat for repeating members (מגן additionally
  *prefers* the returning member; חפק/חמל are neutral so seat pairs still
  rotate purely by fairness).
- **T3**: 2+ consecutive static-only days → must break with a dynamic day (strong).
  Post-hoc: a 3rd consecutive static-only day is reported as a warning
  (`static_streak`). **Priority reversal** (owner decision 2026-07-18): a
  constant static position is WORSE than repeated nights — the T3
  streak-rotation key (and T6 below) ranks **above** fewest-nights (P2) in the
  priority list (§6.1).
- **T6 On-call streak (soft)**: avoid a 3rd consecutive day in which a soldier
  has ONLY static posts + כוננות (התקפי/כרמל) — constant on-call. Ranking
  demotion placed above night fairness like T3 (a candidate with a 2-day
  on-call-only streak is demoted for another static/readiness assignment) +
  validator warning (`oncall_streak`).
- **T4 Chained duties** — deterministic staffing; the crew that just descended covers the standby:
  - **T4a כרמל חטיבה**: carmel shift starting at hour H = the 4 soldiers who finished עמדות הגנה at H, on the same 6×4h grid (defense 06–10 → carmel 10–14, …, 18–22 → carmel 22–02, 22–02 → carmel 02–06; previous day 10–14 → carmel 14–18). Commander seat: prefer a **real מפקד** (מ"מ/סמל/מ"כ/מ"ח) from the descending crew; only when none exists take the **highest רובאי** among them. Min staffing 3 regular + 1 commander (validated).
  - **T4b כוננות התקפית** — *retired*: the התקפי position is a standing Level-1
    crew (8 soldiers, 14:00–14:00) rather than patrol-chained windows; ad-hoc
    attack missions are separate rows that replace/trim the readiness (H3).
  - **T4c כונן גשש**: tied to סיור descents, **one soldier per descending patrol crew**:
    - סיור ירד ב-22:00 → כונן גשש 22:00–07:00
    - סיור ירד ב-06:00 → כונן גשש 07:00–14:00
    - סיור ירד ב-14:00 → כונן גשש 14:00–22:00
    - Selection within the crew: for the **night window (22:00–07:00)** first
      prefer members who slept the previous night (R3), then minimize +
      equalize cumulative tracker hours (lowest `tracker_hours_total`), then
      fairness order. Tracker time counts as readiness hours; the cumulative
      tracker counter accrues **only night windows** — day windows are free
      (R3).
  - **T4 completion** (owner rule, 2026-07-18): when descending crew members
    cannot hold the standby (went home, otherwise booked, restricted), the
    chain is **completed with fresh soldiers** instead of staying short —
    preferring soldiers who just **arrived** back on base (a home block ending
    within the 24h before the window), then anyone available, in fairness
    order. Source members always take priority; completions only top up the
    gap. Completion rows carry a `chain_completion` rationale; the validator
    reports an out-of-crew standby as a **warning** when it covers a genuine
    shortfall, and as an **error** when an available source member was left
    unused or the outsider is redundant on a fully-covered window (§8).
- **T5 תורנות שבועית (soft)**: at most one תורנות per soldier per rolling 7
  days. A **ranking preference, not a hard block**: when ranking candidates
  for תורנים, anyone with a תורנות in the last 7 days sorts after everyone
  without one (key placed right after the R1 quasi-constraint in the priority
  tuple). When nobody else exists the repeat is allowed, and the validator
  reports a warning (`second_toranut_week`).

## 6. Fairness & selection — lexicographic priority list

### 6.1 The priority list

When choosing soldiers for a position/slot, candidates are ordered by a
lexicographic key tuple; an earlier key decides unless it ties, then the next
key breaks the tie. The exact key order (`rank.ts key()`), reflecting the
2026-07-18 priority reversal — static-streak/on-call rotation ABOVE night
fairness:

| # | Key | Window |
|---|---|---|
| 1 | Hard constraints H1–H8 (filter, eliminates — P1) | — |
| 2 | R1 quasi-constraint: candidates with a full 8h rest before the slot start sort before all others | — |
| 3 | T5 demotion (תורנים only): anyone with a תורנות in the last 7 days sorts after everyone without one | rolling 7 days |
| 4 | **T3 (above P2)**: on a 2+ static-only-day streak, demoted for another static slot / promoted for a dynamic (streak-breaking) one | streak |
| 5 | **T6 (above P2)**: on a 2+ on-call-only-day streak (static+readiness only), demoted for another static/readiness slot | streak |
| 6 | **P4b sub-post rotation (above P2)** — within the same 24h round, a soldier mans a DIFFERENT static post each shift (not שג twice in one day): fewest same-sub assignments today first | current day |
| 7 | **P2** — fewest **night assignments** (00–06, incl. today's fresh nights when ranking a night slot). Readiness assignments do **not** count as nights (sleeping assumption, R2) | rolling 7 days |
| 8 | **P3** — fewest **weighted mission hours** (readiness hours × low weight, default 0.25), compared in **8-hour buckets** (one duty-day) so small differences don't override rotation | rolling 7 days |
| 9 | **P4** — rotation penalty cascade: T3 streak-breakers first, then T2 class alternation, then T1 not-same-position (continuity/seat-rule/staff crews exempt) | vs yesterday/streak |
| 10 | **P4 (L1 balance)** — fewest times in this position over the deployment | whole deployment |
| 11 | **P5 role fit** (ties only, beyond the H6d required driver): נהג טיגריס preferred for the התקפי crew; נהג דוד preferred for a סיור slot overlapping the night window; מ"כ spread (a commander is demoted for a static slot when a commander already mans a static post starting at the same hour) | current crew |
| 12 | P3 fine tie-break — exact weighted hours | rolling 7 days |
| 13 | **P6** — most rest since last shift (clamped at 48h) | — |

Deterministic final tie-break: Hebrew name order. The rest of P5 is
implemented structurally rather than as ranking keys: the Level-1 commander
quota (incl. התקפי's 2-commander group quota), the H6d driver quota/seat,
same-platoon crews (מגן, anchored by the weekly מגן commander), and the
התקפי platoon-group fill (each picked commander anchors a group of 3 filled
preferably from his own מחלקה).

There is no scoring fallback: the priority list (with its deterministic
Hebrew-name final tie-break) plus the explicit completion flow (pull from
מנוחה → H1 replacement pair → flagged "בדוחק" fallback) IS the selection
mechanism. (The former §6.2 compact-scoring table — engine v2.6 weights —
was never implemented and was removed by owner decision, 2026-07-17.)

### 6.2 Level-1 position balance (across-position fairness)

Per-soldier `position_count[p]` over the deployment; when forming daily groups, prefer
soldiers with the lowest count for that position. Objective: minimize spread of
night_count first, weighted_hours second, per-position counts third.

## 7. Two-level generation

- **Level 1** (per 14:00–14:00 day): partition available soldiers into
  positions, in this order:
  1. honor Level-1 **locks**;
  2. **H6b seat-rule pre-pass** (חפק) and **staff_all_roles crews** (חמל, מפלג);
  3. **closed-list pre-pass** (owner decision 2026-07-19): every
     `candidate_pool` position (H6-pool — קצין מוצב) is staffed now, from its
     fixed list only, by the pool's fairness rotation — BEFORE the
     מגן-commander reservation, continuity, or any later fill can consume a
     pool member (the list is small and has no substitutes, so its pick
     always wins). The persisted `magen_commander` is taken from the pool
     only as a **last resort** — when another member can hold the seat, מגן
     keeps its commander; rationale `candidate_pool`;
  4. **flex sizing** (everyone-works): מגן seats = the free pool minus the
     other positions' demand, clamped to the flex range (10–12; a manual seat
     override may raise the max); on shortage, flex positions (סיור) shrink
     one seat per shift down to their min (3) until מגן's minimum crew fits;
  5. **מגן commander reservation**: the persisted weekly decision (config key
     `magen_commander`) names the מגן commander — he is reserved to מגן before
     anything else except a closed list can take him, and his מחלקה anchors
     the crew's same-platoon preference. If the closed-list pre-pass already
     took him (he was the only available pool member), מגן falls back with a
     generation issue — `מגן: המפקד המוגדר X שובץ לקצין מוצב — נדרש מפקד מגן
     חלופי` — so the officer names a substitute;
  6. **continuity pre-pass** (מגן): returning crew members reserved;
  7. **half-day-exit pre-pass** (H9): every exit-day soldier not already
     placed by a lock or seat rule is assigned a **shift position**
     (`isShiftPosition` — non-daily, non-readiness) with at least one slot
     outside his exit window — preferring unmet demand, then packing
     feasibility (most available non-overlapping slots outside the window),
     then P4 position balance; rationale `exit_shift_fill`. No fitting
     position → generation issue, and the soldier falls through to the
     normal flow;
  8. demand-driven fill in a fixed order (קצין מוצב → סיור → התקפי → מגן →
     עמדות הגנה), in **two passes**: pass A reserves the HARD role needs for
     ALL positions first — per position the **commander quota** (one per
     commander-first slot start; התקפי: one per `group_size` group = 2) and
     the **H6d driver quota** (one qualified driver per distinct slot
     start) — so an earlier position's general fill can never starve a later
     position of its required commanders/drivers (the קצין מוצב
     `candidate_pool` demand is reserved even earlier, in step 3);
     pass B then runs the soft fill per position — the התקפי
     **platoon-group fill** (each quota commander anchors a group of 3,
     preferably his own מחלקה), then the ranked fill by the priority list;
  9. **everyone-works absorb**: leftover available soldiers join מגן up to its
     flex max (12) before anyone is allowed to rest;
  10. residual bucketing: מנוחה (reported as a generation issue — every
      available soldier should work) or בבית (blocked all day).
- **Level 2**: fill concrete slots inside each position (hours, seats, night rotation
  within group by night_count, commander first-seat, then the H6d **driver
  seat** — the seat right after the commander seat is reserved for a
  qualified driver until the crew has one) honoring H/R/T rules. In positions
  with commander seats (סיור/התקפי) a regular seat prefers **non-commanders**,
  keeping the group's few commanders available for the remaining commander
  seats (soft — when only commanders fit, one is still taken). An **exit
  packing pre-pass** (H9/R7) runs before the general ranked fill: each exit
  soldier gets 1–2 non-overlapping shifts in his Level-1 position packed
  **outside his exit window**, up to the daily cap (normally 8h = two
  shifts), scored lexicographically — most hours, then fewest rest
  violations (a fully rest-legal pair beats a בדוחק one), then fewest short
  rests, then distinct sub-positions (P4b), then avoiding a night on a
  2-night streak, then earliest start. The winning pair may be fully
  back-to-back (R7 `exit_rest` בדוחק) — other soldiers' rest is never
  relaxed for it. Rationale `exit_packed` (+ `caveat_exit_rest` when
  relaxed); partial packing raises a generation issue. The general fill sees
  the pre-assigned seats as taken.
- **Chain ordering**: T4 rules whose source crew descended on a *previous* day
  (`source_day_offset < 0`) are applied **before** Level 2 — the standby row is
  reserved (H3/H3b) so the general fill can't book the whole descending crew
  during the window; same-day rules run after Level 2 (they need its fresh
  patrol/defense rows).
- Human can lock any row at either level; the generator schedules around locks; any
  forced violation is recorded on the row (`violations` jsonb) and surfaced.
- Multi-day: generate sequentially; each day sees previous drafts' counters.

## 8. Validation (post-generation & on manual edit)

Checks per day (parity with the Apps Script validator): rest gaps (R1: < 4h =
error, 4–8h = warning, incl. previous day;
R5-exempt starts — at/after 14:00 of the day following a `full_rest_after` daily
task — are not flagged; a תורנים→14:00 immediate start is), overlaps (incl.
`readiness_overlap` — a readiness row overlapping a mission row, H3 strict), double
standby (H3b), chained-duty sourcing (carmel/tracker crews match their source
shifts; an out-of-crew soldier covering a genuine shortfall of an
absent/booked crew is a completion **warning**, but is an **error** when an
available source member was left unused or the window was already fully
covered — T4 completion), carmel min staffing, ≤8h/day, assignment vs availability,
present-but-unassigned, **rest-bucket** (`rest_bucket`, warning: an available
soldier bucketed to מנוחה — everyone works), unknown soldier names,
consecutive nights (R6: 2 = warning,
3+ = error; `night_exempt` duties excluded), static streak (T3: 3rd static-only day
= warning), **on-call streak** (T6: 3rd consecutive static+readiness-only day =
warning `oncall_streak`), weekly תורנות repeats (T5: 2+ תורנות days within 7 days = warning
`second_toranut_week`), seat qualification (H6b `qual` mismatch = warning
`seat_qualification`), H6/H6-pool role gates (`role_gate`, errors: a
candidate-pool position manned outside its list — import rows excused;
non-senior on קצין מוצב when no pool is configured, senior commander on
עמדות הגנה, a commander seat held by a
non-commander, a commander-first-seat slot with no commander-seat row —
import-only coverage excused), **crew drivers** (H6d: a סיור/התקפי crew with
no qualified נהג דוד/נהג טיגריס = error `driver`; all-import crews excused),
R3 גשש effective rest (night windows only — see R3), **half-day exits**
(H9/R7 — `exit_window`, error: any row, mission or readiness, any source,
overlapping the soldier's exit window; `exit_daily`, error: the exit soldier
holding a daily/readiness row that day, judged by the shared shift-position
predicate; `exit_rest`, warning: a <4h gap attributable to the exit day —
either endpoint's schedule day carries an exit — replaces the `rest` error
for the exit soldier; the 4–8h warning path is unchanged). Slot coverage counts the **minimum concurrent**
assignment rows over each slot window, so a seat covered by an H1 replacement pair
(two rows splitting at the handover) is fully staffed, while a partially-covered
seat is flagged; for flex positions (`flex_seats` — מגן, סיור) coverage is
judged against the flex **minimum**, not the template seat count. Results snapshot stored on
`schedule_days.validation` (jsonb) — written automatically after every generation
(`persist`) and available via CLI `validate <day>`. The viewer endpoints
(`api/draft.ts`, `api/fairness.ts`) do NOT read the snapshot — they run
`validateDay` live per requested day, since manual edits make the stored
snapshot stale; the snapshot remains a generation-time record.

## 9. Database design

See `db/schema.sql` (full DDL) and `db/seed.sql` (current template seed).

Principles:
- **Small hand-managed source tables; derived data = views.** e.g. no stored presence
  matrix — sparse `unavailability` periods; no row ⇒ soldier available; the per-day
  presence matrix and all fairness counters are views.
- **Seat counts change over time via `seat_overrides`** (position, valid_from,
  seats-per-slot; latest wins) — resolved by the `day_slots` view, managed by hand.
- **Position behavior flags live in `positions.config` jsonb**: `daily`
  (sleeping 14:00–14:00 day duty — implies `night_exempt` + `full_rest_after`
  + `yomi_display`, each overridable by an explicit key; e.g. תורנים sets
  `full_rest_after: false`), `continuity`, `same_platoon` (מגן), `seat_rules`
  (H6b), `staff_all_roles` (חמל, מפלג), `flex_seats` (min/max — מגן 10–12,
  סיור 3–4; everyone-works sizing + coverage minimum), `driver_qual` (H6d —
  סיור → נהג דוד, התקפי → נהג טיגריס), `group_size` (התקפי 4 — commander
  groups), `candidate_pool` (H6-pool — קצין מוצב). Resolution happens once per
  read boundary
  (`effectiveConfig` in `src/config.ts`; mirrored by a `coalesce` in
  `soldier_fairness`).
- Facts (`shift_assignments`) and decisions (`day_assignments`, locks) are tables.
- Double-booking is impossible at the DB level: `EXCLUDE USING gist
  (soldier_id WITH =, period WITH &&) WHERE (blocks_overlap)` on `shift_assignments`
  (readiness rows set `blocks_overlap=false`, implementing H3's exception).
- T4 chain rules are rows in `chain_rules`, not code.
- **Half-day exit requests are their own table** — `exit_requests` (soldier,
  free-form `tsrange` period, requester audit fields; per-soldier overlap
  excluded at the DB level). A row IS the approval — requests are
  auto-approved on creation. Deliberately NOT part of `unavailability`: that
  table is truncated and rebuilt on every sheet re-import, while exit
  requests are DB-only and **survive re-imports**. The UI offers only
  shift-boundary times (§12); the DB period stays free-form.
- **Tunables in `config` (key → jsonb) — the honest list**, i.e. exactly what
  the code reads (`loadTunables` in `src/config.ts`): `rest_rules`
  (`minimum_hours` 4, `ideal_hours` 8, `long_task_hours` 4,
  `gashash_effective_hours` 1.5), `daily_cap_hours` (8),
  `readiness_hour_weight` (0.25, also read by `soldier_fairness` in SQL).
  One more config key is read directly (not a numeric tunable):
  `magen_commander` — the persisted weekly מגן-commander decision (a soldier
  name; §7 step 5).
  The 14:00 day anchor and the 00:00–06:00 night window are **hardcoded
  mirrors** in `src/time.ts` + `db/schema.sql` by design — changing them
  mid-deployment would silently reinterpret all stored data.

### Import (one-time, from the sheet)

- `מצבת החיילים` → `soldiers`; date-status matrix compressed into `unavailability`
  periods (consecutive non-נוכח runs → one row), with **bus-at-08:00**
  boundaries for whole-day home ranges (H1; boundaries created before
  2026-07-18 keep their historical 10:00).
- The **מפלג tab's סטטוס** (מגיע/לא מגיע) syncs to the soldier's schedulable
  flag (`is_schedulable`) — e.g. בנימין קיי (לא מגיע) is not schedulable;
  present מפלג staff appear daily in the מפלג position (§2).
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
  construction; validator check remains as a safety net). Since the 2026-07-18
  everyone-works rule it is a **residual exception**, not a planned outcome —
  an available soldier landing there is itself flagged (`rest_bucket`).
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
existing סיכום פלוגתי tab) and one soldier-facing tab added to the existing
React viewer:

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
  on-call streak (T6), availability, overlaps/double standby, chain sourcing +
  carmel staffing, seat rules, crew drivers (H6d), role gates incl. the
  קצין מוצב pool, position restrictions, slot coverage (vs flex minimum),
  present-but-unassigned + rest-bucket. Findings
  come from running the validator over each day of the window. Below: fairness
  cards — nights 7d and weighted-hours 7d spread (min/max/avg/stddev with
  top/bottom outlier names) and per-position balance from `position_counts`.
  Platoon filter applies to all cards.
- **יציאה קצרה** — soldier-facing half-day-exit tab (visible to every
  signed-in user, not officer-gated). A soldier requests a short exit for
  himself: date + exit/return times offered **only at shift boundaries**
  (14:00, 18:00, 22:00, 02:00, 06:00, 14:00-next-day; the stored period is
  free-form — §9), with a live summary of hours out / hours remaining.
  Guardrails (server-side, Hebrew messages mirrored in the client): requests
  only for days whose שבצ"ק was **not yet generated**; the exit must leave
  **≥ 8h available in each affected 14:00→14:00 cycle** — otherwise the
  answer is to request a vacation day; no overlap with an existing request or
  an unavailability period. Requests are auto-approved on creation and listed
  with a ביטול action. **Once a day's שבצ"ק exists, both creating and
  cancelling a request touching it are blocked** (409) — a late change goes
  through an officer, who deletes the request row and regenerates the day.
- **ניהול יציאות** — officer-only (shavtzak_admins-gated, like the draft tab)
  admin view over `exit_requests`: the draft tab's date-range picker, a table
  of every soldier's requests in the range, and add/edit/delete for any
  soldier. Admin times are **free-form** (not limited to shift boundaries —
  the DB period always was), the ≥8h-per-cycle rule still applies, and the
  generated-day freeze is **bypassed with a warning** instead of a block: the
  request is saved/removed and the UI flags that the affected day's שבצ"ק
  must be regenerated for it to take effect.

Data flows through three Vercel serverless endpoints (`api/draft.ts`,
`api/fairness.ts`, and `api/exit-requests.ts` — GET list / POST create /
PATCH edit / DELETE cancel over `exit_requests`; admin mutations are
parameter-gated, free-form-time variants of the same handlers)
reading the scheduler DB via `SCHEDULER_DATABASE_URL`; endpoints are open like the
existing sheet endpoints (no server-side auth) per current app security model.
