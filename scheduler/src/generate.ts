import { pool } from './db.js';
import { loadContext } from './load.js';
import { validateAndStore, Finding } from './validate.js';
import { Soldier, Slot, Assignment, Fairness, SeatRule } from './model.js';
import { RationaleCode, RationaleEntry } from './rationale.js';
import {
  Minutes, dayStart, dayEnd, addDays, slotStart, overlaps, hours,
  minToIso, fmtHM, nightRange,
} from './time.js';
import { normalizeName as nrm } from './text.js';
import { isFullRestExempt, isCountedNight } from './rest.js';

const REST_MIN = 4 * 60;          // H8 hard floor
const REST_IDEAL = 8 * 60;        // R1
const LONG_TASK = 4 * 60;         // R1: tasks longer than this need ideal rest
const DAILY_CAP = 8;              // R4 (counted hours)
const OVERLAY = new Set(['כרמל חטיבה', 'כונן גשש']); // chained overlays, not Level-1
const EMPTY_FAIRNESS: Fairness = {
  nightCount7d: 0, nightCountTotal: 0, missionHours7d: 0, weightedHours7d: 0,
  readinessHours7d: 0, trackerHoursTotal: 0, positionCounts: {},
};

/** Hours a slot contributes to the daily cap: daily missions count as 8h (R4). */
const countedHours = (p: [Minutes, Minutes]) => Math.min(hours(p), DAILY_CAP);

// ── fit reasons ─────────────────────────────────────────────────────────────
// fits() reports WHY a candidate is rejected / fallback-only as codes, not
// prose: one lookup table renders the Hebrew violation text, and a second maps
// fallback codes to structured rationale caveats (no substring matching).

export type FitCode =
  | 'not_commander' | 'unavailable' | 'overlap' | 'readiness_overlap'
  | 'over_daily_cap' | 'third_night' | 'rest_lt4' | 'rest_lt8_long' | 'short_rest';
export interface FitReason { code: FitCode; restH?: string }

const FIT_TEXT: Record<FitCode, string> = {
  not_commander: 'לא מפקד',
  unavailable: 'לא זמין',
  overlap: 'חפיפה',
  readiness_overlap: 'חפיפה עם כוננות',
  over_daily_cap: 'מעל 8 שעות ביום',
  third_night: 'לילה שלישי ברצף',
  rest_lt4: 'פחות מ-4 שעות מנוחה',
  rest_lt8_long: 'פחות מ-8 שעות מנוחה למשימה ארוכה',
  short_rest: 'מנוחה קצרה: {restH}ש',
};
export const fitText = (r: FitReason): string =>
  FIT_TEXT[r.code].replace('{restH}', r.restH ?? '?');
const fitTexts = (rs: FitReason[]): string[] => rs.map(fitText);

/** fallback fit codes -> rationale caveat codes (buildRationale) */
const FIT_RATIONALE: Partial<Record<FitCode, RationaleCode>> = {
  rest_lt4: 'caveat_rest_lt4',
  rest_lt8_long: 'caveat_rest_lt8_long',
  third_night: 'caveat_third_night',
};

interface SoldierState {
  soldier: Soldier;
  fairness: Fairness;
  /** blocking intervals: existing (blocks) + newly assigned, non-readiness */
  intervals: [Minutes, Minutes][];
  /** readiness intervals (don't reset rest; H3-strict: may not overlap missions) */
  readiness: [Minutes, Minutes][];
  missionHoursToday: number;
  nightsToday: number;
  trackerMinutes: number;
  level1: number | null;      // position id
  /** why this soldier landed in their Level-1 group (continuity/commander quota) */
  level1Rationale: RationaleEntry[];
}

// ── fairness keys ───────────────────────────────────────────────────────────
// One formula each for the P2/P3 keys — used by rank()'s priority tuple AND by
// the Level-2 rationale snapshot, so the "why picked" claims can't drift from
// what the ranking actually compared.

/** P2: nights in the rolling window; today's fresh nights count when ranking a night slot. */
const nightsOf = (st: SoldierState, forNight: boolean): number =>
  st.fairness.nightCount7d + (forNight ? st.nightsToday : 0);

/** P3: weighted mission hours incl. today's fresh assignments. */
const loadOf = (st: SoldierState): number =>
  st.fairness.weightedHours7d + st.missionHoursToday;

export interface GenerateResult {
  day: string;
  assignments: Assignment[];
  level1: Map<number, number>;
  issues: string[];
}

