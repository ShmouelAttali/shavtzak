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
| Position (עמדה) | Top-level Level-1 unit: סיור, עמדות הגנה (merged שג+בונקר+מזרחית+דרומית), מגן, התקפי, חפק, תורנים, קצין מוצב, מנוחה (explicit rest bucket). תגבצ is staffed by the התקפי crew; כרמל חטיבה + כונן גשש are chained overlays; חמל excluded (config) |
| Slot | Concrete (position, sub-position, time-range, seat#) needing one soldier. Level-2 unit |
| Mission class | `static` (עמדות הגנה, תורן) / `dynamic` (סיור, תגבצ) / `readiness` (התקפי, כרמל, כונן גשש) — drives rotation + rest-transparency |
| Chained duty | Duty auto-staffed by the crew descending from a source shift (rule T4): כרמל חטיבה, כונן גשש |

## 2. Position/slot catalog (current template)

Template is **data, not code** — versioned in DB (`slot_templates.valid_from/valid_to`).
History shows 39 distinct position names over 20 days; templates change mid-deployment.

| Position | Slots × times | Duration |
|---|---|---|
| סיור | 4 seats × 06:00, 14:00, 22:00 | 8h |
| עמדות הגנה (שג/בונקר/מזרחית/דרומית) | 4 posts × 06,10,14,18,22,02 | 4h |
| מגן | 10 seats, 06:00–22:00 | daily; **continuity crew, one מחלקה** (kept day-to-day unless seat count or a manual change intervenes) |
| התקפי | 8 seats | **14:00–14:00** standing readiness crew; also **staffs the תגבצ windows** and executes ad-hoc attack missions |
| תגבצ | 8 × 06:30–09:00, 8 × 17:00–22:00 | staffed by the התקפי crew (`staffed_by`) — no own Level-1 crew |
| חפק | 4 named seats (מפקד/קשר/חובש/נהג), 06:00–22:00 | daily; **dedicated candidates per seat — see H6b** |
| תורנים | 2 seats, 07:30–22:00 | daily |
| כונן גשש | chained to סיור — see T4c | windows: 22–07, 07–14, 14–22 |
| קצין מוצב | 1 seat, 06:00–22:00 | blocks whole day |
| כרמל חטיבה / מפקד כרמל חטיבה | 3+1 × 06,10,14,18, 22:00–06:00 | 4h (last shift 8h) |

Ad-hoc attack missions (פטרול, תגבצ+פטרול, צ'קפוסט…) are executed by the התקפי
crew and recorded manually as extra rows when they happen (H3/H5).

**Boundary rule for daily missions**: a 06:00–22:00 mission starts inside schedule day
D (which began the previous calendar day at 14:00) and ends inside day D+1. The
assignment **belongs to the schedule day containing its start** (D), and all its hours
are accounted to D (daily cap, fairness). For day D+1 the soldier is treated as
occupied until 22:00 (rest/overlap checks see the real interval), and gets no second
Level-1 position on D+1 unless enough of the day remains — by default the generator
assigns them מנוחה on D+1.

## 3. Hard constraints (H — never violated)

- **H1 Availability**: soldier with an active unavailability period (חופש, לא מגויס, short exits) can't be assigned during it. Partial-day periods (יציאה בערב, חזרה ב14:00) block only their window.
- **H2 Excluded pools**: מפלג / חמ"ל members not scheduled (flag on soldier).
- **H3 No overlap**: no two time-overlapping assignments per soldier. Exception: readiness ↔ attack/תגבצ (the התקפי crew executes those during its readiness day). Enforced at the DB level for mission rows (`no_double_booking` EXCLUDE constraint), in the generator, and by the validator.
- **H3b No double standby**: a soldier cannot hold two overlapping readiness duties (e.g. התקפי and כרמל חטיבה simultaneously) — readiness rows don't block at the DB level, so this is enforced by the generator's chain pool and the validator (`double_readiness`).
- **H4 One position per schedule day**: exactly one Level-1 position (or מנוחה) per soldier per 14:00–14:00 day.
- **H5 Full-day blockers**: קצין מוצב and "יומי" tasks block the soldier for the rest of the schedule day. התקפי (14:00–14:00 readiness) blocks regular missions all day; its own תגבצ windows and attack missions are exempt.
- **H6 Role gates**: קצין מוצב → סמל/מ"מ only. First seat of סיור/תגבצ/התקפי crew → commander. מ"מ/סמל never on עמדות הגנה.
- **H6b Named-seat positions** (`seat_rules` on the position config; currently חפק):
  each sub-position seat is filled only from its dedicated candidate list, in
  priority order —
  מפקד: role מ"פ, else סמ"פ; קשר: יהודה חושן → אור חיים בלונדר → יחיעם אושפיזאי
  (ordered); חובש: כפיר לנדסמן / שחר מיכאלי; נהג: אמיר יונייב / יאיר מובשוביץ
  (unordered pairs rotate by fairness P2-P6).
  **No substitutes**: if no candidate is available the seat stays EMPTY and an
  issue + validation warning is raised (never completed from מנוחה or בדוחק).
  **Exclusivity**: candidates (incl. role matches מ"פ/סמ"פ) serve ONLY in their
  seat-rule position — the generator reserves them and the validator errors on
  any other assignment. Exception (`release_unpicked`, the קשר rule): once the
  seat is covered, the unchosen candidates return to the general pool for that
  day. Unchosen candidates of non-release rules go to מנוחה.
- **H7 Crew integrity**: no duplicate soldier in a crew/slot. (The former
  מגן+תגבצ package rule is obsolete: תגבצ is staffed by the התקפי crew, and מגן
  is a standalone continuity crew.)
- **H7b Attack blocks the day**: a soldier on an התקפי mission takes no other regular
  mission that schedule day (and vice versa); only readiness may coexist (H3).
- **H8 Rest floor**: < 4h rest before task → blocked (allowed only as flagged "בדוחק" fallback needing human approval).

## 4. Rest rules (R)

- **R1** — two regimes, both configurable:
  - *Generation* (candidate filtering): < 4h rest → blocked (H8, fallback-only);
    4–8h rest → allowed with warning for tasks ≤ 4h, fallback-only for tasks > 4h.
  - *Validation* (post-hoc): any gap < 8h between timed shifts (incl. vs previous day)
    is reported as an error — the generator should normally never produce one.
- **R2**: readiness (התקפי/כרמל/כונן גשש) is **rest-transparent** (assumed sleeping) and its hours are counted separately from mission hours.
- **R3 כונן גשש**: the demanding part is the morning departure (~05:30–07:00); rest check for the night window uses effective duration ~1.5h; prefer soldiers who slept the night.
- **R4 Daily cap**: ≤ 8 mission-hours per schedule day (readiness hours excluded). >8h = error; available soldier with 0 missions and not in מנוחה bucket = warning.
- **R5 Post-attack rest**: an התקפי mission ends by 06:00, and the window 06:00–14:00
  after it counts as a full 8h rest. A soldier coming off an attack mission is
  therefore eligible for assignments starting at 14:00 of the new schedule day
  (attack-blocks-day, H7b, applies only to the attack's own schedule day).

## 5. Rotation rules (T)

- **T1**: avoid same exact position on consecutive days.
- **T2**: avoid same mission class on consecutive days; alternating static/dynamic preferred.
- **T3**: 2+ consecutive static-only days → must break with a dynamic day (strong).
- **T4 Chained duties** — deterministic staffing; the crew that just descended covers the standby:
  - **T4a כרמל חטיבה**: carmel shift starting at hour H = the 4 soldiers who finished עמדות הגנה at H (defense 06–10 → carmel 10–14, …, 18–22 → 22–06; previous day 02–06 → carmel 06–10). Commander seat = highest רובאי among them. Min staffing 3 regular + 1 commander (validated).
  - **T4b כוננות התקפית** — *retired*: the התקפי position is a standing Level-1
    crew (8 soldiers, 14:00–14:00) rather than patrol-chained windows; it covers
    readiness, the תגבצ windows, and ad-hoc attack missions.
  - **T4c כונן גשש**: tied to סיור descents, **one soldier per descending patrol crew**:
    - סיור ירד ב-22:00 → כונן גשש 22:00–07:00
    - סיור ירד ב-06:00 → כונן גשש 07:00–14:00
    - סיור ירד ב-14:00 → כונן גשש 14:00–22:00
    - Selection within the crew: minimize + equalize cumulative tracker hours (pick crew member with lowest `tracker_hours_total`; ties broken by fairness order). Tracker time counts as readiness hours.

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

Checks per day (parity with the Apps Script validator): rest ≥8h incl. previous day,
overlaps, double standby (H3b), chained-duty sourcing (carmel/tracker crews match
their source shifts), carmel min staffing, ≤8h/day, assignment vs availability,
present-but-unassigned, unknown soldier names. Results snapshot stored on
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
  `same_platoon` (מגן), `staffed_by` (תגבצ ← התקפי), `open_for_attack`.
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

- **Daily missions vs 14:00 anchor**: 06:00–22:00 missions straddle the day boundary
  (see §2 boundary rule). Alternative worth considering: re-anchor daily missions to
  14:00–14:00 windows so they nest cleanly inside one schedule day. Current default:
  keep 06:00–22:00 and account hours to the starting day.
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
- **הוגנות** — weekly fairness. Date picker selects the rolling-7-day window end;
  table per soldier: nights 7d, weighted hours 7d, mission/readiness hours 7d,
  deployment totals (nights, tracker hours), common positions. Sortable columns,
  platoon filter, spread indicator cards (min/max/avg/stddev) with outlier
  color-coding (above avg+σ / below avg−σ).

Data flows through two Vercel serverless endpoints (`api/draft.ts`, `api/fairness.ts`)
reading the scheduler DB via `SCHEDULER_DATABASE_URL`; endpoints are open like the
existing sheet endpoints (no server-side auth) per current app security model.
