import { pool } from './db.js';
import { loadContext } from './load.js';
import { validateAndStore, Finding } from './validate.js';
import { Soldier, Slot, Assignment, Fairness } from './model.js';
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
    };
    state.set(s.id, st);
  }

  const isBlocked = (sid: number, p: [Minutes, Minutes]) =>
    (ctx.blocked.get(sid) ?? []).some((b) => overlaps(b, p));
  const fullyBlocked = (sid: number) => isBlocked(sid, dRange) &&
    (ctx.blocked.get(sid) ?? []).some((b) => b[0] <= dRange[0] && b[1] >= dRange[1]);

  /** Rest gap before `start` (minutes); readiness is transparent (R2);
   *  R5: an attack ending by ~06:00 counts as full rest for >= 14:00 starts. */
  function restBefore(st: SoldierState, start: Minutes): number {
    let prevEnd = -Infinity;
    let prevWasAttack = false;
    for (const iv of st.intervals) {
      if (iv[1] <= start && iv[1] > prevEnd) {
        prevEnd = iv[1];
        prevWasAttack = false; // recomputed below
      }
    }
    if (prevEnd === -Infinity) return Infinity;
    if (attackId !== undefined) {
      const ex = ctx.existing.get(st.soldier.id) ?? [];
      prevWasAttack = ex.some((a) => a.positionId === attackId && a.period[1] === prevEnd);
    }
    const gap = start - prevEnd;
    if (prevWasAttack && start >= dRange[0]) return Math.max(gap, REST_IDEAL); // R5
    return gap;
  }

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

  // Continuity pre-pass (מגן): returning crew members are reserved BEFORE any
  // other position can grab them — the crew repeats day-to-day unless seats
  // shrink, a member is unavailable, or a manual/locked change intervenes.
  for (const pos of ctx.positions.values()) {
    if (!pos.config?.continuity || !slotsByPosition.has(pos.id)) continue;
    let room = demand(pos.id, slotsByPosition.get(pos.id)!)
      - [...level1.values()].filter((p) => p === pos.id).length;
    const returning = [...state.values()].filter((st) =>
      st.level1 === null && !fullyBlocked(st.soldier.id)
      && ctx.yesterdayPosition.get(st.soldier.id) === pos.id);
    for (const st of rank(returning, pos.id, false)) {
      if (room <= 0) break;
      st.level1 = pos.id; level1.set(st.soldier.id, pos.id); room--;
    }
  }

  for (const posName of order) {
    const pid = ctx.positionByName.get(posName);
    if (pid === undefined || !slotsByPosition.has(pid)) continue;
    const pos = ctx.positions.get(pid)!;
    const slots = slotsByPosition.get(pid)!;
    const attached = attachedByHost.get(pid) ?? [];
    let need = demand(pid, slots) - [...level1.values()].filter((p) => p === pid).length;
    let cmdNeed = commanderQuota(slots, attached);

    const eligible = (st: SoldierState) => {
      const s = st.soldier;
      if (st.level1 !== null || fullyBlocked(s.id)) return false;
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
  for (const st of state.values()) {
    if (st.level1 === null) { st.level1 = restId; level1.set(st.soldier.id, restId); }
  }

  // ── Level 2: fill slots within each position group ──────────────────────
  const assignments: Assignment[] = [];

  function assign(st: SoldierState, slot: Slot, seat: number, commanderSeat: boolean, viol: string[], source: 'auto' | 'chain' = 'auto') {
    const readiness = ctx.positions.get(slot.positionId)!.missionClass === 'readiness';
    assignments.push({
      soldierId: st.soldier.id, positionId: slot.positionId, subPositionId: slot.subPositionId,
      period: slot.period, seatIndex: seat, isCommanderSeat: commanderSeat,
      blocksOverlap: !readiness, source, violations: viol,
    });
    if (readiness) {
      st.readiness.push(slot.period);
    } else {
      st.intervals.push(slot.period);
      st.missionHoursToday += countedHours(slot.period);
      if (overlaps(slot.period, night)) st.nightsToday++;
    }
  }

  for (const [pid, slots] of slotsByPosition) {
    const posName = ctx.positions.get(pid)!.name;
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
        let picked = rank(primary, pid, forNight, slot.period[0])[0];
        let viol: string[] = [];
        if (!picked) {
          // prefer a fully-rested soldier from מנוחה over an in-group בדוחק pick
          const resters = [...state.values()].filter((st) => st.level1 === restId
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
            viol = ['הושלם ממנוחה'];
          }
        }
        if (!picked && fallback.length) {
          const f = rank(fallback.map((e) => e.st), pid, forNight, slot.period[0])[0];
          const fe = fallback.find((e) => e.st === f)!;
          picked = f; viol = fe.fit.reasons.map((r) => `בדוחק: ${r}`);
        }
        if (!picked) {
          issues.push(`${posName} ${fmtHM(slot.period[0])}-${fmtHM(slot.period[1])} מושב ${seat}${commanderSeat ? ' (מפקד)' : ''}: לא אויש`);
          continue;
        }
        takenThisSlot.add(picked.soldier.id);
        const fit = fits(picked, slot.period, commanderSeat, slotReadiness);
        assign(picked, slot, seat, commanderSeat, [...viol, ...(viol.length ? [] : fit.reasons)]);
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
      .filter((st) => !st.readiness.some((iv) => overlaps(iv, targetSlots[0].period)));

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
        assign(st, slot, i + 1, isCmdSlot, [], 'chain');
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
      JSON.stringify(a.violations));
    const b = sv.length - 10;
    return `($1::date, $${b + 1}, $${b + 2}, $${b + 3},` +
      ` tsrange($${b + 4}::timestamp, $${b + 5}::timestamp),` +
      ` $${b + 6}, $${b + 7}, $${b + 8}, $${b + 9}, $${b + 10}::jsonb)`;
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
            is_commander_seat, source, blocks_overlap, violations)
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
