// Honest tunables: every value here is genuinely read from the `config` table
// (with these defaults when absent). Anything not in this list is NOT a DB
// tunable — notably the 14:00 day anchor and the 00:00–06:00 night window,
// which stay hardcoded mirrors in time.ts + db/schema.sql by design.

export interface Tunables {
  /** H8/R1 hard rest floor (hours) — less than this blocks absolutely (no
   *  בדוחק; only the R5 duty-rest exemption applies) */
  restMinH: number;
  /** R1 ideal rest (hours) — 4–8h is allowed-with-warning for short tasks */
  restIdealH: number;
  /** R1: tasks longer than this (hours) need ideal rest, else fallback-only */
  longTaskH: number;
  /** R4 daily cap (counted mission hours per schedule day); also the P3
   *  load-bucket size in rank() (one duty-day) */
  dailyCapH: number;
  /** P3: readiness hours weight vs mission hours (applied in soldier_fairness SQL) */
  readinessHourWeight: number;
  /** R3: effective work hours of a כונן גשש night window (22:00–07:00) —
   *  rest before a subsequent task is measured from window start + this */
  gashashEffectiveHours: number;
}

/** Build tunables from the `config` table rows (key -> jsonb value). */
export function loadTunables(config: Record<string, any>): Tunables {
  const rest = config.rest_rules ?? {};
  return {
    restMinH: Number(rest.minimum_hours ?? 4),
    restIdealH: Number(rest.ideal_hours ?? 8),
    longTaskH: Number(rest.long_task_hours ?? 4),
    dailyCapH: Number(config.daily_cap_hours ?? 8),
    readinessHourWeight: Number(config.readiness_hour_weight ?? 0.25),
    gashashEffectiveHours: Number(rest.gashash_effective_hours ?? 1.5),
  };
}

/**
 * Seats a slot must actually staff. Flex positions (`config.flex_seats`, e.g.
 * מגן 10–12, סיור 3–4/shift) may staff below the template seat count down to
 * `flex_seats.min`; every other position needs its full seat count. Shared by
 * the validator's coverage check (validate.ts) and the tab's לא מאויש markers
 * (api/draft.ts) so the two can never diverge on the flex rule.
 */
export function requiredSeats(seats: number, config: Record<string, any> | null | undefined): number {
  const flexMin = config?.flex_seats?.min;
  return flexMin !== undefined ? Math.min(seats, Number(flexMin)) : seats;
}

/**
 * Position-config resolution: `daily: true` marks a 14:00–14:00 sleeping day
 * duty and implies `night_exempt` + `full_rest_after` + `yomi_display`.
 * Explicit keys override (e.g. תורנים sets `full_rest_after: false` — R1's 4h
 * floor applies after a תורנות). Resolved ONCE at each read boundary:
 * load.ts (generator), validate.ts, api/draft.ts; the SQL side
 * (soldier_fairness) mirrors the same coalesce(night_exempt, daily, false).
 */
export function effectiveConfig(config: Record<string, any> | null | undefined): Record<string, any> {
  const c = config ?? {};
  if (!c.daily) return c;
  return { night_exempt: true, full_rest_after: true, yomi_display: true, ...c };
}

/**
 * H9: a position a soldier may serve on his half-day-exit day. Reuses the
 * existing classification — not a daily 14:00–14:00 duty (`config.daily`, the
 * same flag that makes מגן/חפק/תורנים/קצין מוצב/התקפי/מפלג daily) and not an
 * on-call overlay (`mission_class = 'readiness'`). Expects a position whose
 * config went through effectiveConfig() at the read boundary.
 */
export const isShiftPosition = (pos: { missionClass: string; config: Record<string, any> }): boolean =>
  !pos.config.daily && pos.missionClass !== 'readiness';

/**
 * "On-call" for the T6 constant-availability rule (owner 2026-07-20): a
 * `config.on_call` position — in practice התקפי (readiness standby) and the
 * static guard posts (עמדות הגנה). NOT חמל / כרמל / כונן גשש, though they are
 * also `readiness`, and not the daily duties.
 */
export const isOnCall = (pos: { config: Record<string, any> | null | undefined }): boolean =>
  !!pos.config?.on_call;

/**
 * H9 night-exit relaxation (owner 2026-07-19): a position flagged
 * `night_exit_ok: true` (תורנים) is ADDITIONALLY allowed on a soldier's
 * exit day when all his exit windows that day are night windows — shift
 * positions stay allowed, other daily duties and readiness stay forbidden.
 * Expects a position whose config went through effectiveConfig().
 */
export const isNightExitOk = (pos: { config: Record<string, any> }): boolean =>
  !!pos.config.night_exit_ok;

/**
 * H9 "night exit": ALL of the soldier's exit windows for the schedule day
 * starting at `dayStartMin` (14:00) fall entirely within 22:00–06:00
 * (= day start + 8h .. day start + 16h). Exit boundaries are shift
 * boundaries, so the qualifying windows are 22–02, 02–06, 22–06. Any window
 * touching outside the range → the shift-position-only rule stays.
 */
export const isNightExitWindows = (
  windows: readonly [number, number][], dayStartMin: number): boolean =>
  windows.length > 0 && windows.every((w) =>
    w[0] >= dayStartMin + 8 * 60 && w[1] <= dayStartMin + 16 * 60);