export async function generate(day: string): Promise<GenerateResult> {
  const ctx = await loadContext(day);
  const issues: string[] = [];
  const dRange: [Minutes, Minutes] = [dayStart(day), dayEnd(day)];
  const night = nightRange(day);

  // ── per-soldier state ────────────────────────────────────────────────────
  const state = new Map<number, SoldierState>();
  for (const s of ctx.soldiers.values()) {
    const ex = ctx.existing.get(s.id) ?? [];
    const st: SoldierState = {
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
          && a.period[0] >= dRange[0] && a.period[0] < dRange[1])
        .reduce((h, a) => h + countedHours(a.period), 0),
      nightsToday: 0,
      trackerMinutes: 0,
      level1: null,
      level1Rationale: [],
    };
    state.set(s.id, st);
  }

  const isBlocked = (sid: number, p: [Minutes, Minutes]) =>
    (ctx.blocked.get(sid) ?? []).some((b) => overlaps(b, p));
  const fullyBlocked = (sid: number) => isBlocked(sid, dRange) &&
    (ctx.blocked.get(sid) ?? []).some((b) => b[0] <= dRange[0] && b[1] >= dRange[1]);

  /** Rest facts before `start`; readiness is transparent (R2).
   *  R5 (generalized): finishing a daily task whose position config carries
   *  `full_rest_after` (חפק / התקפי / קצין מוצב) counts as a full 8h rest for
   *  starts at/after 14:00 of the schedule day FOLLOWING the duty's own day —
   *  a gap of 0 at the 14:00 boundary is fine. תורנים deliberately has no
   *  flag: R1's normal 4h floor applies after it (earliest next start 18:00).
   *  `dutyRest` is true only when the boost actually lifted the gap. */
  function restInfo(st: SoldierState, start: Minutes):
      { gap: number; prevEnd: Minutes | null; dutyRest: boolean; dutyPosition?: string } {
    let prevEnd = -Infinity;
    for (const iv of st.intervals) {
      if (iv[1] <= start && iv[1] > prevEnd) prevEnd = iv[1];
    }
    if (prevEnd === -Infinity) return { gap: Infinity, prevEnd: null, dutyRest: false };
    const gap = start - prevEnd;
    if (gap < REST_IDEAL) {
      const ex = ctx.existing.get(st.soldier.id) ?? [];
      const duty = ex.find((a) => a.period[1] === prevEnd
        && isFullRestExempt(ctx.positions.get(a.positionId)?.config, a.period[0], start));
      if (duty) {
        return {
          gap: REST_IDEAL, prevEnd, dutyRest: true,
          dutyPosition: ctx.positions.get(duty.positionId)?.name,
        };
      }
    }
    return { gap, prevEnd, dutyRest: false };
  }
  const restBefore = (st: SoldierState, start: Minutes): number => restInfo(st, start).gap;

  type Fit = { ok: boolean; fallback: boolean; reasons: FitReason[] };
  function fits(st: SoldierState, slot: [Minutes, Minutes], commanderSeat: boolean,
                isReadiness = false, nightExempt = false): Fit {
    const s = st.soldier;
    const reasons: FitReason[] = [];
    const no = (code: FitCode): Fit => ({ ok: false, fallback: false, reasons: [{ code }] });
    if (commanderSeat && !s.isCommander) return no('not_commander');
    if (isBlocked(s.id, slot)) return no('unavailable');
    // H3 strict: a soldier is either on an active mission or on כוננות — no
    // overlap in either direction (the attack↔readiness exception is removed)
    if (st.intervals.some((iv) => overlaps(iv, slot))) return no('overlap');
    if (st.readiness.some((iv) => overlaps(iv, slot))) return no('readiness_overlap');
    if (isReadiness) return { ok: true, fallback: false, reasons: [] }; // R2: rest-transparent, uncapped
    const counted = countedHours(slot);
    if (st.missionHoursToday + counted > DAILY_CAP + 0.01) return no('over_daily_cap');
    // R6: a third consecutive night is a violation — fallback-only.
    // (isReadiness returned above, so isCountedNight only gates on night_exempt:
    // exempt 24h duties span 00-06 but the soldier sleeps — not nights.)
    if (isCountedNight('other', nightExempt) && overlaps(slot, night)
      && (ctx.nightStreak.get(s.id) ?? 0) + (st.nightsToday > 0 ? 1 : 0) >= 2) {
      return { ok: true, fallback: true, reasons: [{ code: 'third_night' }] };
    }
    const rest = restBefore(st, slot[0]);
    if (rest < REST_MIN) return { ok: true, fallback: true, reasons: [{ code: 'rest_lt4' }] };
    if (rest < REST_IDEAL && hours(slot) > LONG_TASK / 60) {
      return { ok: true, fallback: true, reasons: [{ code: 'rest_lt8_long' }] };
    }
    if (rest < REST_IDEAL) reasons.push({ code: 'short_rest', restH: (rest / 60).toFixed(1) });
    return { ok: true, fallback: false, reasons };
  }

  /** H1 replacement pairs: classify a soldier's availability shape inside `p`.
   *  'departing' = available [p0, at) and then out through the slot end;
   *  'arriving'  = out from the slot start, available [at, p1).
   *  Anything else (fully available, a gap in the middle, fully out) → null. */
  function partialWindow(sid: number, p: [Minutes, Minutes]):
      { kind: 'departing' | 'arriving'; at: Minutes } | null {
    const clipped = (ctx.blocked.get(sid) ?? [])
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

  /** Rotation penalty per T1-T3 (lower = better). Continuity positions
   *  (e.g. מגן) invert T1: staying in the same position is preferred.
   *  Returns the dominant T-rule as a tag so buildRationale can report the
   *  same cascade without re-deriving it. */
  type RotationTag = 'continuity' | 'static_streak' | 'same_position' | 'same_class' | 'break_static' | null;
  function rotationPenalty(st: SoldierState, positionId: number): { penalty: number; tag: RotationTag } {
    const pos = ctx.positions.get(positionId);
    const cls = pos?.missionClass;
    const yPos = ctx.yesterdayPosition.get(st.soldier.id);
    const yCls = yPos !== undefined ? ctx.positions.get(yPos)?.missionClass : undefined;
    const streak = ctx.staticStreak.get(st.soldier.id) ?? 0;
    if (pos?.config?.continuity) return { penalty: yPos === positionId ? -2 : 0, tag: 'continuity' };
    if (streak >= 2 && cls === 'static') return { penalty: 3, tag: 'static_streak' };   // T3 violation
    if (yPos === positionId) return { penalty: 2, tag: 'same_position' };               // T1
    if (yCls && cls && yCls === cls && cls !== 'other') return { penalty: 1, tag: 'same_class' }; // T2
    if (streak >= 2 && cls === 'dynamic') return { penalty: -1, tag: 'break_static' };  // T3 break bonus
    return { penalty: 0, tag: null };
  }

  /** Priority-list comparator (SPEC §6.1) for position/slot selection.
   *  When ranking for a concrete slot, pass its start so candidates with a
   *  full 8h rest before it win over short-rest ones (keeps 4h shifts spaced
   *  8h apart: 06&18, 10&22, 14&02). */
  function rank(candidates: SoldierState[], positionId: number, forNight: boolean, atStart?: Minutes): SoldierState[] {
    const posName = ctx.positions.get(positionId)!.name;
    return [...candidates].sort((a, b) => {
      const ka = key(a), kb = key(b);
      for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i];
      return a.soldier.name.localeCompare(b.soldier.name, 'he');
    });
    function key(st: SoldierState): number[] {
      const restAt = restBefore(st, atStart ?? dRange[0]);
      return [
        atStart !== undefined && restAt < REST_IDEAL ? 1 : 0,                  // R1 quasi-constraint
        // T5 (soft): at most one תורנות per rolling 7 days — anyone with a
        // recent תורנות sorts after everyone without one (never a hard block)
        posName === 'תורנים' && (ctx.toranutCount7d.get(st.soldier.id) ?? 0) > 0 ? 1 : 0,
        nightsOf(st, forNight),                                                // P2
        // P3 bucketed to one duty-day (8h): soldiers within the same load
        // bucket are equal, letting rotation (P4) actually decide.
        Math.floor(loadOf(st) / 8),                                            // P3
        rotationPenalty(st, positionId).penalty,                               // P4
        st.fairness.positionCounts[posName] ?? 0,                              // P4 (L1 balance)
        loadOf(st),                                                            // P3 fine tie-break
        -Math.min(restAt, 48 * 60),                                            // P6
      ];
    }
  }

  // ── Level 1: partition into positions ───────────────────────────────────
  const slotsByPosition = new Map<number, Slot[]>();
  for (const slot of ctx.slots) {
    const p = ctx.positions.get(slot.positionId)!;
    if (!p.isScheduled || p.missionClass === 'rest' || OVERLAY.has(p.name)) continue;
    const list = slotsByPosition.get(slot.positionId) ?? [];
    list.push(slot);
    slotsByPosition.set(slot.positionId, list);
  }

  /** distinct soldiers needed = max(concurrent seats, ceil(counted-hours / 8)).
   *  Readiness positions (התקפי): crew size = concurrent seats of the
   *  readiness slot itself. */
  function demand(pid: number, slots: Slot[]): number {
    if (ctx.positions.get(pid)?.missionClass === 'readiness') {
      return Math.max(...slots.map((s) => s.seats), 0);
    }
    const totalHours = slots.reduce((h, s) => h + countedHours(s.period) * s.seats, 0);
    let concurrent = 0;
    for (const s of slots) {
      const c = slots.filter((o) => overlaps(o.period, s.period)).reduce((n, o) => n + o.seats, 0);
      concurrent = Math.max(concurrent, c);
    }
    return Math.max(concurrent, Math.ceil(totalHours / DAILY_CAP - 0.01));
  }

  /** commanders needed: one per commander-first slot start of the position */
  const commanderQuota = (own: Slot[]) =>
    new Set(own.filter((s) => s.commanderFirstSeat).map((s) => s.period[0])).size;

  // honor Level-1 locks first
  for (const [sid, pid] of ctx.lockedDay) {
    const st = state.get(sid);
    if (st) st.level1 = pid;
  }

  // fill order: role-gated / commander-heavy first
  const order = ['קצין מוצב', 'סיור', 'התקפי', 'מגן', 'עמדות הגנה', 'חפק', 'תורנים'];
  const level1 = new Map<number, number>();
  for (const [sid, pid] of ctx.lockedDay) level1.set(sid, pid);

  // Seat-rule pre-pass (H6b, e.g. חפק): each sub-position seat has a dedicated
  // candidate list — named soldiers or roles, in priority order. Candidates are
  // reserved for this position only (they never fill other positions); a rule
  // with release_unpicked frees the unchosen candidates back to the pool. A
  // seat with no available candidate stays EMPTY (issue raised, no substitute).
  /** One position-whitelist mechanism for both restriction sources:
   *  H6c allowed_positions (DB column) and H6b seat-rule reservation
   *  (candidates of a seat-rule position serve only there; a release rule
   *  removes its unchosen candidates from this map again). */
  const seatRestrict = new Map<number, string>();   // soldier id -> position name
  const allowedIn = (s: Soldier, posName: string) => {
    const reserved = seatRestrict.get(s.id);
    if (reserved !== undefined && nrm(reserved) !== nrm(posName)) return false;
    return !s.allowedPositions || s.allowedPositions.some((p) => nrm(p) === nrm(posName));
  };
  // A planned seat is one candidate, or (H6b pair handover) two candidates
  // from the SAME dedicated list splitting the window at the handover.
  type SeatPair = { pair: true; d: SoldierState; a: SoldierState; handover: Minutes };
  type SeatPick = SoldierState | SeatPair;
  const isSeatPair = (p: SeatPick): p is SeatPair => 'pair' in p;
  const seatPlan = new Map<number, Map<string, SeatPick>>();   // pid -> sub -> chosen
  const seatRuleBySub = new Map<number, Map<string, SeatRule>>();
  {
    const byName = new Map([...state.values()].map((st) => [nrm(st.soldier.name), st]));
    for (const pos of ctx.positions.values()) {
      const rules: SeatRule[] = pos.config?.seat_rules ?? [];
      if (!rules.length || !slotsByPosition.has(pos.id)) continue;
      const plan = new Map<string, SeatPick>();
      const ruleMap = new Map<string, SeatRule>();
      const subPeriod = new Map(slotsByPosition.get(pos.id)!
        .map((sl) => [nrm(sl.subName ?? ''), sl.period] as const));
      for (const rule of rules) {
        ruleMap.set(nrm(rule.sub), rule);
        const window = subPeriod.get(nrm(rule.sub)) ?? dRange;
        // candidates in priority order: explicit list, or role matches ordered
        // by the roles list (e.g. מ"פ before סמ"פ)
        const cands = rule.soldiers
          ? rule.soldiers.map((n) => byName.get(nrm(n))).filter((x): x is SoldierState => !!x)
          : [...state.values()]
              .filter((st) => (rule.roles ?? []).some((r) => nrm(r) === nrm(st.soldier.role)))
              .sort((a, b) =>
                rule.roles!.findIndex((r) => nrm(r) === nrm(a.soldier.role))
                - rule.roles!.findIndex((r) => nrm(r) === nrm(b.soldier.role)));
        for (const c of cands) seatRestrict.set(c.soldier.id, pos.name);
        const avail = cands.filter((st) =>
          (st.level1 === null || st.level1 === pos.id) && !isBlocked(st.soldier.id, window));
        // ordered/role rules take the first available; unordered pairs rotate by fairness
        const chosen = (rule.ordered || rule.roles) ? avail[0] : rank(avail, pos.id, false)[0];
        if (!chosen) {
          // H6b pair handover: when no candidate covers the whole window, a
          // departing candidate (available until his leave time) and an
          // arriving one (available from it) may split the seat — both from
          // the seat's OWN list, so "no substitutes" holds. Bus-at-10:00
          // blocks meet exactly at the handover.
          const dep = new Map<SoldierState, Minutes>();
          const arr = new Map<SoldierState, Minutes>();
          for (const c of cands) {
            if (c.level1 !== null && c.level1 !== pos.id) continue;
            const w = partialWindow(c.soldier.id, window);
            if (w?.kind === 'departing') dep.set(c, w.at);
            else if (w?.kind === 'arriving') arr.set(c, w.at);
          }
          const order = (xs: SoldierState[]) => (rule.ordered || rule.roles)
            ? [...xs].sort((x, y) => cands.indexOf(x) - cands.indexOf(y))
            : rank(xs, pos.id, false);
          let pairPick: SeatPair | undefined;
          for (const d of order([...dep.keys()])) {
            const handover = dep.get(d)!;
            const a = order([...arr.keys()].filter((x) => x !== d && arr.get(x)! <= handover))[0];
            if (a) { pairPick = { pair: true, d, a, handover }; break; }
          }
          if (pairPick) {
            for (const m of [pairPick.d, pairPick.a]) {
              if (m.level1 === null) { m.level1 = pos.id; level1.set(m.soldier.id, pos.id); }
              m.level1Rationale.push({
                code: 'seat_rule',
                params: { seat: rule.sub, position: pos.name, priority: cands.indexOf(m) + 1 },
              });
            }
            plan.set(nrm(rule.sub), pairPick);
            if (rule.release_unpicked) {
              for (const c of cands) if (c !== pairPick.d && c !== pairPick.a) seatRestrict.delete(c.soldier.id);
            }
            continue;
          }
          issues.push(`${pos.name}: אין מועמד זמין למושב ${rule.sub} — המושב יישאר ריק`);
          // nothing to protect — free the (blocked) candidates for other positions
          for (const c of cands) seatRestrict.delete(c.soldier.id);
          continue;
        }
        if (chosen.level1 === null) { chosen.level1 = pos.id; level1.set(chosen.soldier.id, pos.id); }
        chosen.level1Rationale.push({
          code: 'seat_rule',
          params: { seat: rule.sub, position: pos.name, priority: cands.indexOf(chosen) + 1 },
        });
        plan.set(nrm(rule.sub), chosen);
        if (rule.release_unpicked) for (const c of cands) if (c !== chosen) seatRestrict.delete(c.soldier.id);
      }
      seatPlan.set(pos.id, plan);
      seatRuleBySub.set(pos.id, ruleMap);
    }
  }

  // staff_all_roles positions (חמל): every present soldier of the role staffs
  // the position daily — variable crew size, no fixed demand.
  for (const pos of ctx.positions.values()) {
    const roles: string[] = pos.config?.staff_all_roles ?? [];
    if (!roles.length || !slotsByPosition.has(pos.id)) continue;
    const posSlots = slotsByPosition.get(pos.id)!;
    for (const st of state.values()) {
      if (st.level1 !== null || fullyBlocked(st.soldier.id)) continue;
      if (!roles.some((r) => nrm(r) === nrm(st.soldier.role))) continue;
      if (!posSlots.some((sl) => !isBlocked(st.soldier.id, sl.period))) continue;
      st.level1 = pos.id; level1.set(st.soldier.id, pos.id);
      st.level1Rationale.push({ code: 'role_crew', params: { position: pos.name, role: st.soldier.role } });
    }
  }

  // Continuity pre-pass (מגן): returning crew members are reserved BEFORE any
  // other position can grab them — the crew repeats day-to-day unless seats
  // shrink, a member is unavailable, or a manual/locked change intervenes.
  for (const pos of ctx.positions.values()) {
    if (!pos.config?.continuity || !slotsByPosition.has(pos.id)) continue;
    let room = demand(pos.id, slotsByPosition.get(pos.id)!)
      - [...level1.values()].filter((p) => p === pos.id).length;
    const posSlots = slotsByPosition.get(pos.id)!;
    const returning = [...state.values()].filter((st) =>
      st.level1 === null && !fullyBlocked(st.soldier.id)
      && allowedIn(st.soldier, pos.name)
      // returning member must still be available for the crew's mission window
      && posSlots.some((sl) => !isBlocked(st.soldier.id, sl.period))
      && ctx.yesterdayPosition.get(st.soldier.id) === pos.id);
    for (const st of rank(returning, pos.id, false)) {
      if (room <= 0) break;
      st.level1 = pos.id; level1.set(st.soldier.id, pos.id); room--;
      st.level1Rationale.push({ code: 'continuity_crew', params: { position: pos.name } });
    }
  }

  for (const posName of order) {
    const pid = ctx.positionByName.get(posName);
    if (pid === undefined || !slotsByPosition.has(pid)) continue;
    const pos = ctx.positions.get(pid)!;
    if (pos.config?.seat_rules || pos.config?.staff_all_roles) continue;   // staffed by pre-pass only
    const slots = slotsByPosition.get(pid)!;
    let need = demand(pid, slots) - [...level1.values()].filter((p) => p === pid).length;
    let cmdNeed = commanderQuota(slots);

    const eligible = (st: SoldierState) => {
      const s = st.soldier;
      if (st.level1 !== null || fullyBlocked(s.id)) return false;
      if (!allowedIn(s, posName)) return false;                                  // H6b/H6c: position whitelist
      // must be available for at least one of the position's slot windows
      // (a soldier leaving/arriving mid-day can't hold a window he'd miss)
      if (!slots.some((sl) => !isBlocked(s.id, sl.period))) return false;
      if (posName === 'קצין מוצב' && !s.isSeniorCommander) return false;         // H6
      if (posName === 'עמדות הגנה' && s.isSeniorCommander) return false;         // H6
      return true;
    };

    const pick = (st: SoldierState) => {
      st.level1 = pid; level1.set(st.soldier.id, pid); need--;
      if (st.soldier.isCommander && cmdNeed > 0) cmdNeed--;
    };

    let free = [...state.values()].filter(eligible);

    // same-platoon crews (מגן): constrain to one מחלקה — the platoon of the
    // current members if any, else the platoon with the most free candidates.
    if (pos.config?.same_platoon && need > 0) {
      const current = [...state.values()].filter((st) => st.level1 === pid);
      let platoon: string | undefined;
      if (current.length) {
        const counts = new Map<string, number>();
        for (const st of current) counts.set(st.soldier.platoon, (counts.get(st.soldier.platoon) ?? 0) + 1);
        platoon = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
      } else {
        const counts = new Map<string, number>();
        for (const st of free) counts.set(st.soldier.platoon, (counts.get(st.soldier.platoon) ?? 0) + 1);
        platoon = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
      }
      if (platoon) {
        const same = free.filter((st) => st.soldier.platoon === platoon);
        if (same.length >= need) free = same;
        else issues.push(`${posName}: אין מספיק חיילים ממחלקה ${platoon} — הצוות מעורב`);
      }
    }

    // For positions whose work is anchored to few starts (daily missions)
    // rank by rest before the earliest MISSION slot — readiness slots are
    // rest-transparent and must not mask the hint (e.g. התקפי's 24h slot).
    const missionSlots = slots.filter((s) =>
      ctx.positions.get(s.positionId)!.missionClass !== 'readiness');
    const starts = [...new Set(missionSlots.map((s) => s.period[0]))];
    const atStart = starts.length > 0 && starts.length <= 2 ? Math.min(...starts) : undefined;

    // commanders first (P5 quota), then everyone remaining
    if (cmdNeed > 0 && need > 0) {
      for (const st of rank(free.filter((c) => c.soldier.isCommander && c.level1 === null), pid, false, atStart)) {
        if (cmdNeed <= 0 || need <= 0) break;
        pick(st);
        st.level1Rationale.push({ code: 'commander_quota', params: { position: posName } });
      }
      if (cmdNeed > 0) issues.push(`${posName}: חסרים ${cmdNeed} מפקדים בשיבוץ היומי`);
    }
    for (const st of rank(free.filter((c) => c.level1 === null), pid, false, atStart)) {
      if (need <= 0) break;
      pick(st);
    }
    if (need > 0) issues.push(`${posName}: חסרים ${need} חיילים`);
  }

  const restId = ctx.positionByName.get('מנוחה')!;
  // מנוחה = resting on base; a soldier blocked for the whole day is בבית
  const homeId = ctx.positionByName.get('בבית') ?? restId;
  for (const st of state.values()) {
    if (st.level1 === null) {
      const pid = fullyBlocked(st.soldier.id) ? homeId : restId;
      st.level1 = pid; level1.set(st.soldier.id, pid);
    }
  }

  // ── Level 2: fill slots within each position group ──────────────────────
  const assignments: Assignment[] = [];

  const CLASS_HE: Record<string, string> = {
    static: 'סטטית', dynamic: 'דינמית', readiness: 'כוננות', rest: 'מנוחה', other: 'אחרת',
  };
  const median = (xs: number[]): number => {
    const s = [...xs].sort((a, b) => a - b);
    const mid = (s.length - 1) / 2;
    return (s[Math.floor(mid)] + s[Math.ceil(mid)]) / 2;
  };

  /** Snapshot of why `st` was picked for `slot`, built BEFORE assign() mutates
   *  state. Comparative claims use the primary candidate group at pick time. */
  function buildRationale(st: SoldierState, slot: Slot, pid: number, opts: {
    pickedFrom: 'primary' | 'rest' | 'fallback';
    fitReasons: FitReason[];
    commanderSeat: boolean;
    groupNights: number[]; groupLoads: number[];   // pre-pick primary snapshot
    myNights: number; myLoad: number;
  }): RationaleEntry[] {
    const out: RationaleEntry[] = [...st.level1Rationale];

    // rest before this shift (R1/R2/R5)
    const ri = restInfo(st, slot.period[0]);
    if (ri.gap === Infinity) out.push({ code: 'no_prior' });
    else if (ri.dutyRest) out.push({ code: 'duty_rest', params: { position: ri.dutyPosition ?? '' } });
    else if (ri.gap >= REST_IDEAL) {
      out.push({
        code: 'rest_ok',
        params: { lastEnd: fmtHM(ri.prevEnd!), restH: (ri.gap / 60).toFixed(1), start: fmtHM(slot.period[0]) },
      });
    } else if (opts.pickedFrom === 'primary') {
      out.push({ code: 'caveat_short_rest', params: { restH: (ri.gap / 60).toFixed(1) } });
    }

    // rotation facts — the dominant T-rule comes straight from rotationPenalty()
    const pos = ctx.positions.get(pid);
    const cls = pos?.missionClass ?? '';
    const yPos = ctx.yesterdayPosition.get(st.soldier.id);
    const yName = yPos !== undefined ? ctx.positions.get(yPos)?.name : undefined;
    const streak = ctx.staticStreak.get(st.soldier.id) ?? 0;
    switch (rotationPenalty(st, pid).tag) {
      case 'continuity': break;   // staying put is the point — continuity_crew covers it
      case 'static_streak': out.push({ code: 'caveat_static_streak', params: { streak } }); break;
      case 'same_position': out.push({ code: 'caveat_same_position', params: { position: yName ?? pos?.name ?? '' } }); break;
      case 'same_class': out.push({ code: 'caveat_same_class', params: { cls: CLASS_HE[cls] ?? cls } }); break;
      case 'break_static': out.push({ code: 'rotation_break_static', params: { streak } }); break;
      default:
        if (yName && yName !== pos?.name) {
          out.push({ code: 'rotation_switch', params: { yesterday: yName, today: pos?.name ?? '' } });
        }
    }

    // one comparative fairness claim, only against a real group (>1 candidate)
    if (opts.pickedFrom === 'primary' && opts.groupNights.length > 1) {
      const mN = median(opts.groupNights);
      const mL = median(opts.groupLoads);
      if (opts.myNights <= mN) {
        out.push({ code: 'fewest_nights', params: { nights: opts.myNights, median: mN } });
      } else if (opts.myLoad <= mL) {
        out.push({ code: 'low_load', params: { hours: opts.myLoad.toFixed(1), median: mL.toFixed(1) } });
      }
    }

    if (opts.commanderSeat) out.push({ code: 'commander_seat' });

    // fallback paths: the primary list was empty by construction
    if (opts.pickedFrom === 'rest') {
      out.push({ code: 'pulled_from_rest' }, { code: 'caveat_no_alternative' });
    } else if (opts.pickedFrom === 'fallback') {
      for (const r of opts.fitReasons) {
        const code = FIT_RATIONALE[r.code];
        if (code) out.push({ code });
      }
      out.push({ code: 'caveat_no_alternative' });
    }
    return out;
  }

  function assign(st: SoldierState, slot: Slot, seat: number, commanderSeat: boolean, viol: string[],
                  source: 'auto' | 'chain' = 'auto', rationale: RationaleEntry[] = []) {
    const readiness = ctx.positions.get(slot.positionId)!.missionClass === 'readiness';
    assignments.push({
      soldierId: st.soldier.id, positionId: slot.positionId, subPositionId: slot.subPositionId,
      period: slot.period, seatIndex: seat, isCommanderSeat: commanderSeat,
      blocksOverlap: !readiness, source, violations: viol, rationale,
    });
    if (readiness) {
      st.readiness.push(slot.period);
    } else {
      st.intervals.push(slot.period);
      st.missionHoursToday += countedHours(slot.period);
      // night_exempt 24h duties (תורנים/קצין מוצב) span 00-06 but the soldier
      // sleeps — they don't count toward P2 night fairness
      const pos = ctx.positions.get(slot.positionId);
      if (overlaps(slot.period, night)
        && isCountedNight(pos?.missionClass ?? '', pos?.config?.night_exempt)) st.nightsToday++;
    }
  }

  for (const [pid, slots] of slotsByPosition) {
    const posName = ctx.positions.get(pid)!.name;

    // Seat-rule positions: each sub-position slot goes to its planned candidate;
    // an unplanned seat stays empty (never completed from מנוחה or fallback).
    const plan = seatPlan.get(pid);
    if (plan) {
      const ruleMap = seatRuleBySub.get(pid)!;
      for (const slot of [...slots].sort((a, b) => a.period[0] - b.period[0])) {
        const subKey = nrm(slot.subName ?? '');
        const pick = plan.get(subKey);
        if (!pick) continue;   // empty seat — issue already raised in the pre-pass
        const nightExempt = ctx.positions.get(pid)?.config?.night_exempt ?? false;
        const isCmd = ruleMap.get(subKey)?.commander ?? false;
        if (isSeatPair(pick)) {
          const { d, a, handover } = pick;
          const firstHalf: [Minutes, Minutes] = [slot.period[0], handover];
          const secondHalf: [Minutes, Minutes] = [handover, slot.period[1]];
          const fd = fits(d, firstHalf, false, false, nightExempt);
          const fa = fits(a, secondHalf, false, false, nightExempt);
          if (!fd.ok || !fa.ok) {
            const bad = !fd.ok ? d : a;
            const reasons = fitTexts((!fd.ok ? fd : fa).reasons).join(', ');
            issues.push(`${posName} ${slot.subName}: ${bad.soldier.name} חסום (${reasons}) — המושב נשאר ריק`);
            continue;
          }
          const note = `זוג מתחלף: החלפה ב-${fmtHM(handover)}`;
          assign(d, { ...slot, period: firstHalf }, 1, isCmd, [note], 'auto',
            [...buildRationale(d, { ...slot, period: firstHalf }, pid, {
              pickedFrom: 'primary', fitReasons: fd.reasons, commanderSeat: false,
              groupNights: [], groupLoads: [], myNights: 0, myLoad: 0,
            }), { code: 'handover_out', params: { handover: fmtHM(handover), partner: a.soldier.name } }]);
          assign(a, { ...slot, period: secondHalf }, 1, isCmd, [note], 'auto',
            [...buildRationale(a, { ...slot, period: secondHalf }, pid, {
              pickedFrom: 'primary', fitReasons: fa.reasons, commanderSeat: false,
              groupNights: [], groupLoads: [], myNights: 0, myLoad: 0,
            }), { code: 'handover_in', params: { handover: fmtHM(handover), partner: d.soldier.name } }]);
          continue;
        }
        const st = pick;
        const fit = fits(st, slot.period, false, false, nightExempt);
        if (!fit.ok) {
          issues.push(`${posName} ${slot.subName}: ${st.soldier.name} חסום (${fitTexts(fit.reasons).join(', ')}) — המושב נשאר ריק`);
          continue;
        }
        const rationale = buildRationale(st, slot, pid, {
          pickedFrom: 'primary', fitReasons: fit.reasons, commanderSeat: false,
          groupNights: [], groupLoads: [], myNights: 0, myLoad: 0,
        });
        assign(st, slot, 1, isCmd,
          fit.reasons.map((r) => fit.fallback ? `בדוחק: ${fitText(r)}` : fitText(r)), 'auto', rationale);
      }
      continue;
    }

    // staff_all_roles crew (חמל): everyone in the group takes a seat, no demand math
    if (ctx.positions.get(pid)!.config?.staff_all_roles) {
      const crew = rank([...state.values()].filter((st) => st.level1 === pid), pid, false);
      for (const slot of [...slots].sort((a, b) => a.period[0] - b.period[0])) {
        let seat = 1;
        for (const st of crew) {
          if (seat > slot.seats) break;
          const fit = fits(st, slot.period, false, true);
          if (!fit.ok) continue;
          assign(st, slot, seat++, false, [], 'auto', buildRationale(st, slot, pid, {
            pickedFrom: 'primary', fitReasons: [], commanderSeat: false,
            groupNights: [], groupLoads: [], myNights: 0, myLoad: 0,
          }));
        }
      }
      continue;
    }

    const group = [...state.values()].filter((st) => st.level1 === pid);
    const sorted = [...slots].sort((a, b) => a.period[0] - b.period[0]);
    for (const slot of sorted) {
      const slotReadiness = ctx.positions.get(slot.positionId)!.missionClass === 'readiness';
      const slotNightExempt = ctx.positions.get(slot.positionId)!.config?.night_exempt ?? false;
      const takenThisSlot = new Set<number>();   // H7: no duplicate soldier in a crew
      for (let seat = 1; seat <= slot.seats; seat++) {
        const commanderSeat = slot.commanderFirstSeat && seat === 1;
        const forNight = overlaps(slot.period, night);
        const evals = group
          .filter((st) => !takenThisSlot.has(st.soldier.id))
          .map((st) => ({ st, fit: fits(st, slot.period, commanderSeat, slotReadiness, slotNightExempt) }));
        const primary = evals.filter((e) => e.fit.ok && !e.fit.fallback).map((e) => e.st);
        const fallback = evals.filter((e) => e.fit.ok && e.fit.fallback);
        // pre-pick snapshot of the primary group's fairness keys (the exact
        // formulas rank() uses) — comparative rationale must not drift with
        // later state
        const groupNights = primary.map((st) => nightsOf(st, forNight));
        const groupLoads = primary.map(loadOf);
        let picked = rank(primary, pid, forNight, slot.period[0])[0];
        let pickedFrom: 'primary' | 'rest' | 'fallback' = 'primary';
        let viol: string[] = [];
        if (!picked) {
          // prefer a fully-rested soldier from מנוחה over an in-group בדוחק pick
          const resters = [...state.values()].filter((st) => st.level1 === restId
            && allowedIn(st.soldier, posName)
            && (!commanderSeat || st.soldier.isCommander));
          const fitting = resters.filter((st) => {
            const f = fits(st, slot.period, commanderSeat, slotReadiness, slotNightExempt);
            return f.ok && !f.fallback;
          });
          const pulled = rank(fitting, pid, forNight, slot.period[0])[0];
          if (pulled) {
            pulled.level1 = pid;
            level1.set(pulled.soldier.id, pid);
            group.push(pulled);
            picked = pulled;
            pickedFrom = 'rest';
            viol = ['הושלם ממנוחה'];
          }
        }
        if (!picked && !slotReadiness) {
          // H1 replacement pair: a departing soldier (available from the slot
          // start until his unavailability begins) and an arriving one
          // (available once his unavailability ends) split the seat at the
          // handover — the departing soldier's leave time (bus-at-10:00
          // semantics: both blocks meet at 10:00). Completion mechanism only,
          // like the pull-from-מנוחה path: runs when no single fully-available
          // candidate exists, and both halves must pass every other hard rule
          // cleanly (rest floor, daily cap, role gates, whitelists — no בדוחק
          // halves). Seat-rule / staff_all_roles positions and chained
          // overlays never reach this loop, so pairs don't apply there.
          const pool = [...state.values()].filter((st) =>
            !takenThisSlot.has(st.soldier.id)
            && (st.level1 === pid || st.level1 === restId)
            && allowedIn(st.soldier, posName)
            && (!commanderSeat || st.soldier.isCommander));
          const dep = new Map<SoldierState, Minutes>();
          const arr = new Map<SoldierState, Minutes>();
          for (const st of pool) {
            const w = partialWindow(st.soldier.id, slot.period);
            if (w?.kind === 'departing') dep.set(st, w.at);
            else if (w?.kind === 'arriving') arr.set(st, w.at);
          }
          let paired = false;
          pairSearch:
          for (const d of rank([...dep.keys()], pid, forNight, slot.period[0])) {
            const handover = dep.get(d)!;
            const firstHalf: [Minutes, Minutes] = [slot.period[0], handover];
            const fd = fits(d, firstHalf, commanderSeat, false, slotNightExempt);
            if (!fd.ok || fd.fallback) continue;
            const back = [...arr.keys()].filter((st) => arr.get(st)! <= handover);
            for (const a of rank(back, pid, forNight, handover)) {
              const secondHalf: [Minutes, Minutes] = [handover, slot.period[1]];
              const fa = fits(a, secondHalf, commanderSeat, false, slotNightExempt);
              if (!fa.ok || fa.fallback) continue;
              for (const st of [d, a]) {
                if (st.level1 !== pid) {
                  st.level1 = pid; level1.set(st.soldier.id, pid); group.push(st);
                }
                takenThisSlot.add(st.soldier.id);
              }
              const note = `זוג מתחלף: החלפה ב-${fmtHM(handover)}`;
              assign(d, { ...slot, period: firstHalf }, seat, commanderSeat, [note], 'auto',
                [...buildRationale(d, { ...slot, period: firstHalf }, pid, {
                  pickedFrom: 'primary', fitReasons: fd.reasons, commanderSeat,
                  groupNights: [], groupLoads: [], myNights: 0, myLoad: 0,
                }), { code: 'handover_out', params: { handover: fmtHM(handover), partner: a.soldier.name } }]);
              assign(a, { ...slot, period: secondHalf }, seat, commanderSeat, [note], 'auto',
                [...buildRationale(a, { ...slot, period: secondHalf }, pid, {
                  pickedFrom: 'primary', fitReasons: fa.reasons, commanderSeat,
                  groupNights: [], groupLoads: [], myNights: 0, myLoad: 0,
                }), { code: 'handover_in', params: { handover: fmtHM(handover), partner: d.soldier.name } }]);
              paired = true;
              break pairSearch;
            }
          }
          if (paired) continue;   // seat covered by the pair — next seat
        }
        if (!picked && fallback.length) {
          const f = rank(fallback.map((e) => e.st), pid, forNight, slot.period[0])[0];
          const fe = fallback.find((e) => e.st === f)!;
          picked = f; pickedFrom = 'fallback';
          viol = fe.fit.reasons.map((r) => `בדוחק: ${fitText(r)}`);
        }
        if (!picked) {
          issues.push(`${posName} ${fmtHM(slot.period[0])}-${fmtHM(slot.period[1])} מושב ${seat}${commanderSeat ? ' (מפקד)' : ''}: לא אויש`);
          continue;
        }
        takenThisSlot.add(picked.soldier.id);
        const fit = fits(picked, slot.period, commanderSeat, slotReadiness, slotNightExempt);
        const rationale = buildRationale(picked, slot, pid, {
          pickedFrom, fitReasons: fit.reasons, commanderSeat, groupNights, groupLoads,
          myNights: nightsOf(picked, forNight), myLoad: loadOf(picked),
        });
        assign(picked, slot, seat, commanderSeat,
          [...viol, ...(viol.length ? [] : fitTexts(fit.reasons))], 'auto', rationale);
      }
    }
  }

  // ── Chains (T4): overlay readiness rows from descending crews ───────────
  const newByPosStart = (pid: number, startMin: Minutes) =>
    assignments.filter((a) => a.positionId === pid && a.period[0] === startMin);

  for (const rule of ctx.chainRules) {
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
      issues.push(`שרשור ${targetName} ${rule.targetStart}: לא נמצא צוות מקור`);
      continue;
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

    let pool = crew.map((id) => state.get(id)!).filter(Boolean)
      .filter((st) => !isBlocked(st.soldier.id, targetSlots[0].period))
      // a soldier already on a mission during the window can't stand by for it
      .filter((st) => !st.intervals.some((iv) => overlaps(iv, targetSlots[0].period)))
      // nor can they hold two simultaneous standbys (e.g. התקפי + כרמל)
      .filter((st) => !st.readiness.some((iv) => overlaps(iv, targetSlots[0].period)))
      // H6c: whitelisted soldiers take only their allowed positions, chains included
      .filter((st) => allowedIn(st.soldier, targetName));

    if (rule.pick === 'min_tracker_hours') {
      pool.sort((a, b) => (a.fairness.trackerHoursTotal + a.trackerMinutes / 60)
        - (b.fairness.trackerHoursTotal + b.trackerMinutes / 60));
      pool = pool.slice(0, 1);
    }

    let commanderAssigned = false;
    for (const slot of targetSlots) {
      const isCmdSlot = slot.subName === 'מפקד כרמל חטיבה';
      const take = isCmdSlot
        ? [...pool].sort((a, b) => b.soldier.rifle - a.soldier.rifle).slice(0, slot.seats)
        : pool.filter((st) => !assignments.some((a) => a.soldierId === st.soldier.id && a.period[0] === slot.period[0] && a.positionId === rule.targetPosition)).slice(0, slot.seats);
      take.forEach((st, i) => {
        const rationale: RationaleEntry[] = [{
          code: 'chain',
          params: { target: targetName, source: sourceName, sourceStart: rule.sourceStart },
        }];
        if (rule.pick === 'min_tracker_hours') rationale.push({ code: 'chain_min_tracker' });
        if (isCmdSlot) rationale.push({ code: 'chain_commander' });
        assign(st, slot, i + 1, isCmdSlot, [], 'chain', rationale);
        if (st.trackerMinutes === 0 && targetName === 'כונן גשש') st.trackerMinutes += slot.period[1] - slot.period[0];
        if (isCmdSlot) commanderAssigned = true;
      });
      if (take.length < slot.seats) {
        issues.push(`שרשור ${targetName} ${rule.targetStart}: אוישו ${take.length}/${slot.seats}`);
      }
    }
    if (targetName === 'כרמל חטיבה' && !commanderAssigned) {
      issues.push(`כרמל חטיבה ${rule.targetStart}: אין מפקד (רובאי בכיר)`);
    }
  }

  return { day, assignments, level1, issues };
}

