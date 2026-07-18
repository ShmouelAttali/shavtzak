// T4 chained duties: overlay readiness rows staffed by the crew descending
// from a source shift (כרמל חטיבה from the defense grid, כונן גשש from patrol
// descents). Runs in two passes around Level 2 — see generate.ts.

import { Minutes, addDays, slotStart, overlaps, nightRange, nightRangeAt } from './time.js';
import { ChainRule } from './model.js';
import { RationaleEntry } from './rationale.js';
import { Gen, SoldierState, allowedIn, assign, isBlocked, isGashashNight, gashashEffEnd } from './state.js';
import { isCountedNight } from './rest.js';
import { rank } from './rank.js';

/** T4c pick ordering for `min_tracker_hours` chains (R3): for the NIGHT
 *  window prefer crew members who slept the previous night, then lowest
 *  cumulative tracker hours, then fairness order. Pure — unit-tested. */
export function trackerPickOrder<T>(pool: T[], opts: {
  nightWindow: boolean;
  slept: (t: T) => boolean;
  trackerH: (t: T) => number;
  fairIndex: (t: T) => number;
}): T[] {
  return [...pool].sort((a, b) =>
    (opts.nightWindow ? Number(!opts.slept(a)) - Number(!opts.slept(b)) : 0)
    || opts.trackerH(a) - opts.trackerH(b)
    || opts.fairIndex(a) - opts.fairIndex(b));
}

export function runChain(g: Gen, rule: ChainRule): void {
  const { ctx, day } = g;
  const newByPosStart = (pid: number, startMin: Minutes) =>
    g.assignments.filter((a) => a.positionId === pid && a.period[0] === startMin);

  const srcDay = addDays(day, rule.sourceDayOffset);
  const srcStart = slotStart(srcDay, rule.sourceStart);
  // source crew: today's fresh assignments, or history/locked rows for offset days
  let crew: number[] = newByPosStart(rule.sourcePosition, srcStart).map((a) => a.soldierId);
  if (crew.length === 0) {
    for (const [sid, list] of ctx.existing) {
      if (list.some((a) => a.positionId === rule.sourcePosition && a.period[0] === srcStart)) crew.push(sid);
    }
  }
  crew = [...new Set(crew)];
  const targetName = ctx.positions.get(rule.targetPosition)!.name;
  const sourceName = ctx.positions.get(rule.sourcePosition)!.name;
  if (crew.length === 0) {
    g.issues.push(`שרשור ${targetName} ${rule.targetStart}: לא נמצא צוות מקור`);
    return;
  }

  const tStart = slotStart(day, rule.targetStart);
  let targetSlots = ctx.slots
    .filter((s) => s.positionId === rule.targetPosition && s.period[0] === tStart)
    .sort((a, b) => (b.subName === 'מפקד כרמל חטיבה' ? 1 : 0) - (a.subName === 'מפקד כרמל חטיבה' ? 1 : 0));
  if (targetSlots.length === 0) {
    targetSlots = [{
      positionId: rule.targetPosition, subPositionId: null, subName: null,
      period: [tStart, tStart + 8 * 60], seats: crew.length, commanderFirstSeat: false,
    }];
  }

  let pool = crew.map((id) => g.state.get(id)!).filter(Boolean)
    .filter((st) => !isBlocked(g, st.soldier.id, targetSlots[0].period))
    // a soldier already on a mission during the window can't stand by for it
    .filter((st) => !st.intervals.some((iv) => overlaps(iv, targetSlots[0].period)))
    // nor can they hold two simultaneous standbys (e.g. התקפי + כרמל)
    .filter((st) => !st.readiness.some((iv) => overlaps(iv, targetSlots[0].period)))
    // H6c: whitelisted soldiers take only their allowed positions, chains included
    .filter((st) => allowedIn(g, st.soldier, targetName));

  if (rule.pick === 'min_tracker_hours') {
    // T4c selection (R3): for the night window (22:00–07:00) prefer crew
    // members who SLEPT the previous night (no counted-night assignment in
    // [D 00:00, D 06:00]), then minimize cumulative tracker hours, then
    // fairness order.
    const window = targetSlots[0].period;
    const prevNight = nightRange(addDays(day, -1));
    const sleptPrevNight = (st: SoldierState) => !(ctx.existing.get(st.soldier.id) ?? [])
      .some((a) => overlaps(a.period, prevNight)
        && isCountedNight(a.missionClass, ctx.positions.get(a.positionId)?.config?.night_exempt));
    const fair = rank(g, pool, rule.targetPosition, false);
    pool = trackerPickOrder(pool, {
      nightWindow: overlaps(window, nightRangeAt(window[0])),
      slept: sleptPrevNight,
      trackerH: (st) => st.fairness.trackerHoursTotal + st.trackerMinutes / 60,
      fairIndex: (st) => fair.indexOf(st),
    }).slice(0, 1);
  }

  let commanderAssigned = false;
  for (const slot of targetSlots) {
    const isCmdSlot = slot.subName === 'מפקד כרמל חטיבה';
    // commander seat: prefer a real מפקד (מ"מ/סמל/מ"כ/מ"ח) from the crew;
    // only when none exists fall back to the highest רובאי
    const take = isCmdSlot
      ? [...pool].sort((a, b) =>
          Number(b.soldier.isCommander) - Number(a.soldier.isCommander)
          || b.soldier.rifle - a.soldier.rifle).slice(0, slot.seats)
      : pool.filter((st) => !g.assignments.some((a) => a.soldierId === st.soldier.id
          && a.period[0] === slot.period[0] && a.positionId === rule.targetPosition)).slice(0, slot.seats);
    take.forEach((st, i) => {
      const rationale: RationaleEntry[] = [{
        code: 'chain',
        params: { target: targetName, source: sourceName, sourceStart: rule.sourceStart },
      }];
      if (rule.pick === 'min_tracker_hours') rationale.push({ code: 'chain_min_tracker' });
      if (isCmdSlot) rationale.push({ code: 'chain_commander' });
      assign(g, st, slot, i + 1, isCmdSlot, [], 'chain', rationale);
      if (targetName === 'כונן גשש') {
        // R3 (owner decision): ONLY the night window (22:00–07:00) counts as
        // גשש load — day windows (07–14, 14–22) accrue no tracker hours and
        // contribute no effective-rest end.
        if (isGashashNight(g, { positionId: slot.positionId, period: slot.period })) {
          st.trackerMinutes += slot.period[1] - slot.period[0];
          // R3: a fresh גשש night window contributes its effective end to
          // same-day rest checks (tasks starting 07:00–14:00 next morning)
          st.gashashNightEnds.push(gashashEffEnd(g, slot.period));
        }
      }
      if (isCmdSlot) commanderAssigned = true;
    });
    if (take.length < slot.seats) {
      g.issues.push(`שרשור ${targetName} ${rule.targetStart}: אוישו ${take.length}/${slot.seats}`);
    }
  }
  if (targetName === 'כרמל חטיבה' && !commanderAssigned) {
    g.issues.push(`כרמל חטיבה ${rule.targetStart}: אין מפקד (רובאי בכיר)`);
  }
}
