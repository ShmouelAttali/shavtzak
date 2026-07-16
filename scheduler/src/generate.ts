import { pool } from './db.js';
import { loadContext } from './load.js';
import { validateAndStore, Finding } from './validate.js';
import { Soldier, Slot, Assignment, Fairness } from './model.js';
import { RationaleEntry } from './rationale.js';
import {
  Minutes, dayStart, dayEnd, addDays, slotStart, overlaps, hours, minToIso, fmtHM, nightRange,
} from './time.js';

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

interface SoldierState {
  soldier: Soldier;
  fairness: Fairness;
  /** blocking intervals: existing (blocks) + newly assigned, non-readiness */
  intervals: [Minutes, Minutes][];
  /** readiness intervals (don't block, don't reset rest) */
  readiness: [Minutes, Minutes][];
  missionHoursToday: number;
  /** clipped overlap of existing missions with today (incl. yesterday's tail) */
  occupiedHoursToday: number;
  nightsToday: number;
  trackerMinutes: number;
  level1: number | null;      // position id
  hadAttackYesterday: boolean;
  /** why this soldier landed in their Level-1 group (continuity/commander quota) */
  level1Rationale: RationaleEntry[];
}

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
  const attackId = ctx.positionByName.get('התקפי');

  // ── per-soldier state ────────────────────────────────────────────────────
  const state = new Map<number, SoldierState>();
  for (const s of ctx.soldiers.values()) {
    const ex = ctx.existing.get(s.id) ?? [];
    const yRange: [Minutes, Minutes] = [dayStart(addDays(day, -1)), dayEnd(addDays(day, -1))];
    const st: SoldierState = {
      soldier: s,
      fairness: ctx.fairness.get(s.id) ?? EMPTY_FAIRNESS,
      intervals: ex.filter((a) => a.missionClass !== 'readiness').map((a) => a.period),
      readiness: ex.filter((a) => a.missionClass === 'readiness').map((a) => a.period),
      // R4 accounting per SPEC §2: an assignment's counted hours belong to the
      // schedule day containing its START (a daily mission's tail does NOT
      // consume the next day's cap — else continuity crews could never repeat).
      missionHoursToday: ex
        .filter((a) => a.missionClass !== 'readiness'
          && a.period[0] >= dRange[0] && a.period[0] < dRange[1])
        .reduce((h, a) => h + countedHours(a.period), 0),
      // yesterday's tail still occupies the soldier physically today
      occupiedHoursToday: ex
        .filter((a) => a.missionClass !== 'readiness' && overlaps(a.period, dRange))
        .reduce((h, a) => h + hours([Math.max(a.period[0], dRange[0]), Math.min(a.period[1], dRange[1])]), 0),
      nightsToday: 0,
      trackerMinutes: 0,
      level1: null,
      hadAttackYesterday: ex.some((a) => a.positionId === attackId && overlaps(a.period, yRange)),
      level1Rationale: [],
    };
    state.set(s.id, st);
  }

  const isBlocked = (sid: number, p: [Minutes, Minutes]) =>
    (ctx.blocked.get(sid) ?? []).some((b) => overlaps(b, p));
  const fullyBlocked = (sid: number) => isBlocked(sid, dRange) &&
    (ctx.blocked.get(sid) ?? []).some((b) => b[0] <= dRange[0] && b[1] >= dRange[1]);

  /** Rest facts before `start`; readiness is transparent (R2);
   *  R5: an attack ending by ~06:00 counts as full rest for >= 14:00 starts.
   *  `attackRest` is true only when the R5 boost actually lifted the gap. */
  function restInfo(st: SoldierState, start: Minutes): { gap: number; prevEnd: Minutes | null; attackRest: boolean } {
    let prevEnd = -Infinity;
    for (const iv of st.intervals) {
      if (iv[1] <= start && iv[1] > prevEnd) prevEnd = iv[1];
    }
    if (prevEnd === -Infinity) return { gap: Infinity, prevEnd: null, attackRest: false };
    let prevWasAttack = false;
    if (attackId !== undefined) {
      const ex = ctx.existing.get(st.soldier.id) ?? [];
      prevWasAttack = ex.some((a) => a.positionId === attackId && a.period[1] === prevEnd);
    }
    const gap = start - prevEnd;
    if (prevWasAttack && start >= dRange[0] && gap < REST_IDEAL) {
      return { gap: REST_IDEAL, prevEnd, attackRest: true }; // R5
    }
    return { gap, prevEnd, attackRest: false };
  }
  const restBefore = (st: SoldierState, start: Minutes): number => restInfo(st, start).gap;

  type Fit = { ok: boolean; fallback: boolean; reasons: string[] };
  function fits(st: SoldierState, slot: [Minutes, Minutes], commanderSeat: boolean, isReadiness = false): Fit {
    const s = st.soldier;
    const reasons: string[] = [];
    if (commanderSeat && !s.isCommander) return { ok: false, fallback: false, reasons: ['לא מפקד'] };
    if (isBlocked(s.id, slot)) return { ok: false, fallback: false, reasons: ['לא זמין'] };
    if (isReadiness) return { ok: true, fallback: false, reasons: [] }; // R2: rest-transparent, uncapped
    if (st.intervals.some((iv) => overlaps(iv, slot))) return { ok: false, fallback: false, reasons: ['חפיפה'] };
    const counted = countedHours(slot);
    if (st.missionHoursToday + counted > DAILY_CAP + 0.01) {
      return { ok: false, fallback: false, reasons: ['מעל 8 שעות ביום'] };
    }
    // R6: a third consecutive night is a violation — fallback-only
    if (overlaps(slot, night) && (ctx.nightStreak.get(s.id) ?? 0) + (st.nightsToday > 0 ? 1 : 0) >= 2) {
      return { ok: true, fallback: true, reasons: ['לילה שלישי ברצף'] };
    }
    const rest = restBefore(st, slot[0]);
    if (rest < REST_MIN) return { ok: true, fallback: true, reasons: ['פחות מ-4 שעות מנוחה'] };
    if (rest < REST_IDEAL && hours(slot) > LONG_TASK / 60) {
      return { ok: true, fallback: true, reasons: ['פחות מ-8 שעות מנוחה למשימה ארוכה'] };
    }
    if (rest < REST_IDEAL) reasons.push(`מנוחה קצרה: ${(rest / 60).toFixed(1)}ש`);
    return { ok: true, fallback: false, reasons };
  }

  /** Rotation penalty per T1-T3 (lower = better). Continuity positions
   *  (e.g. מגן) invert T1: staying in the same position is preferred. */
  function rotationPenalty(st: SoldierState, positionId: number): number {
    const pos = ctx.positions.get(positionId);
    const cls = pos?.missionClass;
    const yPos = ctx.yesterdayPosition.get(st.soldier.id);
    const yCls = yPos !== undefined ? ctx.positions.get(yPos)?.missionClass : undefined;
    const streak = ctx.staticStreak.get(st.soldier.id) ?? 0;
    if (pos?.config?.continuity) return yPos === positionId ? -2 : 0;
    if (streak >= 2 && cls === 'static') return 3;                 // T3 violation
    if (yPos === positionId) return 2;                             // T1
    if (yCls && cls && yCls === cls && cls !== 'other') return 1;  // T2
    if (streak >= 2 && cls === 'dynamic') return -1;               // T3 break bonus
    return 0;
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
        st.fairness.nightCount7d + st.nightsToday * (forNight ? 1 : 0),        // P2
        // P3 bucketed to one duty-day (8h): soldiers within the same load
        // bucket are equal, letting rotation (P4) actually decide.
        Math.floor((st.fairness.weightedHours7d + st.missionHoursToday) / 8),  // P3
        rotationPenalty(st, positionId),                                       // P4
        st.fairness.positionCounts[posName] ?? 0,                              // P4 (L1 balance)
        st.fairness.weightedHours7d + st.missionHoursToday,                    // P3 fine tie-break
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

  // Positions staffed by another position's crew (e.g. תגבצ ← התקפי): their
  // slots detach from Level 1 and are filled by the host's group in Level 2.
  const attachedByHost = new Map<number, Slot[]>();
  for (const p of ctx.positions.values()) {
    const hostName = p.config?.staffed_by;
    if (!hostName || !slotsByPosition.has(p.id)) continue;
    const hostId = ctx.positionByName.get(hostName);
    if (hostId === undefined) { issues.push(`${p.name}: staffed_by לא מוכר (${hostName})`); continue; }
    attachedByHost.set(hostId, [...(attachedByHost.get(hostId) ?? []), ...slotsByPosition.get(p.id)!]);
    slotsByPosition.delete(p.id);
  }

  /** distinct soldiers needed = max(concurrent seats, ceil(counted-hours / 8)).
   *  Readiness hosts (התקפי): crew size = concurrent seats of the readiness
   *  slot itself; attached mission windows are done by that same crew. */
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

  /** commanders needed: one per commander-first slot start of the position's
   *  own slots, +1 when attached slots need a commander (same crew covers all
   *  attached windows, so one commander suffices for them). */
  const commanderQuota = (own: Slot[], attached: Slot[]) =>
    new Set(own.filter((s) => s.commanderFirstSeat).map((s) => s.period[0])).size
    + (attached.some((s) => s.commanderFirstSeat) ? 1 : 0);

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
  interface SeatRule {
    sub: string; soldiers?: string[]; roles?: string[];
    ordered?: boolean; release_unpicked?: boolean; commander?: boolean;
  }
  const nrm = (s: string) => s.replace(/[״"׳']/g, '').trim();
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
  const seatPlan = new Map<number, Map<string, SoldierState>>();   // pid -> sub -> chosen
  const seatRuleBySub = new Map<number, Map<string, SeatRule>>();
  {
    const byName = new Map([...state.values()].map((st) => [nrm(st.soldier.name), st]));
    for (const pos of ctx.positions.values()) {
      const rules: SeatRule[] = pos.config?.seat_rules ?? [];
      if (!rules.length || !slotsByPosition.has(pos.id)) continue;
      const plan = new Map<string, SoldierState>();
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
    const attached = attachedByHost.get(pid) ?? [];
    let need = demand(pid, slots) - [...level1.values()].filter((p) => p === pid).length;
    let cmdNeed = commanderQuota(slots, attached);

    const eligible = (st: SoldierState) => {
      const s = st.soldier;
      if (st.level1 !== null || fullyBlocked(s.id)) return false;
      if (!allowedIn(s, posName)) return false;                                  // H6b/H6c: position whitelist
      // must be available for at least one of the position's slot windows
      // (a soldier leaving/arriving mid-day can't hold a window he'd miss)
      if (![...slots, ...attached].some((sl) => !isBlocked(s.id, sl.period))) return false;
      if (posName === 'קצין מוצב' && !s.isSeniorCommander) return false;         // H6
      if (posName === 'עמדות הגנה' && s.isSeniorCommander) return false;         // H6
      // boundary rule: heavily occupied by yesterday's tail -> rest today.
      // Continuity positions are exempt: their own tail is exactly what a
      // returning crew member carries (next slot starts after it ends).
      if (!pos.config?.continuity && st.occupiedHoursToday >= DAILY_CAP / 2) return false;
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
    const missionSlots = [...slots, ...attached].filter((s) =>
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
    fitReasons: string[];
    commanderSeat: boolean;
    groupNights: number[]; groupLoads: number[];   // pre-pick primary snapshot
    myNights: number; myLoad: number;
  }): RationaleEntry[] {
    const out: RationaleEntry[] = [...st.level1Rationale];

    // rest before this shift (R1/R2/R5)
    const ri = restInfo(st, slot.period[0]);
    if (ri.gap === Infinity) out.push({ code: 'no_prior' });
    else if (ri.attackRest) out.push({ code: 'attack_rest' });
    else if (ri.gap >= REST_IDEAL) {
      out.push({
        code: 'rest_ok',
        params: { lastEnd: fmtHM(ri.prevEnd!), restH: (ri.gap / 60).toFixed(1), start: fmtHM(slot.period[0]) },
      });
    } else if (opts.pickedFrom === 'primary') {
      out.push({ code: 'caveat_short_rest', params: { restH: (ri.gap / 60).toFixed(1) } });
    }

    // rotation facts — same order of dominance as rotationPenalty() (T1-T3)
    const pos = ctx.positions.get(pid);
    const cls = pos?.missionClass;
    const yPos = ctx.yesterdayPosition.get(st.soldier.id);
    const yName = yPos !== undefined ? ctx.positions.get(yPos)?.name : undefined;
    const yCls = yPos !== undefined ? ctx.positions.get(yPos)?.missionClass : undefined;
    const streak = ctx.staticStreak.get(st.soldier.id) ?? 0;
    if (pos?.config?.continuity) { /* staying put is the point — continuity_crew covers it */ }
    else if (streak >= 2 && cls === 'static') out.push({ code: 'caveat_static_streak', params: { streak } });
    else if (yPos === pid) out.push({ code: 'caveat_same_position', params: { position: yName ?? pos?.name ?? '' } });
    else if (yCls && cls && yCls === cls && cls !== 'other') {
      out.push({ code: 'caveat_same_class', params: { cls: CLASS_HE[cls] ?? cls } });
    } else if (streak >= 2 && cls === 'dynamic') out.push({ code: 'rotation_break_static', params: { streak } });
    else if (yName && yName !== pos?.name) {
      out.push({ code: 'rotation_switch', params: { yesterday: yName, today: pos?.name ?? '' } });
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
        if (r.includes('פחות מ-4')) out.push({ code: 'caveat_rest_lt4' });
        else if (r.includes('פחות מ-8')) out.push({ code: 'caveat_rest_lt8_long' });
        else if (r.includes('לילה שלישי')) out.push({ code: 'caveat_third_night' });
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
      if (overlaps(slot.period, night)
        && !ctx.positions.get(slot.positionId)?.config?.night_exempt) st.nightsToday++;
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
        const st = plan.get(subKey);
        if (!st) continue;   // empty seat — issue already raised in the pre-pass
        const fit = fits(st, slot.period, false, false);
        if (!fit.ok) {
          issues.push(`${posName} ${slot.subName}: ${st.soldier.name} חסום (${fit.reasons.join(', ')}) — המושב נשאר ריק`);
          continue;
        }
        const rationale = buildRationale(st, slot, pid, {
          pickedFrom: 'primary', fitReasons: fit.reasons, commanderSeat: false,
          groupNights: [], groupLoads: [], myNights: 0, myLoad: 0,
        });
        assign(st, slot, 1, ruleMap.get(subKey)?.commander ?? false,
          fit.fallback ? fit.reasons.map((r) => `בדוחק: ${r}`) : fit.reasons, 'auto', rationale);
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
    // attached slots (e.g. תגבצ windows) are filled from the host's crew
    const sorted = [...slots, ...(attachedByHost.get(pid) ?? [])]
      .sort((a, b) => a.period[0] - b.period[0]);
    for (const slot of sorted) {
      const slotReadiness = ctx.positions.get(slot.positionId)!.missionClass === 'readiness';
      const takenThisSlot = new Set<number>();   // H7: no duplicate soldier in a crew
      for (let seat = 1; seat <= slot.seats; seat++) {
        const commanderSeat = slot.commanderFirstSeat && seat === 1;
        const forNight = overlaps(slot.period, night);
        const evals = group
          .filter((st) => !takenThisSlot.has(st.soldier.id))
          .map((st) => ({ st, fit: fits(st, slot.period, commanderSeat, slotReadiness) }));
        const primary = evals.filter((e) => e.fit.ok && !e.fit.fallback).map((e) => e.st);
        const fallback = evals.filter((e) => e.fit.ok && e.fit.fallback);
        // pre-pick snapshot of the primary group's fairness keys (same formulas
        // rank() uses) — comparative rationale must not drift with later state
        const nightsOf = (st: SoldierState) => st.fairness.nightCount7d + st.nightsToday * (forNight ? 1 : 0);
        const loadOf = (st: SoldierState) => st.fairness.weightedHours7d + st.missionHoursToday;
        const groupNights = primary.map(nightsOf);
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
            const f = fits(st, slot.period, commanderSeat, slotReadiness);
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
        if (!picked && fallback.length) {
          const f = rank(fallback.map((e) => e.st), pid, forNight, slot.period[0])[0];
          const fe = fallback.find((e) => e.st === f)!;
          picked = f; pickedFrom = 'fallback';
          viol = fe.fit.reasons.map((r) => `בדוחק: ${r}`);
        }
        if (!picked) {
          issues.push(`${posName} ${fmtHM(slot.period[0])}-${fmtHM(slot.period[1])} מושב ${seat}${commanderSeat ? ' (מפקד)' : ''}: לא אויש`);
          continue;
        }
        takenThisSlot.add(picked.soldier.id);
        const fit = fits(picked, slot.period, commanderSeat, slotReadiness);
        const rationale = buildRationale(picked, slot, pid, {
          pickedFrom, fitReasons: fit.reasons, commanderSeat, groupNights, groupLoads,
          myNights: nightsOf(picked), myLoad: loadOf(picked),
        });
        assign(picked, slot, seat, commanderSeat, [...viol, ...(viol.length ? [] : fit.reasons)], 'auto', rationale);
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
