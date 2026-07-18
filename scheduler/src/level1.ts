// Level 1 (SPEC §7): partition the available soldiers into positions for the
// schedule day — locks, the H6b seat-rule pre-pass, staff_all_roles crews,
// flex seat sizing (everyone works — מנוחה is not a planned outcome),
// continuity crews, then the demand-driven fill in priority order with hard
// commander/driver quotas first.

import { Minutes, overlaps } from './time.js';
import { Slot, SeatRule } from './model.js';
import { normalizeName as nrm, hasQualification } from './text.js';
import { Gen, SoldierState, allowedIn, countedHours, fullyBlocked, isBlocked } from './state.js';
import { rank } from './rank.js';
import { partialWindow } from './pairs.js';
import { isShiftPosition } from './config.js';

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
        const cands = (rule.soldiers
          ? rule.soldiers.map((n) => byName.get(nrm(n))).filter((x): x is SoldierState => !!x)
          : [...state.values()]
              .filter((st) => (rule.roles ?? []).some((r) => nrm(r) === nrm(st.soldier.role)))
              .sort((a, b) =>
                rule.roles!.findIndex((r) => nrm(r) === nrm(a.soldier.role))
                - rule.roles!.findIndex((r) => nrm(r) === nrm(b.soldier.role))))
          // the one restriction gate also here: an exit-day candidate (H9)
          // can't hold a daily seat — the NEXT candidate on the list takes it,
          // and he is never reserved (stays free for a shift position)
          .filter((c) => allowedIn(g, c.soldier, pos.name));
        for (const c of cands) g.seatRestrict.set(c.soldier.id, pos.name);
        const avail = cands.filter((st) =>
          (st.level1 === null || st.level1 === pos.id) && !isBlocked(g, st.soldier.id, window));
        // ordered/role rules take the first available; unordered pairs rotate by fairness
        const chosen = (rule.ordered || rule.roles) ? avail[0] : rank(g, avail, pos.id, false)[0];
        if (!chosen) {
          // H6b pair handover: when no candidate covers the whole window, a
          // departing candidate (available until his leave time) and an
          // arriving one (available from it) may split the seat — both from
          // the seat's OWN list, so "no substitutes" holds. Bus-at-08:00
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

  // ── Everyone works (owner rule): flexible seat counts ─────────────────────
  // Every present soldier must do a shift — מנוחה is not a planned outcome.
  // Surplus soldiers enlarge מגן up to its flex max (12); on shortage מגן
  // stays at its flex min (10) and flex positions like סיור shrink one seat
  // per shift (down to their min, 3) until demand fits the pool.
  const magenId = ctx.positionByName.get('מגן');
  let magenEffMax: number | undefined;
  {
    const magenSlots = magenId !== undefined ? slotsByPosition.get(magenId) : undefined;
    const magenFlex = magenId !== undefined ? ctx.positions.get(magenId)?.config?.flex_seats : undefined;
    if (magenSlots && magenFlex) {
      // an explicit seat override may ENLARGE the crew beyond the flex max
      // (manual decision wins); shrinking below the flex min loses to the
      // everyone-works rule — surplus soldiers still need a seat
      const base = magenSlots[0].seats;
      const effMin = Math.min(magenFlex.min, base);
      magenEffMax = Math.max(magenFlex.max, base);
      const pool = [...state.values()].filter((st) =>
        st.level1 === null && !fullyBlocked(g, st.soldier.id)).length;
      const assignedTo = (pid: number) => [...level1.values()].filter((p) => p === pid).length;
      const nonMagenNeed = () => {
        let n = 0;
        for (const [pid, posSlots] of slotsByPosition) {
          if (pid === magenId) continue;
          const pos = ctx.positions.get(pid)!;
          if (pos.config?.seat_rules || pos.config?.staff_all_roles) continue; // pre-pass staffed
          n += Math.max(0, demand(g, pid, posSlots) - assignedTo(pid));
        }
        return n;
      };
      let free = pool - nonMagenNeed();
      // shortage: shrink other flex positions (סיור 4 → min 3) until מגן's
      // minimum crew fits
      for (const [pid, posSlots] of slotsByPosition) {
        if (pid === magenId) continue;
        const flex = ctx.positions.get(pid)?.config?.flex_seats;
        if (!flex) continue;
        while (free + assignedTo(magenId!) < effMin
               && posSlots.some((s) => s.seats > flex.min)) {
          for (const s of posSlots) if (s.seats > flex.min) s.seats--;
          free = pool - nonMagenNeed();
        }
      }
      const seats = Math.max(effMin,
        Math.min(magenEffMax, free + assignedTo(magenId!)));
      for (const s of magenSlots) s.seats = seats;
      if (free + assignedTo(magenId!) < effMin) {
        issues.push(`מגן: חסרים ${effMin - free - assignedTo(magenId!)} חיילים לאיוש מלא`);
      }
    }
  }

  // ── מגן commander (weekly decision, config key `magen_commander`) ─────────
  // Reserved to מגן before anything else can take him; his platoon anchors
  // the crew's same-platoon preference.
  {
    const name = ctx.config.magen_commander;
    if (magenId !== undefined && typeof name === 'string' && slotsByPosition.has(magenId)) {
      const st = [...state.values()].find((s) => nrm(s.soldier.name) === nrm(name));
      if (!st) {
        issues.push(`מגן: המפקד המוגדר "${name}" לא נמצא במצבת`);
      } else if (fullyBlocked(g, st.soldier.id) || !allowedIn(g, st.soldier, 'מגן')) {
        issues.push(`מגן: המפקד המוגדר ${name} אינו זמין היום`);
      } else if (st.level1 !== null && st.level1 !== magenId) {
        issues.push(`מגן: המפקד המוגדר ${name} כבר משובץ לעמדה אחרת (נעילה)`);
      } else if (st.level1 === null) {
        st.level1 = magenId; level1.set(st.soldier.id, magenId);
        st.level1Rationale.push({ code: 'magen_commander' });
      }
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

  // ── H9 exit pre-pass: a soldier with a half-day exit serves a SHIFT
  // position that day (not daily, not readiness — allowedIn rejects those for
  // him); reserved here so the general fill can't strand him, Level 2 packs
  // his shifts around the exit window.
  for (const [sid] of ctx.exits) {
    const st = state.get(sid);
    if (!st || st.level1 !== null || fullyBlocked(g, sid)) continue;
    const cands = [...slotsByPosition.entries()].filter(([pid, posSlots]) => {
      const pos = ctx.positions.get(pid)!;
      if (pos.config?.seat_rules || pos.config?.staff_all_roles) return false; // pre-pass staffed
      return isShiftPosition(pos) && allowedIn(g, st.soldier, pos.name)
        && posSlots.some((sl) => !isBlocked(g, sid, sl.period));
    });
    // prefer a position with unmet demand, then the one with more open slots
    // outside his window (packing feasibility), then P4 position balance
    const score = ([pid, posSlots]: [number, Slot[]]): [number, number, number] => [
      Math.max(0, demand(g, pid, posSlots)
        - [...level1.values()].filter((p) => p === pid).length) > 0 ? 0 : 1,
      -posSlots.filter((sl) => !isBlocked(g, sid, sl.period)).length,
      st.fairness.positionCounts[ctx.positions.get(pid)!.name] ?? 0,
    ];
    const best = cands.sort((a, b) => {
      const [sa, sb] = [score(a), score(b)];
      return sa[0] - sb[0] || sa[1] - sb[1] || sa[2] - sb[2];
    })[0];
    if (!best) {
      issues.push(`${st.soldier.name}: יציאה קצרה — לא נמצאה עמדת משמרות זמינה ליום זה`);
      continue;
    }
    st.level1 = best[0]; level1.set(sid, best[0]);
    st.level1Rationale.push({
      code: 'exit_shift_fill', params: { position: ctx.positions.get(best[0])!.name },
    });
  }

  // fill order: role-gated / commander-heavy first
  const order = ['קצין מוצב', 'סיור', 'התקפי', 'מגן', 'עמדות הגנה', 'חפק', 'תורנים'];

  // shared per-position context for the two fill passes below
  const posCtx = (posName: string) => {
    const pid = ctx.positionByName.get(posName);
    if (pid === undefined || !slotsByPosition.has(pid)) return null;
    const pos = ctx.positions.get(pid)!;
    if (pos.config?.seat_rules || pos.config?.staff_all_roles) return null;   // staffed by pre-pass only
    const slots = slotsByPosition.get(pid)!;
    // H6-pool (config.candidate_pool, e.g. קצין מוצב): manned ONLY from the
    // named list — unordered, rotating by fairness, NON-exclusive (members
    // serve anywhere when not picked). Enforced inside allowedIn().
    const namePool: string[] | undefined = pos.config?.candidate_pool;
    const eligible = (st: SoldierState) => {
      const s = st.soldier;
      if (st.level1 !== null || fullyBlocked(g, s.id)) return false;
      if (!allowedIn(g, s, posName)) return false;             // H6b/H6c/H6-pool whitelists
      // must be available for at least one of the position's slot windows
      // (a soldier leaving/arriving mid-day can't hold a window he'd miss)
      if (!slots.some((sl) => !isBlocked(g, s.id, sl.period))) return false;
      // H6 fallback role gate — only when no candidate_pool is configured
      if (!namePool && posName === 'קצין מוצב' && !s.isSeniorCommander) return false;
      if (posName === 'עמדות הגנה' && s.isSeniorCommander) return false;         // H6
      return true;
    };
    // For positions whose work is anchored to few starts (daily missions)
    // rank by rest before the earliest MISSION slot — readiness slots are
    // rest-transparent and must not mask the hint (e.g. התקפי's 24h slot).
    const missionSlots = slots.filter((s) =>
      ctx.positions.get(s.positionId)!.missionClass !== 'readiness');
    const starts = [...new Set(missionSlots.map((s) => s.period[0]))];
    const atStart = starts.length > 0 && starts.length <= 2 ? Math.min(...starts) : undefined;
    const assigned = () => [...level1.values()].filter((p) => p === pid).length;
    const take = (st: SoldierState) => { st.level1 = pid; level1.set(st.soldier.id, pid); };
    return { pid, pos, slots, eligible, atStart, assigned, take };
  };

  // ── Pass A: HARD role quotas across ALL positions — commanders (H6/item
  // 12), then qualified drivers (H6d) — BEFORE any soft/fairness fill, so an
  // earlier position's general fill can never starve a later position of its
  // required commanders/drivers.
  for (const posName of order) {
    const c = posCtx(posName);
    if (!c) continue;
    const { pid, pos, slots, eligible, atStart, assigned, take } = c;
    const totalNeed = demand(g, pid, slots);
    let need = totalNeed - assigned();
    // candidate_pool positions (קצין מוצב) can ONLY be manned from their
    // named list — that list is small and its members are commanders, so the
    // position's whole demand is a hard-role need: reserve it here, before
    // other positions' commander quotas can consume the pool.
    if (pos.config?.candidate_pool && need > 0) {
      for (const st of rank(g, [...state.values()].filter(eligible), pid, false, atStart)) {
        if (need <= 0) break;
        take(st); need--;
      }
    }
    // group positions (config.group_size, e.g. התקפי 2×(מפקד+3)): one
    // commander per group, not just per commander-first slot start
    const groupSize: number | undefined = pos.config?.group_size;
    let cmdNeed = Math.max(commanderQuota(slots),
      groupSize ? Math.ceil(totalNeed / groupSize) : 0)
      - [...state.values()].filter((st) => st.level1 === pid && st.soldier.isCommander).length;
    if (cmdNeed > 0 && need > 0) {
      for (const st of rank(g, [...state.values()].filter((x) => eligible(x) && x.soldier.isCommander),
                            pid, false, atStart)) {
        if (cmdNeed <= 0 || need <= 0) break;
        take(st); need--; cmdNeed--;
        st.level1Rationale.push({ code: 'commander_quota', params: { position: posName } });
      }
      if (cmdNeed > 0) issues.push(`${posName}: חסרים ${cmdNeed} מפקדים בשיבוץ היומי`);
    }
    const driverQual: string | undefined = pos.config?.driver_qual;
    if (driverQual && need > 0) {
      const isDriver = (st: SoldierState) =>
        hasQualification(st.soldier.quals, st.soldier.role, driverQual);
      // one qualified driver per distinct slot start (each crew needs one)
      let drvNeed = new Set(slots.map((s) => s.period[0])).size
        - [...state.values()].filter((st) => st.level1 === pid && isDriver(st)).length;
      for (const st of rank(g, [...state.values()].filter((x) => eligible(x) && isDriver(x)),
                            pid, false, atStart)) {
        if (drvNeed <= 0 || need <= 0) break;
        take(st); need--; drvNeed--;
        st.level1Rationale.push({ code: 'driver_quota', params: { position: posName, qual: driverQual } });
      }
      if (drvNeed > 0) issues.push(`${posName}: חסרים ${drvNeed} נהגים (${driverQual})`);
    }
  }

  // ── Pass B: soft fill in priority order — same-platoon crews, platoon
  // groups, then the general fairness fill.
  for (const posName of order) {
    const c = posCtx(posName);
    if (!c) continue;
    const { pid, pos, slots, eligible, atStart, assigned, take } = c;
    let need = demand(g, pid, slots) - assigned();
    const groupSize: number | undefined = pos.config?.group_size;

    const pick = (st: SoldierState) => { take(st); need--; };

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
        if (same.length >= need) {
          free = same;
        } else {
          // platoon can't cover the whole crew: take ALL its members first,
          // then let the general fill mix in the remainder by fairness.
          // With flex seats a mixed crew above the minimum is routine — only
          // a core (min-seats) shortage is worth flagging.
          for (const st of rank(g, same, pid, false)) {
            if (need <= 0) break;
            pick(st);
          }
          if (same.length < (pos.config?.flex_seats?.min ?? need)) {
            issues.push(`${posName}: אין מספיק חיילים ממחלקה ${platoon} — הצוות מעורב`);
          }
        }
      }
    }

    // P5 platoon groups (config.group_size): each quota commander anchors a
    // group filled preferably from his own platoon (soft)
    if (groupSize && need > 0) {
      const cmdrs = [...state.values()].filter((st) => st.level1 === pid && st.soldier.isCommander);
      for (const cm of cmdrs) {
        let room = Math.min(groupSize - 1, need);
        for (const st of rank(g, free.filter((x) => x.level1 === null
            && x.soldier.platoon === cm.soldier.platoon), pid, false, atStart)) {
          if (room <= 0 || need <= 0) break;
          pick(st); room--;
          st.level1Rationale.push({
            code: 'platoon_group',
            params: { commander: cm.soldier.name, platoon: cm.soldier.platoon },
          });
        }
      }
    }
    for (const st of rank(g, free.filter((x) => x.level1 === null), pid, false, atStart)) {
      if (need <= 0) break;
      pick(st);
    }
    if (need > 0) issues.push(`${posName}: חסרים ${need} חיילים`);
  }

  // Everyone works: leftover available soldiers join מגן up to its flex max
  // before anyone is allowed to rest.
  if (magenId !== undefined && slotsByPosition.has(magenId)) {
    const magenSlots = slotsByPosition.get(magenId)!;
    const flexMax: number | undefined = ctx.positions.get(magenId)?.config?.flex_seats?.max;
    if (flexMax) {
      let crew = [...level1.values()].filter((p) => p === magenId).length;
      const leftovers = rank(g, [...state.values()].filter((st) =>
        st.level1 === null && !fullyBlocked(g, st.soldier.id)
        && allowedIn(g, st.soldier, 'מגן')
        && magenSlots.some((sl) => !isBlocked(g, st.soldier.id, sl.period))), magenId, false);
      for (const st of leftovers) {
        if (crew >= flexMax) break;
        st.level1 = magenId; level1.set(st.soldier.id, magenId); crew++;
        st.level1Rationale.push({ code: 'no_rest_fill', params: { position: 'מגן' } });
      }
      for (const s of magenSlots) s.seats = Math.max(s.seats, crew);
    }
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
  // NB: the "left resting" issues are reported at the END of generation
  // (generate.ts) — Level 2's pull-from-מנוחה may still rescue soldiers.

  return { slotsByPosition, seatPlan, seatRuleBySub };
}
