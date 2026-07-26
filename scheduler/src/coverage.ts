import { normalizeName as nrm } from './text.js';

/**
 * Slot coverage — how many of a template slot's seats are actually staffed.
 *
 * Shared by the validator (validate.ts §10 `coverage`) and the צור שבצק tab's
 * לא-מאויש markers (api/draft.ts), so the two surfaces can never disagree
 * about whether a seat is empty — the same alignment duty `requiredSeats()`
 * (config.ts) and `violationCoveredByRationale()` (rationale.ts) carry.
 *
 * Time unit is deliberately a bare number: the validator counts minutes since
 * the day's 14:00 anchor, api/draft.ts uses epoch ms. Both only ever compare a
 * slot to rows measured on the same scale.
 */

export interface CoverRow {
  start: number;
  end: number;
  /** sub-position name, or null for a position-level row (imported history) */
  subName: string | null;
}

/**
 * Does an assignment row count toward a slot's seats? Draft rows carry their
 * sub-position; imported history rows don't, so a null-sub ROW counts toward
 * any sub-slot it overlaps, and a null-sub SLOT (position-level template) is
 * fed by every row of the position.
 */
export function rowFeedsSlot(rowSub: string | null, slotSub: string | null): boolean {
  return rowSub === null || slotSub === null || nrm(rowSub) === nrm(slotSub);
}

/**
 * Seats staffed over a slot window = the MINIMUM number of concurrently
 * covering rows across it. A seat covered by a replacement PAIR (H1 — two rows
 * splitting the slot at the handover) counts as staffed; a partially covered
 * one does not.
 *
 * Coverage is judged by OVERLAP, never by equal windows: a real row sliced
 * differently from the template still staffs it (e.g. the officers run כרמל
 * חטיבה's night as one 22:00→06:00 row while a template may split it into two
 * 4h slots). Callers pass rows already filtered to the slot's position and day.
 */
export function staffedSeats(
  slotStart: number, slotEnd: number, slotSub: string | null, rows: readonly CoverRow[],
): number {
  if (slotEnd <= slotStart) return 0;
  const covering = rows
    .filter((r) => rowFeedsSlot(r.subName, slotSub) && r.start < slotEnd && slotStart < r.end)
    .map((r) => [Math.max(r.start, slotStart), Math.min(r.end, slotEnd)] as [number, number]);
  const points = [...new Set([slotStart, ...covering.flat()])]
    .filter((t) => t >= slotStart && t < slotEnd);
  return Math.min(...points.map((t) => covering.filter((c) => c[0] <= t && t < c[1]).length));
}
