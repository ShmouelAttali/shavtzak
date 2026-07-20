// Candidate ranking: the SPEC §6.1 lexicographic priority list (P1 filtering
// happens in rest.ts fits(); P2-P6 keys live here) and the T1-T3 rotation
// penalty (P4).
//
// TWO cascades live here (owner decision 2026-07-19):
// - rank()      — the SLOT cascade (Level 2 + chains/pairs): which concrete
//   shift inside a position group. Knows about nights (P2), sub-position
//   rotation (P4b) and the מ"כ-spread key, because those facts only exist
//   once a concrete slot/hour is on the table.
// - rankGroup() — the GROUP cascade (Level 1): which position group a soldier
//   joins today. Nights are irrelevant here (every group may or may not
//   produce nights for him) and sub-positions don't exist yet, so those keys
//   are dropped; everything else keeps the slot cascade's order.

import { Minutes, isSunday } from './time.js';
import { Gen, SoldierState } from './state.js';
import { restBefore } from './rest.js';
import { isOnCall } from './config.js';
import { RationaleEntry } from './rationale.js';

/** P6 (most rest since last shift) is clamped at 48h: beyond two clear days
 *  everyone is equally "fully rested" — an unbounded value would let one long
 *  home stay dominate the final tie-break forever. NOT a DB tunable. */
export const P6_REST_CLAMP = 48 * 60;

/** Pure-tie order is RANDOM (owner 2026-07-19: with week-scoped fairness a
 *  Sunday is mostly ties — they must not resolve alphabetically). Seeded by
 *  (day, soldier id) via FNV-1a so regenerating the SAME day reproduces the
 *  same draft, while every new day shuffles differently. */
