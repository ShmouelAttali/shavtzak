// Per-day generation state: the SoldierState records, the mutable Gen bag
// threaded EXPLICITLY through the generator modules (level1/level2/chains/
// pairs/rank/rest — no cross-module closures), and the state-mutation
// primitive assign().

import { Context, Soldier, Fairness, Slot, Assignment } from './model.js';
import { RationaleEntry } from './rationale.js';
import { Minutes, dayStart, dayEnd, hours, overlaps, nightRange, nightRangeAt } from './time.js';
import { normalizeName as nrm } from './text.js';
import { isCountedNight } from './rest.js';

export const EMPTY_FAIRNESS: Fairness = {
  nightCount7d: 0, nightCountTotal: 0, missionHours7d: 0, weightedHours7d: 0,
  readinessHours7d: 0, trackerHoursTotal: 0, positionCounts: {},
};

export interface SoldierState {
  soldier: Soldier;
  fairness: Fairness;
  /** blocking intervals: existing (blocks) + newly assigned, non-readiness */
  intervals: [Minutes, Minutes][];
  /** readiness intervals (don't reset rest; H3-strict: may not overlap missions) */
  readiness: [Minutes, Minutes][];
  missionHoursToday: number;
  nightsToday: number;
  trackerMinutes: number;
  /** R3: effective work ends of כונן גשש NIGHT windows (window start +
   *  gashash_effective_hours) — participate in the rest-gap search even
   *  though readiness is otherwise rest-transparent */
  gashashNightEnds: Minutes[];
  level1: number | null;      // position id
  /** why this soldier landed in their Level-1 group (continuity/commander quota) */
  level1Rationale: RationaleEntry[];
}

/** Mutable per-day generation bag. Built once by buildGen(), passed to every
 *  generator module as the explicit first parameter. */
export interface Gen {
  ctx: Context;
  day: string;
  dRange: [Minutes, Minutes];
  /** tonight's 00:00–06:00 window */
  night: [Minutes, Minutes];
  state: Map<number, SoldierState>;
  assignments: Assignment[];
  level1: Map<number, number>;      // soldier id -> position id
  issues: string[];
  /** H6b seat-rule reservation: soldier id -> position name */
  seatRestrict: Map<number, string>;
  /** staff_all_roles derivation (derived H6c): soldier id -> position name */
  roleRestrict: Map<number, string>;
}

/** Hours a slot contributes to the daily cap: daily missions count as one duty-day (R4). */
export const countedHours = (g: Gen, p: [Minutes, Minutes]): number =>
  Math.min(hours(p), g.ctx.tunables.dailyCapH);

export const isBlocked = (g: Gen, sid: number, p: [Minutes, Minutes]): boolean =>
  (g.ctx.blocked.get(sid) ?? []).some((b) => overlaps(b, p));

export const fullyBlocked = (g: Gen, sid: number): boolean => isBlocked(g, sid, g.dRange) &&
  (g.ctx.blocked.get(sid) ?? []).some((b) => b[0] <= g.dRange[0] && b[1] >= g.dRange[1]);

/** One position-whitelist mechanism for all three restriction sources:
 *  H6c allowed_positions (DB column, per-soldier cases like אריאל ביר),
 *  H6b seat-rule reservation (candidates of a seat-rule position serve only
 *  there; a release rule removes its unchosen candidates again), and the
 *  staff_all_roles derivation (role חמל → position חמל only). */
export const allowedIn = (g: Gen, s: Soldier, posName: string): boolean => {
  const reserved = g.seatRestrict.get(s.id);
  if (reserved !== undefined && nrm(reserved) !== nrm(posName)) return false;
  const roleHome = g.roleRestrict.get(s.id);
  if (roleHome !== undefined && nrm(roleHome) !== nrm(posName)) return false;
  return !s.allowedPositions || s.allowedPositions.some((p) => nrm(p) === nrm(posName));
};

