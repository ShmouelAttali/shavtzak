// Rest/night predicates shared by the generator (src/generate.ts) and the
// post-hoc validator (src/validate.ts) — one implementation per SPEC rule so
// the two sides can never disagree.

import { Minutes, DAY, scheduleDayStart } from './time.js';

/**
 * R5 (generalized): finishing a daily 14:00–14:00 task whose position config
 * carries `full_rest_after` counts as a full 8h rest for assignments starting
 * at/after 14:00 of the schedule day FOLLOWING the duty's own day (a gap of 0
 * at the 14:00 boundary is fine). The duty's schedule day is anchored on its
 * START (matters for imported history rows that crossed the boundary).
 * תורנים deliberately has no flag — R1's normal 4h floor applies after it.
 */
export function isFullRestExempt(
  prevPosConfig: Record<string, any> | undefined,
  prevStart: Minutes,
  nextStart: Minutes,
): boolean {
  return !!prevPosConfig?.full_rest_after && nextStart >= scheduleDayStart(prevStart) + DAY;
}

/**
 * Does an assignment overlapping the night window count as a "night"?
 * (P2 fairness, R6 consecutive nights.) Readiness is rest-transparent (R2,
 * assumed sleeping) and `night_exempt` 24h duties (מגן/חפק/תורנים/קצין מוצב —
 * the soldier sleeps) span 00–06 but are not nights.
 */
export function isCountedNight(missionClass: string, nightExempt: boolean | undefined): boolean {
  return missionClass !== 'readiness' && !nightExempt;
}
