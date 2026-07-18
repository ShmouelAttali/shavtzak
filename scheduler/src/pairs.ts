// H1 replacement pairs: mid-slot handover between a departing and an arriving
// soldier (SPEC H1). partialWindow() classifies availability shapes; the
// Level-2 completion search lives here too (level1's H6b in-list variant does
// its own plan-time search over the seat's dedicated list).

import { Minutes, overlaps, fmtHM } from './time.js';
import { Slot } from './model.js';
import { RationaleEntry } from './rationale.js';
import { Gen, SoldierState, allowedIn, assign } from './state.js';
import { fits, FitReason } from './rest.js';
import { rank } from './rank.js';

/** Classify a soldier's availability shape inside `p` given his blocked
 *  windows. 'departing' = available [p0, at) and then out through the slot
 *  end; 'arriving' = out from the slot start, available [at, p1).
 *  Anything else (fully available, a gap in the middle, fully out) → null. */
export function partialWindow(blocks: [Minutes, Minutes][], p: [Minutes, Minutes]):
    { kind: 'departing' | 'arriving'; at: Minutes } | null {
  const clipped = blocks
    .filter((b) => overlaps(b, p))
    .map((b) => [Math.max(b[0], p[0]), Math.min(b[1], p[1])] as [Minutes, Minutes])
    .sort((x, y) => x[0] - y[0]);
  const merged: [Minutes, Minutes][] = [];
  for (const b of clipped) {
    const last = merged[merged.length - 1];
    if (last && b[0] <= last[1]) last[1] = Math.max(last[1], b[1]);
    else merged.push([b[0], b[1]]);
  }
  if (merged.length !== 1) return null;
  const [b0, b1] = merged[0];
  if (b0 > p[0] && b1 >= p[1]) return { kind: 'departing', at: b0 };
  if (b0 <= p[0] && b1 < p[1]) return { kind: 'arriving', at: b1 };
  return null;
}

/**
 * Level-2 H1 replacement pair: a departing soldier (available from the slot
 * start until his unavailability begins) and an arriving one (available once
 * his unavailability ends) split the seat at the handover — the departing
 * soldier's leave time (bus-at-08:00 semantics: both blocks meet at 08:00).
 * Completion mechanism only, like the pull-from-מנוחה path: runs when no
 * single fully-available candidate exists, and both halves must pass every
 * other hard rule cleanly (rest floor, daily cap, role gates, whitelists — no
 * בדוחק halves). Seat-rule / staff_all_roles positions and chained overlays
 * never reach this path, so pairs don't apply there. Daily readiness rows
 * (התקפי / קצין מוצב-style 24h duties) and required-driver seats DO reach it
 * (mass-exchange days: the departing soldier holds the row until the bus, the
 * arriving one takes it from there — H6d holds when both halves are drivers).
 *
 * Returns true when the seat was covered (both halves assigned).
 */
export function tryReplacementPair(g: Gen, opts: {
  slot: Slot; seat: number; pid: number; posName: string;
  commanderSeat: boolean; forNight: boolean; slotNightExempt: boolean;
  slotReadiness: boolean; slotDaily: boolean;
  /** H6d driver seat: both halves must hold the required qualification */
  isDriverSeat?: (st: SoldierState) => boolean;
  takenThisSlot: Set<number>;
  group: SoldierState[];
  restId: number;
  /** rationale for one half, built by level2's buildRationale */
  buildHalf: (st: SoldierState, half: Slot, fitReasons: FitReason[]) => RationaleEntry[];
}): boolean {
  const { slot, seat, pid, posName, commanderSeat, forNight, slotNightExempt, slotReadiness, slotDaily } = opts;
  const pool = [...g.state.values()].filter((st) =>
    !opts.takenThisSlot.has(st.soldier.id)
    && (st.level1 === pid || st.level1 === opts.restId)
    && allowedIn(g, st.soldier, posName)
    && (!commanderSeat || st.soldier.isCommander)
    && (!opts.isDriverSeat || opts.isDriverSeat(st)));
  const dep = new Map<SoldierState, Minutes>();
  const arr = new Map<SoldierState, Minutes>();
  for (const st of pool) {
    const w = partialWindow(g.ctx.blocked.get(st.soldier.id) ?? [], slot.period);
    if (w?.kind === 'departing') dep.set(st, w.at);
    else if (w?.kind === 'arriving') arr.set(st, w.at);
  }
  for (const d of rank(g, [...dep.keys()], pid, forNight, slot.period[0])) {
    const handover = dep.get(d)!;
    const firstHalf: [Minutes, Minutes] = [slot.period[0], handover];
    const fd = fits(g, d, firstHalf, commanderSeat, slotReadiness, slotNightExempt, slotDaily);
    if (!fd.ok || fd.fallback) continue;
    const back = [...arr.keys()].filter((st) => arr.get(st)! <= handover);
    for (const a of rank(g, back, pid, forNight, handover)) {
      const secondHalf: [Minutes, Minutes] = [handover, slot.period[1]];
      const fa = fits(g, a, secondHalf, commanderSeat, slotReadiness, slotNightExempt, slotDaily);
      if (!fa.ok || fa.fallback) continue;
      for (const st of [d, a]) {
        if (st.level1 !== pid) {
          st.level1 = pid; g.level1.set(st.soldier.id, pid); opts.group.push(st);
        }
        opts.takenThisSlot.add(st.soldier.id);
      }
      const note = `זוג מתחלף: החלפה ב-${fmtHM(handover)}`;
      assign(g, d, { ...slot, period: firstHalf }, seat, commanderSeat, [note], 'auto',
        [...opts.buildHalf(d, { ...slot, period: firstHalf }, fd.reasons),
         { code: 'handover_out', params: { handover: fmtHM(handover), partner: a.soldier.name } }]);
      assign(g, a, { ...slot, period: secondHalf }, seat, commanderSeat, [note], 'auto',
        [...opts.buildHalf(a, { ...slot, period: secondHalf }, fa.reasons),
         { code: 'handover_in', params: { handover: fmtHM(handover), partner: d.soldier.name } }]);
      return true;
    }
  }
  return false;
}