export function tieJitter(day: string, sid: number): number {
  const s = `${day}|${sid}`;
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// ── fairness keys ───────────────────────────────────────────────────────────
// One formula each for the P2/P3 keys — used by rank()'s priority tuple AND by
// the Level-2 rationale snapshot, so the "why picked" claims can't drift from
// what the ranking actually compared.

/** P2: nights in the rolling window; today's fresh nights count when ranking a night slot. */
export const nightsOf = (st: SoldierState, forNight: boolean): number =>
  st.fairness.nightCount7d + (forNight ? st.nightsToday : 0);

/** P3: weighted mission hours incl. today's fresh assignments. */
export const loadOf = (st: SoldierState): number =>
  st.fairness.weightedHours7d + st.missionHoursToday;

/** Rotation penalty per T1-T3 (lower = better). Continuity positions
 *  (e.g. מגן) invert T1: staying in the same position is preferred.
 *  Returns the dominant T-rule as a tag so level2's buildRationale can report
 *  the same cascade without re-deriving it. */
export type RotationTag = 'continuity' | 'static_streak' | 'same_position' | 'same_class' | 'break_static' | null;
export function rotationPenalty(g: Gen, st: SoldierState, positionId: number): { penalty: number; tag: RotationTag } {
  const pos = g.ctx.positions.get(positionId);
  const cls = pos?.missionClass;
  const yPos = g.ctx.yesterdayPosition.get(st.soldier.id);
  const yCls = yPos !== undefined ? g.ctx.positions.get(yPos)?.missionClass : undefined;
  const streak = g.ctx.staticStreak.get(st.soldier.id) ?? 0;
  // Continuity resets at the weekly boundary (owner 2026-07-19): on a Sunday
  // the crew is rebuilt around the weekly מגן commander — no stay-bonus.
  if (pos?.config?.continuity) {
    return { penalty: yPos === positionId && !isSunday(g.day) ? -2 : 0, tag: 'continuity' };
  }
  // Dedicated-seat (seat_rules) and role crews (staff_all_roles) are locked to
  // the same people by design — repeating there is never a rotation fact:
  // no T1/T2 penalty and no "same as yesterday" caveat (like continuity, but
  // with no stay-bonus so seat pairs still rotate purely by fairness).
  if (pos?.config?.seat_rules || pos?.config?.staff_all_roles) return { penalty: 0, tag: 'continuity' };
  if (streak >= 2 && cls === 'static') return { penalty: 3, tag: 'static_streak' };   // T3 violation
  if (yPos === positionId) return { penalty: 2, tag: 'same_position' };               // T1
  if (yCls && cls && yCls === cls && cls !== 'other') return { penalty: 1, tag: 'same_class' }; // T2
  if (streak >= 2 && cls === 'dynamic') return { penalty: -1, tag: 'break_static' };  // T3 break bonus
  return { penalty: 0, tag: null };
}

/** P5 מ"כ spread: is a commander already assigned to a static post starting at `start`? */
function staticCommanderAt(g: Gen, start: Minutes): boolean {
  return g.assignments.some((a) => a.period[0] === start
    && g.ctx.positions.get(a.positionId)?.missionClass === 'static'
    && g.state.get(a.soldierId)?.soldier.isCommander);
}

/** Priority-list comparator (SPEC §6.1) for slot selection.
 *  When ranking for a concrete slot, pass its start so candidates with a
 *  full 8h rest before it win over short-rest ones (keeps 4h shifts spaced
 *  8h apart: 06&18, 10&22, 14&02). Pass the slot's sub-position id as
 *  `forSub` so a soldier rotates between different posts within the same
 *  24h round (P4b).
 *
 *  Two key sets: within-group slot choice (default) uses only slot-level
 *  keys — the day-level facts (streaks, rotation, balance, T5) were already
 *  decided when the soldier joined the group. `recruiting: true` — for the
 *  paths that pick a soldier whose DAY is not yet settled (pull-from-מנוחה,
 *  chain completions, replacement-pair halves) — adds the day-level keys of
 *  the group cascade back in. */
export function rank(g: Gen, candidates: SoldierState[], positionId: number,
                     forNight: boolean, atStart?: Minutes, forSub?: number | null,
                     recruiting = false): SoldierState[] {
  const restIdeal = g.ctx.tunables.restIdealH * 60;
  const dailyCap = g.ctx.tunables.dailyCapH;
  const pos = g.ctx.positions.get(positionId)!;
  const posName = pos.name;
  const cls = pos.missionClass;
  return [...candidates].sort((a, b) => {
    const ka = key(a), kb = key(b);
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i];
    return tieJitter(g.day, a.soldier.id) - tieJitter(g.day, b.soldier.id)
      || a.soldier.name.localeCompare(b.soldier.name, 'he');
  });
  function key(st: SoldierState): number[] {
    const restAt = restBefore(g, st, atStart ?? g.dRange[0]);
    const staticStreak = g.ctx.staticStreak.get(st.soldier.id) ?? 0;
    const onCallStreak = g.ctx.onCallStreak.get(st.soldier.id) ?? 0;
    const dayKeys = !recruiting ? [] : [
      // T5: at most one תורנות per rolling 7 days
      posName === 'תורנים' && (g.ctx.toranutCount7d.get(st.soldier.id) ?? 0) > 0 ? 1 : 0,
      // T3 above P2 (owner decision): a constant static position is WORSE
      // than repeated nights — streak-breaking outranks night fairness.
      cls === 'static' && staticStreak >= 2 ? 1
        : cls === 'dynamic' && staticStreak >= 2 ? -1 : 0,
      // T6: avoid a 3rd consecutive day of only static + on-call work
      onCallStreak >= 2 && isOnCall(pos) ? 1 : 0,
      rotationPenalty(g, st, positionId).penalty,                            // P4
      st.fairness.positionCounts[posName] ?? 0,                              // P4 balance
    ];
    return [
      atStart !== undefined && restAt < restIdeal ? 1 : 0,                   // R1 quasi-constraint
      ...dayKeys,
      // P4b sub-position rotation: within the same 24h round a soldier mans
      // a DIFFERENT post each shift (e.g. not שג twice today)
      forSub != null ? g.assignments.filter((a) => a.soldierId === st.soldier.id
        && a.subPositionId === forSub).length : 0,                           // P4b
      nightsOf(st, forNight),                                                // P2
      // P3 bucketed to one duty-day (dailyCapH hours)
      Math.floor(loadOf(st) / dailyCap),                                     // P3
      // P5 role fit: נהג טיגריס for the התקפי crew; נהג דוד for a patrol
      // slot overlapping the night window
      posName === 'התקפי' && !st.soldier.isTigerDriver ? 1 : 0,              // P5
      posName === 'סיור' && forNight && !st.soldier.isDudDriver ? 1 : 0,     // P5
      // P5 מ"כ spread: a commander is demoted for a static slot when a
      // commander already mans a static post starting at the same hour
      atStart !== undefined && pos.missionClass === 'static'
        && st.soldier.isCommander && staticCommanderAt(g, atStart) ? 1 : 0,  // P5
      loadOf(st),                                                            // P3 fine tie-break
      -Math.min(restAt, P6_REST_CLAMP),                                      // P6
    ];
  }
}

// ── Level-1 group cascade ───────────────────────────────────────────────────

/** The Level-1 group-selection key vector. Deliberately small: nights (P2),
 *  sub-post rotation (P4b), role fit / מ"כ spread (P5), load (P3) and
 *  accumulated rest (P6) are Level-2 slot considerations only — positions
 *  are not lighter or heavier than each other (owner). Exported (not inlined
 *  in rankGroup) so decisiveEntry compares the EXACT vectors the ranking
 *  sorted by — the rationale can't drift from the decision. */
