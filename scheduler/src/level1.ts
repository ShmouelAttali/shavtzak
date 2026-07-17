// Level 1 (SPEC §7): partition the available soldiers into positions + מנוחה
// for the schedule day — locks, the H6b seat-rule pre-pass, staff_all_roles
// crews, continuity crews, then the demand-driven fill in priority order.

import { Minutes, overlaps } from './time.js';
import { Slot, SeatRule } from './model.js';
import { normalizeName as nrm, hasQualification } from './text.js';
import { Gen, SoldierState, allowedIn, countedHours, fullyBlocked, isBlocked } from './state.js';
import { rank } from './rank.js';
import { partialWindow } from './pairs.js';

const OVERLAY = new Set(['כרמל חטיבה', 'כונן גשש']); // chained overlays, not Level-1

// A planned seat is one candidate, or (H6b pair handover) two candidates
// from the SAME dedicated list splitting the window at the handover.
export type SeatPair = { pair: true; d: SoldierState; a: SoldierState; handover: Minutes };
export type SeatPick = SoldierState | SeatPair;
export const isSeatPair = (p: SeatPick): p is SeatPair => 'pair' in p;

/** Level-1 outputs consumed by Level 2. */
export interface Level1Plan {
  slotsByPosition: Map<number, Slot[]>;
  seatPlan: Map<number, Map<string, SeatPick>>;      // pid -> sub -> chosen
  seatRuleBySub: Map<number, Map<string, SeatRule>>;
}

/** distinct soldiers needed = max(concurrent seats, ceil(counted-hours / cap)).
 *  Readiness positions (התקפי): crew size = concurrent seats of the
 *  readiness slot itself. */
export function demand(g: Gen, pid: number, slots: Slot[]): number {
  if (g.ctx.positions.get(pid)?.missionClass === 'readiness') {
    return Math.max(...slots.map((s) => s.seats), 0);
  }
  const totalHours = slots.reduce((h, s) => h + countedHours(g, s.period) * s.seats, 0);
  let concurrent = 0;
  for (const s of slots) {
    const c = slots.filter((o) => overlaps(o.period, s.period)).reduce((n, o) => n + o.seats, 0);
    concurrent = Math.max(concurrent, c);
  }
  return Math.max(concurrent, Math.ceil(totalHours / g.ctx.tunables.dailyCapH - 0.01));
}

/** commanders needed: one per commander-first slot start of the position */
const commanderQuota = (own: Slot[]) =>
  new Set(own.filter((s) => s.commanderFirstSeat).map((s) => s.period[0])).size;