/** R3: effective end of a גשש night window = start + gashash_effective_hours */
export const gashashEffEnd = (g: Gen, period: [Minutes, Minutes]): Minutes =>
  period[0] + g.ctx.tunables.gashashEffectiveHours * 60;

export const isGashashNight = (g: Gen, a: { positionId: number; period: [Minutes, Minutes] }): boolean =>
  a.positionId === g.ctx.positionByName.get('כונן גשש')
  && overlaps(a.period, nightRangeAt(a.period[0]));

export function buildGen(ctx: Context): Gen {
  const g: Gen = {
    ctx, day: ctx.day,
    dRange: [dayStart(ctx.day), dayEnd(ctx.day)],
    night: nightRange(ctx.day),
    state: new Map(),
    assignments: [],
    level1: new Map(),
    issues: [],
    seatRestrict: new Map(),
    roleRestrict: new Map(),
  };
  for (const s of ctx.soldiers.values()) {
    const ex = ctx.existing.get(s.id) ?? [];
    g.state.set(s.id, {
      soldier: s,
      fairness: ctx.fairness.get(s.id) ?? EMPTY_FAIRNESS,
      intervals: ex.filter((a) => a.missionClass !== 'readiness').map((a) => a.period),
      readiness: ex.filter((a) => a.missionClass === 'readiness').map((a) => a.period),
      // R4 accounting: an assignment's counted hours belong to the schedule
      // day containing its START. All daily duties are 14:00–14:00 now (SPEC
      // §2) so nothing crosses the boundary; start-anchoring is still the
      // right rule for imported history rows that did.
      missionHoursToday: ex
        .filter((a) => a.missionClass !== 'readiness'
          && a.period[0] >= g.dRange[0] && a.period[0] < g.dRange[1])
        .reduce((h, a) => h + countedHours(g, a.period), 0),
      nightsToday: 0,
      trackerMinutes: 0,
      gashashNightEnds: ex.filter((a) => isGashashNight(g, a)).map((a) => gashashEffEnd(g, a.period)),
      level1: null,
      level1Rationale: [],
    });
  }
  // staff_all_roles derivation (חמל): a soldier whose role matches a
  // staff_all_roles position may serve ONLY there — the implicit equivalent
  // of an explicit allowed_positions=[position] row.
  for (const pos of ctx.positions.values()) {
    const roles: string[] = pos.config?.staff_all_roles ?? [];
    if (!roles.length) continue;
    for (const st of g.state.values()) {
      if (roles.some((r) => nrm(r) === nrm(st.soldier.role))) g.roleRestrict.set(st.soldier.id, pos.name);
    }
  }
  return g;
}

/** Record an assignment and update the soldier's live state (intervals /
 *  readiness, daily counted hours, P2 fresh-night counter). */
export function assign(g: Gen, st: SoldierState, slot: Slot, seat: number, commanderSeat: boolean,
                       viol: string[], source: 'auto' | 'chain' = 'auto',
                       rationale: RationaleEntry[] = []): void {
  const readiness = g.ctx.positions.get(slot.positionId)!.missionClass === 'readiness';
  g.assignments.push({
    soldierId: st.soldier.id, positionId: slot.positionId, subPositionId: slot.subPositionId,
    period: slot.period, seatIndex: seat, isCommanderSeat: commanderSeat,
    blocksOverlap: !readiness, source, violations: viol, rationale,
  });
  if (readiness) {
    st.readiness.push(slot.period);
  } else {
    st.intervals.push(slot.period);
    st.missionHoursToday += countedHours(g, slot.period);
    // night_exempt 24h duties (תורנים/קצין מוצב) span 00-06 but the soldier
    // sleeps — they don't count toward P2 night fairness
    const pos = g.ctx.positions.get(slot.positionId);
    if (overlaps(slot.period, g.night)
      && isCountedNight(pos?.missionClass ?? '', pos?.config?.night_exempt)) st.nightsToday++;
  }
}
