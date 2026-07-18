// Rest rules: pure predicates shared by generator and validator (one
// implementation per SPEC rule so the two sides can never disagree), plus the
// generator's rest bookkeeping — restInfo() and the fits() feasibility check
// with its coded FitReasons.

import { Minutes, DAY, hours, overlaps, scheduleDayStart } from './time.js';
import { RationaleCode } from './rationale.js';
import { Gen, SoldierState, countedHours, isBlocked } from './state.js';

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

// ── fit reasons ─────────────────────────────────────────────────────────────
// fits() reports WHY a candidate is rejected / fallback-only as codes, not
// prose: one lookup table renders the Hebrew violation text, and a second maps
// fallback codes to structured rationale caveats (no substring matching).

export type FitCode =
  | 'not_commander' | 'unavailable' | 'overlap' | 'readiness_overlap'
  | 'over_daily_cap' | 'third_night' | 'rest_lt4' | 'rest_lt8_long' | 'short_rest'
  | 'exit_rest';
export interface FitReason { code: FitCode; params?: Record<string, string> }
export type Fit = { ok: boolean; fallback: boolean; reasons: FitReason[] };

const FIT_TEXT: Record<FitCode, string> = {
  not_commander: 'לא מפקד',
  unavailable: 'לא זמין',
  overlap: 'חפיפה',
  readiness_overlap: 'חפיפה עם כוננות',
  over_daily_cap: 'מעל {capH} שעות ביום',
  third_night: 'לילה שלישי ברצף',
  rest_lt4: 'פחות מ-{minH} שעות מנוחה',
  rest_lt8_long: 'פחות מ-{idealH} שעות מנוחה למשימה ארוכה',
  short_rest: 'מנוחה קצרה: {restH}ש',
  exit_rest: 'מנוחה מקוצרת עקב יציאה קצרה',
};
export const fitText = (r: FitReason): string =>
  FIT_TEXT[r.code].replace(/\{(\w+)\}/g, (_, k) => r.params?.[k] ?? '?');
export const fitTexts = (rs: FitReason[]): string[] => rs.map(fitText);

/** fallback fit codes -> rationale caveat codes (level2 buildRationale) */
export const FIT_RATIONALE: Partial<Record<FitCode, RationaleCode>> = {
  rest_lt8_long: 'caveat_rest_lt8_long',
  third_night: 'caveat_third_night',
  exit_rest: 'caveat_exit_rest',
};

/** Rest facts before `start`; readiness is transparent (R2).
 *  R5 (generalized): finishing a daily task whose position config carries
 *  `full_rest_after` (חפק / התקפי / קצין מוצב) counts as a full 8h rest for
 *  starts at/after 14:00 of the schedule day FOLLOWING the duty's own day —
 *  a gap of 0 at the 14:00 boundary is fine. תורנים deliberately has no
 *  flag: R1's normal 4h floor applies after it (earliest next start 18:00).
 *  `dutyRest` is true only when the boost actually lifted the gap. */
export function restInfo(g: Gen, st: SoldierState, start: Minutes):
    { gap: number; prevEnd: Minutes | null; dutyRest: boolean; dutyPosition?: string } {
  const restIdeal = g.ctx.tunables.restIdealH * 60;
  let prevEnd = -Infinity;
  for (const iv of st.intervals) {
    if (iv[1] <= start && iv[1] > prevEnd) prevEnd = iv[1];
  }
  // R3: a כונן גשש night window counts as ~1.5h of effective work (the
  // morning departure) — its effective end joins the prevEnd search even
  // though readiness is otherwise rest-transparent (R2)
  for (const e of st.gashashNightEnds) {
    if (e <= start && e > prevEnd) prevEnd = e;
  }
  if (prevEnd === -Infinity) return { gap: Infinity, prevEnd: null, dutyRest: false };
  const gap = start - prevEnd;
  if (gap < restIdeal) {
    const ex = g.ctx.existing.get(st.soldier.id) ?? [];
    const duty = ex.find((a) => a.period[1] === prevEnd
      && isFullRestExempt(g.ctx.positions.get(a.positionId)?.config, a.period[0], start));
    if (duty) {
      return {
        gap: restIdeal, prevEnd, dutyRest: true,
        dutyPosition: g.ctx.positions.get(duty.positionId)?.name,
      };
    }
  }
  return { gap, prevEnd, dutyRest: false };
}

export const restBefore = (g: Gen, st: SoldierState, start: Minutes): number =>
  restInfo(g, st, start).gap;

/** Feasibility of `st` for a slot window: hard blocks (H1/H3/H3b/R4/H6 seat,
 *  H8 rest floor — absolute, no בדוחק), fallback-only conditions (R1
 *  long-task rest, R6 third night), and soft short-rest annotation. */
export function fits(g: Gen, st: SoldierState, slot: [Minutes, Minutes], commanderSeat: boolean,
                     isReadiness = false, nightExempt = false): Fit {
  const T = g.ctx.tunables;
  const s = st.soldier;
  const reasons: FitReason[] = [];
  const no = (code: FitCode): Fit => ({ ok: false, fallback: false, reasons: [{ code }] });
  if (commanderSeat && !s.isCommander) return no('not_commander');
  if (isBlocked(g, s.id, slot)) return no('unavailable');
  // H3 strict: a soldier is either on an active mission or on כוננות — no
  // overlap in either direction (the attack↔readiness exception is removed)
  if (st.intervals.some((iv) => overlaps(iv, slot))) return no('overlap');
  if (st.readiness.some((iv) => overlaps(iv, slot))) return no('readiness_overlap');
  if (isReadiness) return { ok: true, fallback: false, reasons: [] }; // R2: rest-transparent, uncapped
  const counted = countedHours(g, slot);
  if (st.missionHoursToday + counted > T.dailyCapH + 0.01) {
    return { ok: false, fallback: false,
      reasons: [{ code: 'over_daily_cap', params: { capH: String(T.dailyCapH) } }] };
  }
  // R6: a third consecutive night is a violation — fallback-only.
  // (isReadiness returned above, so isCountedNight only gates on night_exempt:
  // exempt 24h duties span 00-06 but the soldier sleeps — not nights.)
  if (isCountedNight('other', nightExempt) && overlaps(slot, g.night)
    && (g.ctx.nightStreak.get(s.id) ?? 0) + (st.nightsToday > 0 ? 1 : 0) >= 2) {
    return { ok: true, fallback: true, reasons: [{ code: 'third_night' }] };
  }
  const rest = restBefore(g, st, slot[0]);
  // H8 ABSOLUTE: < 4h rest before a task is a hard block — never a בדוחק
  // fallback. Exemptions: R5 duty-rest (daily positions, folded into
  // restBefore()'s gap) and R7 — on his half-day-exit day a soldier's shifts
  // may be packed back-to-back (fallback, not a block), him alone.
  if (rest < T.restMinH * 60) {
    if (g.ctx.exits.has(s.id)) {
      return { ok: true, fallback: true, reasons: [{ code: 'exit_rest' }] };
    }
    return { ok: false, fallback: false,
      reasons: [{ code: 'rest_lt4', params: { minH: String(T.restMinH) } }] };
  }
  if (rest < T.restIdealH * 60 && hours(slot) > T.longTaskH) {
    return { ok: true, fallback: true,
      reasons: [{ code: 'rest_lt8_long', params: { idealH: String(T.restIdealH) } }] };
  }
  if (rest < T.restIdealH * 60) {
    reasons.push({ code: 'short_rest', params: { restH: (rest / 60).toFixed(1) } });
  }
  return { ok: true, fallback: false, reasons };
}