export function groupKey(g: Gen, st: SoldierState, positionId: number, atStart?: Minutes): number[] {
  const restIdeal = g.ctx.tunables.restIdealH * 60;
  const pos = g.ctx.positions.get(positionId)!;
  const posName = pos.name;
  const cls = pos.missionClass;
  const staticStreak = g.ctx.staticStreak.get(st.soldier.id) ?? 0;
  const onCallStreak = g.ctx.onCallStreak.get(st.soldier.id) ?? 0;
  return [
    // R1 quasi-constraint — only where the position itself requires rest
    // before its single known start: a daily duty WITHOUT no_rest_floor (in
    // practice תורנים). no_rest_floor crews are scheduled internally by
    // their officer; multi-start positions (atStart undefined — see posCtx)
    // get their per-shift rest check in the Level-2 slot cascade.
    atStart !== undefined && !pos.config?.no_rest_floor
      && restBefore(g, st, atStart) < restIdeal ? 1 : 0,
    // T5 (soft): at most one תורנות per rolling 7 days
    posName === 'תורנים' && (g.ctx.toranutCount7d.get(st.soldier.id) ?? 0) > 0 ? 1 : 0,
    // T3 above P2 (owner decision): constant static is worse than nights
    cls === 'static' && staticStreak >= 2 ? 1
      : cls === 'dynamic' && staticStreak >= 2 ? -1 : 0,                     // T3
    onCallStreak >= 2 && isOnCall(pos) ? 1 : 0,                                // T6
    rotationPenalty(g, st, positionId).penalty,                              // P4
    st.fairness.positionCounts[posName] ?? 0,                                // P4 (L1 balance)
  ];
}

/** Group-selection comparator (Level 1): sort by groupKey lexicographically,
 *  Hebrew name as the final deterministic tie-break (same as rank()). */
export function rankGroup(g: Gen, candidates: SoldierState[], positionId: number,
                          atStart?: Minutes): SoldierState[] {
  return [...candidates].sort((a, b) => {
    const ka = groupKey(g, a, positionId, atStart), kb = groupKey(g, b, positionId, atStart);
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i];
    return tieJitter(g.day, a.soldier.id) - tieJitter(g.day, b.soldier.id)
      || a.soldier.name.localeCompare(b.soldier.name, 'he');
  });
}

// Per-index Hebrew presentation of the groupKey vector, used by decisiveEntry
// to name the DECISIVE key — the first index on which the pick actually beat
// the runner-up (instead of a first-satisfied-median claim).
const GROUP_DIMS: { dim: string; fmt: (v: number, st: SoldierState) => string }[] = [
  { dim: 'מנוחה לפני תחילת המשימה', fmt: (v) => (v === 1 ? 'מנוחה קצרה' : 'מנוחה מלאה') },
  { dim: 'תורנות השבוע', fmt: (v) => (v === 1 ? 'עשה תורנות' : 'ללא תורנות') },
  { dim: 'רצף ימים סטטיים', fmt: (v) => (v === 1 ? 'ממשיך רצף סטטי' : v === -1 ? 'שובר רצף סטטי' : 'ללא רצף') },
  { dim: 'רצף כוננות', fmt: (v) => (v === 1 ? 'יום כוננות שלישי' : 'ללא רצף כוננות') },
  { dim: 'רוטציה מאתמול', fmt: (v) => (
      v === -2 ? 'ממשיך בצוות'
      : v === -1 ? 'שובר רצף סטטי'
      : v === 0 ? 'החלפת עמדה'
      : v === 1 ? 'אותו סוג משימה כאתמול'
      : v === 2 ? 'אותה עמדה כאתמול'
      : 'רצף סטטי') },
  { dim: 'איזון עמדות', fmt: (v) => `${v} פעמים בעמדה` },
];

/** Why did the Level-1 group pick take THIS soldier: the first groupKey index
 *  on which he beat the runner-up (the next not-yet-assigned candidate in
 *  ranked order). No runner-up, or a full tie, falls back to the generic
 *  priority-cascade entry. */
export function decisiveEntry(g: Gen, st: SoldierState, runner: SoldierState | undefined,
                              positionId: number, atStart?: Minutes): RationaleEntry {
  if (!runner) return { code: 'fairness_pick' };
  const mine = groupKey(g, st, positionId, atStart);
  const next = groupKey(g, runner, positionId, atStart);
  const i = mine.findIndex((v, idx) => v !== next[idx]);
  if (i < 0) return { code: 'fairness_pick' };
  const { dim, fmt } = GROUP_DIMS[i];
  return {
    code: 'decisive_key',
    // the dim carries its cascade item number (owner request) — it must match
    // the numbered סדר העדיפויות list the report renders (report.ts CASCADE,
    // kept in the exact groupKey order)
    params: { dim: `${i + 1} — ${dim}`, mine: fmt(mine[i], st), next: fmt(next[i], runner) },
  };
}