export function runLevel1(g: Gen): Level1Plan {
  const { ctx, issues, level1, state } = g;

  const slotsByPosition = new Map<number, Slot[]>();
  for (const slot of ctx.slots) {
    const p = ctx.positions.get(slot.positionId)!;
    if (!p.isScheduled || p.missionClass === 'rest' || OVERLAY.has(p.name)) continue;
    const list = slotsByPosition.get(slot.positionId) ?? [];
    list.push(slot);
    slotsByPosition.set(slot.positionId, list);
  }

  // honor Level-1 locks first
  for (const [sid, pid] of ctx.lockedDay) {
    const st = state.get(sid);
    if (st) st.level1 = pid;
    level1.set(sid, pid);
  }

  // Seat-rule pre-pass (H6b, e.g. חפק): each sub-position seat has a dedicated
  // candidate list — named soldiers or roles, in priority order. Candidates are
  // reserved for this position only (they never fill other positions); a rule
  // with release_unpicked frees the unchosen candidates back to the pool. A
  // seat with no available candidate stays EMPTY (issue raised, no substitute).
  const seatPlan = new Map<number, Map<string, SeatPick>>();
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
      // H6b qual guard: the named lists stay authoritative, but a pick that
      // lacks the seat's expected qualification is flagged (issue here +
      // validator warning `seat_qualification`)
      const qualCheck = (st: SoldierState, rule: SeatRule) => {
        if (rule.qual && !hasQualification(st.soldier.quals, st.soldier.role, rule.qual)) {
          issues.push(`${pos.name} ${rule.sub}: ${st.soldier.name} ללא הסמכת ${rule.qual}`);
        }
      };
      for (const rule of rules) {
        ruleMap.set(nrm(rule.sub), rule);
        const window = subPeriod.get(nrm(rule.sub)) ?? g.dRange;
        // candidates in priority order: explicit list, or role matches ordered
        // by the roles list (e.g. מ"פ before סמ"פ)
        const cands = rule.soldiers
          ? rule.soldiers.map((n) => byName.get(nrm(n))).filter((x): x is SoldierState => !!x)
          : [...state.values()]
              .filter((st) => (rule.roles ?? []).some((r) => nrm(r) === nrm(st.soldier.role)))
              .sort((a, b) =>
                rule.roles!.findIndex((r) => nrm(r) === nrm(a.soldier.role))
                - rule.roles!.findIndex((r) => nrm(r) === nrm(b.soldier.role)));
        for (const c of cands) g.seatRestrict.set(c.soldier.id, pos.name);
        const avail = cands.filter((st) =>
          (st.level1 === null || st.level1 === pos.id) && !isBlocked(g, st.soldier.id, window));
        // ordered/role rules take the first available; unordered pairs rotate by fairness
        const chosen = (rule.ordered || rule.roles) ? avail[0] : rank(g, avail, pos.id, false)[0];
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
            const w = partialWindow(ctx.blocked.get(c.soldier.id) ?? [], window);
            if (w?.kind === 'departing') dep.set(c, w.at);
            else if (w?.kind === 'arriving') arr.set(c, w.at);
          }
          const order = (xs: SoldierState[]) => (rule.ordered || rule.roles)
            ? [...xs].sort((x, y) => cands.indexOf(x) - cands.indexOf(y))
            : rank(g, xs, pos.id, false);
          let pairPick: SeatPair | undefined;
          for (const d of order([...dep.keys()])) {
            const handover = dep.get(d)!;
            const a = order([...arr.keys()].filter((x) => x !== d && arr.get(x)! <= handover))[0];
            if (a) { pairPick = { pair: true, d, a, handover }; break; }
          }
          if (pairPick) {
            for (const m of [pairPick.d, pairPick.a]) {
              if (m.level1 === null) { m.level1 = pos.id; level1.set(m.soldier.id, pos.id); }
              qualCheck(m, rule);
              m.level1Rationale.push({
                code: 'seat_rule',
                params: { seat: rule.sub, position: pos.name, priority: cands.indexOf(m) + 1 },
              });
            }
            plan.set(nrm(rule.sub), pairPick);
            if (rule.release_unpicked) {
              for (const c of cands) if (c !== pairPick.d && c !== pairPick.a) g.seatRestrict.delete(c.soldier.id);
            }
            continue;
          }
          issues.push(`${pos.name}: אין מועמד זמין למושב ${rule.sub} — המושב יישאר ריק`);
          // nothing to protect — free the (blocked) candidates for other positions
          for (const c of cands) g.seatRestrict.delete(c.soldier.id);
          continue;
        }
        if (chosen.level1 === null) { chosen.level1 = pos.id; level1.set(chosen.soldier.id, pos.id); }
        qualCheck(chosen, rule);
        chosen.level1Rationale.push({
          code: 'seat_rule',
          params: { seat: rule.sub, position: pos.name, priority: cands.indexOf(chosen) + 1 },
        });
        plan.set(nrm(rule.sub), chosen);
        if (rule.release_unpicked) for (const c of cands) if (c !== chosen) g.seatRestrict.delete(c.soldier.id);
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
      if (st.level1 !== null || fullyBlocked(g, st.soldier.id)) continue;
      if (!roles.some((r) => nrm(r) === nrm(st.soldier.role))) continue;
      if (!posSlots.some((sl) => !isBlocked(g, st.soldier.id, sl.period))) continue;
      st.level1 = pos.id; level1.set(st.soldier.id, pos.id);
      st.level1Rationale.push({ code: 'role_crew', params: { position: pos.name, role: st.soldier.role } });
    }
  }

  // Continuity pre-pass (מגן): returning crew members are reserved BEFORE any
  // other position can grab them — the crew repeats day-to-day unless seats
  // shrink, a member is unavailable, or a manual/locked change intervenes.
  for (const pos of ctx.positions.values()) {
    if (!pos.config?.continuity || !slotsByPosition.has(pos.id)) continue;
    let room = demand(g, pos.id, slotsByPosition.get(pos.id)!)
      - [...level1.values()].filter((p) => p === pos.id).length;
    const posSlots = slotsByPosition.get(pos.id)!;
    const returning = [...state.values()].filter((st) =>
      st.level1 === null && !fullyBlocked(g, st.soldier.id)
      && allowedIn(g, st.soldier, pos.name)
      // returning member must still be available for the crew's mission window
      && posSlots.some((sl) => !isBlocked(g, st.soldier.id, sl.period))
      && ctx.yesterdayPosition.get(st.soldier.id) === pos.id);
    for (const st of rank(g, returning, pos.id, false)) {
      if (room <= 0) break;
      st.level1 = pos.id; level1.set(st.soldier.id, pos.id); room--;
      st.level1Rationale.push({ code: 'continuity_crew', params: { position: pos.name } });
    }
  }

  // fill order: role-gated / commander-heavy first
  const order = ['קצין מוצב', 'סיור', 'התקפי', 'מגן', 'עמדות הגנה', 'חפק', 'תורנים'];
  for (const posName of order) {
    const pid = ctx.positionByName.get(posName);
    if (pid === undefined || !slotsByPosition.has(pid)) continue;
    const pos = ctx.positions.get(pid)!;
    if (pos.config?.seat_rules || pos.config?.staff_all_roles) continue;   // staffed by pre-pass only
    const slots = slotsByPosition.get(pid)!;
    let need = demand(g, pid, slots) - [...level1.values()].filter((p) => p === pid).length;
    let cmdNeed = commanderQuota(slots);

    const eligible = (st: SoldierState) => {
      const s = st.soldier;
      if (st.level1 !== null || fullyBlocked(g, s.id)) return false;
      if (!allowedIn(g, s, posName)) return false;                               // H6b/H6c: position whitelist
      // must be available for at least one of the position's slot windows
      // (a soldier leaving/arriving mid-day can't hold a window he'd miss)
      if (!slots.some((sl) => !isBlocked(g, s.id, sl.period))) return false;
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
      for (const st of rank(g, free.filter((c) => c.soldier.isCommander && c.level1 === null), pid, false, atStart)) {
        if (cmdNeed <= 0 || need <= 0) break;
        pick(st);
        st.level1Rationale.push({ code: 'commander_quota', params: { position: posName } });
      }
      if (cmdNeed > 0) issues.push(`${posName}: חסרים ${cmdNeed} מפקדים בשיבוץ היומי`);
    }
    for (const st of rank(g, free.filter((c) => c.level1 === null), pid, false, atStart)) {
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
      const pid = fullyBlocked(g, st.soldier.id) ? homeId : restId;
      st.level1 = pid; level1.set(st.soldier.id, pid);
    }
  }

  return { slotsByPosition, seatPlan, seatRuleBySub };
}