// ── persistence ─────────────────────────────────────────────────────────────

export async function persist(res: GenerateResult): Promise<Finding[]> {
  const { day } = res;
  // Batched: 2 multi-row inserts inside one transaction — row-by-row inserts
  // over the WAN pooler take ~12s/day, past Vercel's 10s function limit.
  const dayRows = [...res.level1].map(([sid, pid]) => ({ sid, pid }));
  const dv: unknown[] = [day];
  const dTuples = dayRows.map(({ sid, pid }) => {
    dv.push(sid, pid);
    return `($1::date, $${dv.length - 1}, $${dv.length}, 'auto')`;
  });
  const sv: unknown[] = [day];
  const sTuples = res.assignments.map((a) => {
    sv.push(a.positionId, a.subPositionId, a.soldierId,
      minToIso(a.period[0]), minToIso(a.period[1]),
      a.seatIndex, a.isCommanderSeat, a.source, a.blocksOverlap,
      JSON.stringify(a.violations), JSON.stringify(a.rationale));
    const b = sv.length - 11;
    return `($1::date, $${b + 1}, $${b + 2}, $${b + 3},` +
      ` tsrange($${b + 4}::timestamp, $${b + 5}::timestamp),` +
      ` $${b + 6}, $${b + 7}, $${b + 8}, $${b + 9}, $${b + 10}::jsonb, $${b + 11}::jsonb)`;
  });

  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(
      `delete from shift_assignments where day = $1 and source in ('auto','chain') and not locked`, [day]);
    await client.query(
      `delete from day_assignments where day = $1 and source in ('auto','chain') and not locked`, [day]);
    // Daily missions extend past the day boundary; regenerating day D can
    // therefore conflict with a stale draft of D+1. Remove only the future
    // unlocked draft rows that actually collide — regenerating a range
    // rebuilds them in order, and the validator flags any hole left behind.
    const clashed = await client.query(
      `delete from shift_assignments f
       using unnest($2::bigint[], $3::tsrange[]) as n(sid, p)
       where f.day > $1::date and f.source in ('auto','chain') and not f.locked
         and f.soldier_id = n.sid and f.period && n.p
       returning f.day`,
      [day,
        res.assignments.map((a) => a.soldierId),
        res.assignments.map((a) => `[${minToIso(a.period[0])},${minToIso(a.period[1])})`)]);
    if (clashed.rowCount) {
      res.issues.push(`הוסרו ${clashed.rowCount} שיבוצים מתנגשים מטיוטות של ימים עתידיים — יש לחולל אותם מחדש`);
    }
    if (dTuples.length) {
      await client.query(
        `insert into day_assignments (day, soldier_id, position_id, source)
         values ${dTuples.join(',')} on conflict (day, soldier_id) do nothing`, dv);
    }
    if (sTuples.length) {
      await client.query(
        `insert into shift_assignments
           (day, position_id, sub_position_id, soldier_id, period, seat_index,
            is_commander_seat, source, blocks_overlap, violations, rationale)
         values ${sTuples.join(',')}`, sv);
    }
    await client.query(
      `update schedule_days set status = 'generated', generated_at = now() where day = $1`, [day]);
    await client.query('commit');
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
  return validateAndStore(day);
}
