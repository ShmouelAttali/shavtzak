import { query } from './db.js';
import { loadContext } from './load.js';
import { Context, Soldier, Slot, Assignment, Fairness } from './model.js';
import {
  Minutes, dayStart, dayEnd, addDays, slotStart, overlaps, hours, minToIso, fmtHM, nightRange,
} from './time.js';

const REST_MIN = 4 * 60;          // H8 hard floor
const REST_IDEAL = 8 * 60;        // R1
const LONG_TASK = 4 * 60;         // R1: tasks longer than this need ideal rest
const DAILY_CAP = 8;              // R4 (counted hours)
const OVERLAY = new Set(['כוננות', 'כרמל חטיבה', 'כונן גשש']); // chained, not Level-1
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
      missionHoursToday: ex
        .filter((a) => a.missionClass !== 'readiness' && overlaps(a.period, dRange))
        .reduce((h, a) => h + countedHours([Math.max(a.period[0], dRange[0]), Math.min(a.period[1], dRange[1])]), 0),
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
  function fits(st: SoldierState, slot: [Minutes, Minutes], commanderSeat: boolean): Fit {
    const s = st.soldier;
    const reasons: string[] = [];
    if (commanderSeat && !s.isCommander) return { ok: false, fallback: false, reasons: ['לא מפקד'] };
    if (isBlocked(s.id, slot)) return { ok: false, fallback: false, reasons: ['לא זמין'] };
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

  /** Rotation penalty per T1-T3 (lower = better). */
  function rotationPenalty(st: SoldierState, positionId: number): number {
    const cls = ctx.positions.get(positionId)?.missionClass;
    const yPos = ctx.yesterdayPosition.get(st.soldier.id);
    const yCls = yPos !== undefined ? ctx.positions.get(yPos)?.missionClass : undefined;
    const streak = ctx.staticStreak.get(st.soldier.id) ?? 0;
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

  /** distinct soldiers needed = max(concurrent seats, ceil(counted-hours / 8)) */
  function demand(slots: Slot[]): number {
    const totalHours = slots.reduce((h, s) => h + countedHours(s.period) * s.seats, 0);
    let concurrent = 0;
    for (const s of slots) {
      const c = slots.filter((o) => overlaps(o.period, s.period)).reduce((n, o) => n + o.seats, 0);
      concurrent = Math.max(concurrent, c);
    }
    return Math.max(concurrent, Math.ceil(totalHours / DAILY_CAP - 0.01));
  }

  /** commanders needed: one per commander-first slot start */
  const commanderQuota = (slots: Slot[]) =>
    new Set(slots.filter((s) => s.commanderFirstSeat).map((s) => s.period[0])).size;

  // honor Level-1 locks first
  for (const [sid, pid] of ctx.lockedDay) {
    const st = state.get(sid);
    if (st) st.level1 = pid;
  }

  // fill order: role-gated / commander-heavy first
  const order = ['קצין מוצב', 'סיור', 'תגבצ', 'עמדות הגנה', 'מגן + תגבצ', 'חפק', 'תורנים'];
  const level1 = new Map<number, number>();
  for (const [sid, pid] of ctx.lockedDay) level1.set(sid, pid);

  for (const posName of order) {
    const pid = ctx.positionByName.get(posName);
    if (pid === undefined || !slotsByPosition.has(pid)) continue;
    const slots = slotsByPosition.get(pid)!;
    const pos = ctx.positions.get(pid)!;
    let need = demand(slots) - [...level1.values()].filter((p) => p === pid).length;
    let cmdNeed = commanderQuota(slots);

    const free = [...state.values()].filter((st) => {
      const s = st.soldier;
      if (st.level1 !== null || fullyBlocked(s.id)) return false;
      if (posName === 'קצין מוצב' && !s.isSeniorCommander) return false;         // H6
      if (posName === 'עמדות הגנה' && s.isSeniorCommander) return false;         // H6
      // boundary rule: heavily occupied by yesterday's tail -> rest today
      if (st.missionHoursToday >= DAILY_CAP / 2) return false;
      return true;
    });

    // For positions whose work is anchored to few starts (תגבצ, daily
    // missions) rank by rest before the earliest slot too — avoids picking
    // soldiers who came off a shift 3h before the position starts.
    const starts = [...new Set(slots.map((s) => s.period[0]))];
    const atStart = starts.length <= 2 ? Math.min(...starts) : undefined;

    // commanders first (P5 quota), then everyone remaining
    if (cmdNeed > 0) {
      for (const st of rank(free.filter((c) => c.soldier.isCommander), pid, false, atStart)) {
        if (cmdNeed <= 0 || need <= 0) break;
        st.level1 = pid; level1.set(st.soldier.id, pid); need--; cmdNeed--;
      }
      if (cmdNeed > 0) issues.push(`${posName}: חסרים ${cmdNeed} מפקדים בשיבוץ היומי`);
    }
    for (const st of rank(free.filter((c) => c.level1 === null), pid, false, atStart)) {
      if (need <= 0) break;
      st.level1 = pid; level1.set(st.soldier.id, pid); need--;
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
    const sorted = [...slots].sort((a, b) => a.period[0] - b.period[0]);
    for (const slot of sorted) {
      for (let seat = 1; seat <= slot.seats; seat++) {
        const commanderSeat = slot.commanderFirstSeat && seat === 1;
        const forNight = overlaps(slot.period, night);
        const evals = group.map((st) => ({ st, fit: fits(st, slot.period, commanderSeat) }));
        const primary = evals.filter((e) => e.fit.ok && !e.fit.fallback).map((e) => e.st);
        const fallback = evals.filter((e) => e.fit.ok && e.fit.fallback);
        let picked = rank(primary, pid, forNight, slot.period[0])[0];
        let viol: string[] = [];
        if (!picked) {
          // prefer a fully-rested soldier from מנוחה over an in-group בדוחק pick
          const resters = [...state.values()].filter((st) => st.level1 === restId
            && (!commanderSeat || st.soldier.isCommander));
          const fitting = resters.filter((st) => {
            const f = fits(st, slot.period, commanderSeat);
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
        const fit = fits(picked, slot.period, commanderSeat);
        assign(picked, slot, seat, commanderSeat, [...viol, ...fit.reasons.filter((r) => !viol.length)]);
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
    // konenut windows subdivide the daily readiness slot (SPEC §2) — always
    // synthesize the 8h window instead of matching the 24h template slot.
    let targetSlots = targetName === 'כוננות' ? [] : ctx.slots
      .filter((s) => s.positionId === rule.targetPosition && s.period[0] === tStart)
      .sort((a, b) => (b.subName === 'מפקד כרמל חטיבה' ? 1 : 0) - (a.subName === 'מפקד כרמל חטיבה' ? 1 : 0));
    if (targetSlots.length === 0) {
      targetSlots = [{
        positionId: rule.targetPosition, subPositionId: null, subName: null,
        period: [tStart, tStart + 8 * 60], seats: crew.length, commanderFirstSeat: false,
      }];
    }

    let pool = crew.map((id) => state.get(id)!).filter(Boolean)
      .filter((st) => !isBlocked(st.soldier.id, targetSlots[0].period));

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

export async function persist(res: GenerateResult): Promise<void> {
  const { day } = res;
  await query(`delete from shift_assignments where day = $1 and source in ('auto','chain') and not locked`, [day]);
  await query(`delete from day_assignments where day = $1 and source in ('auto','chain') and not locked`, [day]);
  for (const [sid, pid] of res.level1) {
    await query(
      `insert into day_assignments (day, soldier_id, position_id, source)
       values ($1,$2,$3,'auto') on conflict (day, soldier_id) do nothing`,
      [day, sid, pid],
    );
  }
  for (const a of res.assignments) {
    await query(
      `insert into shift_assignments
         (day, position_id, sub_position_id, soldier_id, period, seat_index,
          is_commander_seat, source, blocks_overlap, violations)
       values ($1,$2,$3,$4, tsrange($5::timestamp,$6::timestamp), $7,$8,$9,$10,$11)`,
      [day, a.positionId, a.subPositionId, a.soldierId,
        minToIso(a.period[0]), minToIso(a.period[1]),
        a.seatIndex, a.isCommanderSeat, a.source, a.blocksOverlap,
        JSON.stringify(a.violations)],
    );
  }
  await query(`update schedule_days set status = 'generated', generated_at = now() where day = $1`, [day]);
}
