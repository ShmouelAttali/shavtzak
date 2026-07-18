// Candidate ranking: the SPEC §6.1 lexicographic priority list (P1 filtering
// happens in rest.ts fits(); P2-P6 keys live here) and the T1-T3 rotation
// penalty (P4).

import { Minutes } from './time.js';
import { Gen, SoldierState } from './state.js';
import { restBefore } from './rest.js';

/** P6 (most rest since last shift) is clamped at 48h: beyond two clear days
 *  everyone is equally "fully rested" — an unbounded value would let one long
 *  home stay dominate the final tie-break forever. NOT a DB tunable. */
export const P6_REST_CLAMP = 48 * 60;

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
  if (pos?.config?.continuity) return { penalty: yPos === positionId ? -2 : 0, tag: 'continuity' };
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

/** Priority-list comparator (SPEC §6.1) for position/slot selection.
 *  When ranking for a concrete slot, pass its start so candidates with a
 *  full 8h rest before it win over short-rest ones (keeps 4h shifts spaced
 *  8h apart: 06&18, 10&22, 14&02). Pass the slot's sub-position id as
 *  `forSub` so a soldier rotates between different posts within the same
 *  24h round (P4b). */
export function rank(g: Gen, candidates: SoldierState[], positionId: number,
                     forNight: boolean, atStart?: Minutes, forSub?: number | null): SoldierState[] {
  const restIdeal = g.ctx.tunables.restIdealH * 60;
  const dailyCap = g.ctx.tunables.dailyCapH;
  const pos = g.ctx.positions.get(positionId)!;
  const posName = pos.name;
  const cls = pos.missionClass;
  return [...candidates].sort((a, b) => {
    const ka = key(a), kb = key(b);
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i];
    return a.soldier.name.localeCompare(b.soldier.name, 'he');
  });
  function key(st: SoldierState): number[] {
    const restAt = restBefore(g, st, atStart ?? g.dRange[0]);
    const staticStreak = g.ctx.staticStreak.get(st.soldier.id) ?? 0;
    const onCallStreak = g.ctx.onCallStreak.get(st.soldier.id) ?? 0;
    return [
      atStart !== undefined && restAt < restIdeal ? 1 : 0,                   // R1 quasi-constraint
      // T5 (soft): at most one תורנות per rolling 7 days — anyone with a
      // recent תורנות sorts after everyone without one (never a hard block)
      posName === 'תורנים' && (g.ctx.toranutCount7d.get(st.soldier.id) ?? 0) > 0 ? 1 : 0,
      // T3 above P2 (owner decision): a constant static position is WORSE
      // than repeated nights — streak-breaking outranks night fairness.
      cls === 'static' && staticStreak >= 2 ? 1
        : cls === 'dynamic' && staticStreak >= 2 ? -1 : 0,                   // T3 (over P2)
      // T6 (soft, over P2 like T3): avoid a 3rd consecutive day of only
      // static + התקפי work — the soldier would be in constant on-call
      onCallStreak >= 2 && (cls === 'static' || cls === 'readiness') ? 1 : 0, // T6
      // P4b sub-position rotation (over P2 — owner: "make sure to split"):
      // within the same 24h round a soldier mans a DIFFERENT post each shift
      // (e.g. not שג twice today)
      forSub != null ? g.assignments.filter((a) => a.soldierId === st.soldier.id
        && a.subPositionId === forSub).length : 0,                           // P4b
      nightsOf(st, forNight),                                                // P2
      // P3 bucketed to one duty-day (dailyCapH hours): soldiers within the
      // same load bucket are equal, letting rotation (P4) actually decide.
      Math.floor(loadOf(st) / dailyCap),                                     // P3
      rotationPenalty(g, st, positionId).penalty,                            // P4
      st.fairness.positionCounts[posName] ?? 0,                              // P4 (L1 balance)
      // P5 role fit (after P4 — ties only): נהג טיגריס for the התקפי crew;
      // נהג דוד for a patrol slot overlapping the night window
      posName === 'התקפי' && !st.soldier.isTigerDriver ? 1 : 0,              // P5
      posName === 'סיור' && forNight && !st.soldier.isDudDriver ? 1 : 0,     // P5
      // P5 מ"כ spread: when ranking for a concrete static slot, a commander
      // is demoted if a commander already mans a static post at that hour
      // (the defense/carmel grids share start hours, so start == same hour)
      atStart !== undefined && pos.missionClass === 'static'
        && st.soldier.isCommander && staticCommanderAt(g, atStart) ? 1 : 0,  // P5
      loadOf(st),                                                            // P3 fine tie-break
      -Math.min(restAt, P6_REST_CLAMP),                                      // P6
    ];
  }
}
