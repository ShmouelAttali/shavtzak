// Level 1 (SPEC §7): partition the available soldiers into positions for the
// schedule day — locks, the H6b seat-rule pre-pass, staff_all_roles crews,
// the closed-list (candidate_pool) pre-pass, flex seat sizing (everyone
// works — מנוחה is not a planned outcome), continuity crews, then the
// demand-driven fill in priority order with hard commander/driver quotas
// first. All ranking here uses the GROUP cascade (rankGroup — no nights, no
// sub-position keys: those facts only exist once Level 2 picks a concrete
// slot), and every pick records the DECISIVE key that beat the runner-up
// (decisiveEntry), not a satisfied-median claim.

import { Minutes, overlaps, isSunday } from './time.js';
import { Slot, SeatRule } from './model.js';
import { RationaleEntry } from './rationale.js';
import { normalizeName as nrm, hasQualification } from './text.js';
import { Gen, SoldierState, allowedIn, countedHours, fullyBlocked, isBlocked, isNightExit } from './state.js';
import { rankGroup, decisiveEntry } from './rank.js';
import { restBefore } from './rest.js';
import { partialWindow } from './pairs.js';
import { isShiftPosition, isNightExitOk } from './config.js';

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

/** Already booked during the window for ANOTHER position — previous-day
 *  chain standbys run BEFORE Level 1 (generate.ts), and H3/H3b make an
 *  overlapping slot unholdable for a soldier who is on a mission or standing
 *  by. Same-position rows (e.g. his own locked מגן daily row on a
 *  regeneration) don't conflict — they reinforce the bucket, not block it. */
const busyElsewhere = (g: Gen, sid: number, pid: number, p: [Minutes, Minutes]): boolean =>
  (g.ctx.existing.get(sid) ?? []).some((a) => a.positionId !== pid && overlaps(a.period, p))
  || g.assignments.some((a) => a.soldierId === sid && a.positionId !== pid && overlaps(a.period, p));

/** Level-1 holdability of one slot window: not blocked, not booked elsewhere,
 *  and above the H8 absolute rest floor (4h) at the window start — restBefore
 *  already folds the R5 duty-rest exemption, so a continuity member repeating
 *  back-to-back passes while e.g. a soldier whose patrol ends exactly at the
 *  daily 14:00 start does not (he'd be un-seatable at Level 2 and leave a
 *  ghost in the bucket). */
const canHold = (g: Gen, st: SoldierState, pid: number, p: [Minutes, Minutes]): boolean =>
  !isBlocked(g, st.soldier.id, p)
  && !busyElsewhere(g, st.soldier.id, pid, p)
  // per-position no_rest_floor (מגן/חפק/קצין מוצב) — the officer schedules the
  // crew internally, so no entry rest floor applies (owner 2026-07-19)
  && ((g.ctx.positions.get(pid)?.config?.no_rest_floor ?? false)
      || restBefore(g, st, p[0]) >= g.ctx.tunables.restMinH * 60);

/** H6b reservation, run BEFORE the previous-day chains (generate.ts): a
 *  seat-rule candidate serves only his position, but the morning chain
 *  completions run before Level 1 — without this early pass, allowedIn can't
 *  see the reservation yet (bug 2026-07-20: the unchosen סמ"פ was pulled
 *  into a morning כרמל completion). The seat pre-pass in runLevel1
 *  re-derives the same candidates and applies the usual releases
 *  (release_unpicked / empty seat). */
export function reserveSeatCandidates(g: Gen): void {
  for (const pos of g.ctx.positions.values()) {
    const rules: SeatRule[] = pos.config?.seat_rules ?? [];
    if (!rules.length || !pos.isScheduled) continue;
    if (!g.ctx.slots.some((s) => s.positionId === pos.id)) continue;
    const named = (pos.candidates ?? [])
      .filter((c) => c.subPositionId !== null)
      .map((c) => g.state.get(c.soldierId));
    const roleMatches = rules.flatMap((rule) => [...g.state.values()]
      .filter((st) => (rule.roles ?? []).some((r) => nrm(r) === nrm(st.soldier.role))));
    for (const c of [...named, ...roleMatches]) {
      if (c && allowedIn(g, c.soldier, pos.name)) g.seatRestrict.set(c.soldier.id, pos.name);
    }
  }
}

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
    for (const pos of ctx.positions.values()) {
      const rules: SeatRule[] = pos.config?.seat_rules ?? [];
      if (!rules.length || !slotsByPosition.has(pos.id)) continue;
      const plan = new Map<string, SeatPick>();
      const ruleMap = new Map<string, SeatRule>();
      const posSlots = slotsByPosition.get(pos.id)!;
      const subPeriod = new Map(posSlots
        .map((sl) => [nrm(sl.subName ?? ''), sl.period] as const));
      // seat name -> sub id (the join key into the position's candidate rows)
      const subIdByName = new Map(posSlots
        .filter((sl) => sl.subPositionId !== null)
        .map((sl) => [nrm(sl.subName ?? ''), sl.subPositionId] as const));
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
        // candidates in priority order: the seat's position_candidates rows
        // (loaded pre-sorted by priority — id-matched, no name comparison), or
        // role matches ordered by the roles list (e.g. מ"פ before סמ"פ)
        const subId = subIdByName.get(nrm(rule.sub));
        const named = subId === undefined ? []
          : (pos.candidates ?? []).filter((c) => c.subPositionId === subId);
        const cands = (named.length
          ? named.map((c) => state.get(c.soldierId)).filter((x): x is SoldierState => !!x)
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
        const chosen = (rule.ordered || rule.roles) ? avail[0] : rankGroup(g, avail, pos.id)[0];
        if (!chosen) {
          // H6b pair handover: when no candidate covers the whole window, a
          // departing candidate (available until his leave time) and an
          // arriving one (available from it) may split the seat — both from
          // the seat's OWN list, so "no substitutes" holds. Bus-boundary
          // blocks (Sunday 08:00, other days 06:00) meet exactly at the
          // handover.
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
            : rankGroup(g, xs, pos.id);
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

  // shared per-position context for the closed-list pre-pass and the two
  // fill passes below
  const posCtx = (posName: string) => {
    const pid = ctx.positionByName.get(posName);
    if (pid === undefined || !slotsByPosition.has(pid)) return null;
    const pos = ctx.positions.get(pid)!;
    if (pos.config?.seat_rules || pos.config?.staff_all_roles) return null;   // staffed by pre-pass only
    const slots = slotsByPosition.get(pid)!;
    // H6-pool (config.candidate_pool marker, e.g. קצין מוצב): manned ONLY
    // from the position's position_candidates rows — unordered, rotating by
    // fairness, NON-exclusive (members serve anywhere when not picked).
    // Enforced inside allowedIn().
    const hasPool = !!pos.config?.candidate_pool;
    const eligible = (st: SoldierState) => {
      const s = st.soldier;
      if (st.level1 !== null || fullyBlocked(g, s.id)) return false;
      if (!allowedIn(g, s, posName)) return false;             // H6b/H6c/H6-pool whitelists
      // must be able to hold at least one of the position's slot windows
      // (a soldier leaving/arriving mid-day can't hold a window he'd miss,
      // a pre-booked chain standby blocks its window — H3/H3b — and the H8
      // rest floor must hold at the window start)
      if (!slots.some((sl) => canHold(g, st, pid, sl.period))) return false;
      // H6 fallback role gate — only when no candidate_pool is configured
      if (!hasPool && posName === 'קצין מוצב' && !s.isSeniorCommander) return false;
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

  // ── Closed-list pre-pass (owner decision 2026-07-19): a position manned
  // ONLY from a fixed candidate list (config.candidate_pool — קצין מוצב) is
  // staffed FIRST — before the מגן-commander reservation, continuity, or any
  // later fill can consume a pool member. The list is small and has no
  // substitutes, so its pick always wins; rank keeps the pool's fairness
  // rotation. The persisted מגן commander is taken from the pool only as a
  // LAST resort — when another member can hold the seat, מגן keeps its
  // commander (the forced case emits a מגן issue below).
  {
    const magenCmdId = ctx.magenCommander?.soldierId;
    for (const pos of ctx.positions.values()) {
      if (!pos.config?.candidate_pool) continue;
      const c = posCtx(pos.name);
      if (!c) continue;
      const { pid, slots, eligible, atStart, assigned, take } = c;
      let need = demand(g, pid, slots) - assigned();
      if (need <= 0) continue;
      const pool = rankGroup(g, [...state.values()].filter(eligible), pid, atStart)
        // stable sort: the מגן commander sinks to the end, fairness order kept
        .sort((a, b) => Number(a.soldier.id === magenCmdId)
          - Number(b.soldier.id === magenCmdId));
      for (const st of pool) {
        if (need <= 0) break;
        take(st); need--;
        st.level1Rationale.push({ code: 'candidate_pool', params: { position: pos.name } });
      }
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
      // Surplus is NOT pre-absorbed into מגן's fill demand: מגן fills before
      // late positions (תורנים), and enlarging it up front starves them of
      // their last eligible candidates (bug 2026-07-20 — תורנים seat empty
      // while מגן held 12). True leftovers join מגן in the absorb step AFTER
      // every position is staffed.
      const seats = Math.max(effMin, Math.min(base, free + assignedTo(magenId!)));
      for (const s of magenSlots) s.seats = seats;
      if (free + assignedTo(magenId!) < effMin) {
        issues.push(`מגן: חסרים ${effMin - free - assignedTo(magenId!)} חיילים לאיוש מלא`);
      }
    }
  }

  // ── מגן commander (weekly decision, magen_commander_history) ─────────────
  // Reserved to מגן before anything else can take him; his platoon anchors
  // the crew's same-platoon preference.
  {
    const cmd = ctx.magenCommander;
    if (magenId !== undefined && cmd && slotsByPosition.has(magenId)) {
      const st = state.get(cmd.soldierId);
      if (!st) {
        // decided commander is not in today's loaded roster (not schedulable)
        issues.push(`מגן: המפקד המוגדר "${cmd.name}" לא נמצא במצבת`);
      } else if (fullyBlocked(g, st.soldier.id) || !allowedIn(g, st.soldier, 'מגן')) {
        issues.push(`מגן: המפקד המוגדר ${cmd.name} אינו זמין היום`);
      } else if (st.level1 !== null && st.level1 !== magenId) {
        const other = ctx.positions.get(st.level1);
        if (other?.config?.candidate_pool) {
          // closed-list positions staff first (owner decision 2026-07-19):
          // the pool pick wins — the officer must name a substitute
          issues.push(`מגן: המפקד המוגדר ${cmd.name} שובץ ל${other.name} — נדרש מפקד מגן חלופי`);
        } else {
          issues.push(`מגן: המפקד המוגדר ${cmd.name} כבר משובץ לעמדה אחרת (נעילה)`);
        }
      } else if (st.level1 === null) {
        st.level1 = magenId; level1.set(st.soldier.id, magenId);
        st.level1Rationale.push({ code: 'magen_commander' });
      }
    }
  }

  // Continuity pre-pass (מגן): returning crew members are reserved BEFORE any
  // other position can grab them — the crew repeats day-to-day unless seats
  // shrink, a member is unavailable, or a manual/locked change intervenes.
  // Continuity holds WITHIN the work week only (owner 2026-07-19): a Sunday
  // schedule day starts a new week — no member returns by right; the crew is
  // rebuilt fresh around the weekly מגן commander (reserved above), whose
  // מחלקה anchors the same-platoon fill.
  for (const pos of ctx.positions.values()) {
    if (isSunday(g.day)) break;
    if (!pos.config?.continuity || !slotsByPosition.has(pos.id)) continue;
    // the whole crew returns by right — up to the flex/override max, not the
    // fill-time seat count (surplus is no longer pre-absorbed into seats)
    const cap = pos.id === magenId && magenEffMax !== undefined
      ? Math.max(magenEffMax, demand(g, pos.id, slotsByPosition.get(pos.id)!))
      : demand(g, pos.id, slotsByPosition.get(pos.id)!);
    let room = cap - [...level1.values()].filter((p) => p === pos.id).length;
    const posSlots = slotsByPosition.get(pos.id)!;
    const returning = [...state.values()].filter((st) =>
      st.level1 === null && !fullyBlocked(g, st.soldier.id)
      && allowedIn(g, st.soldier, pos.name)
      // returning member must still be available for the crew's mission
      // window. H9 מגן stickiness (owner 2026-07-19): a returning member's
      // half-day exit window does NOT block the crew's daily row — he stays
      // on the crew (the מגן officer covers his absence internally), so his
      // exit windows are ignored here (real unavailability still blocks;
      // yesterdayPosition === pos.id below makes him sticky by definition).
      && posSlots.some((sl) => !isBlocked(g, st.soldier.id, sl.period, ctx.exits.has(st.soldier.id))
        && !busyElsewhere(g, st.soldier.id, pos.id, sl.period))
      && ctx.yesterdayPosition.get(st.soldier.id) === pos.id);
    for (const st of rankGroup(g, returning, pos.id)) {
      if (room <= 0) break;
      st.level1 = pos.id; level1.set(st.soldier.id, pos.id); room--;
      st.level1Rationale.push({ code: 'continuity_crew', params: { position: pos.name } });
      // sticky exit member: reserved here (before the H9 exit pre-pass, which
      // skips anyone with level1 already set) — mark the decision
      if (ctx.exits.has(st.soldier.id)) {
        st.level1Rationale.push({ code: 'exit_sticky_magen' });
      }
    }
  }

  // ── H9 exit pre-pass: a soldier with a half-day exit serves a SHIFT
  // position that day (not daily, not readiness — allowedIn rejects those for
  // him); reserved here so the general fill can't strand him, Level 2 packs
  // his shifts around the exit window. Night-exit relaxation (owner
  // 2026-07-19): when ALL his windows fall within 22:00–06:00, a
  // night_exit_ok daily duty (תורנים) is an ADDITIONAL candidate — its 24h
  // row spans the night window, so the exit-window block is ignored for it
  // (מפקד התורנים covers the absence internally).
  for (const [sid] of ctx.exits) {
    const st = state.get(sid);
    if (!st || st.level1 !== null || fullyBlocked(g, sid)) continue;
    const nightExit = isNightExit(g, sid);
    const nightOk = (pid: number) => nightExit && isNightExitOk(ctx.positions.get(pid)!);
    const cands = [...slotsByPosition.entries()].filter(([pid, posSlots]) => {
      const pos = ctx.positions.get(pid)!;
      if (pos.config?.seat_rules || pos.config?.staff_all_roles) return false; // pre-pass staffed
      return (isShiftPosition(pos) || nightOk(pid)) && allowedIn(g, st.soldier, pos.name)
        && posSlots.some((sl) => !isBlocked(g, sid, sl.period, nightOk(pid)));
    });
    // prefer a position with unmet demand, then the one with more open slots
    // outside his window (packing feasibility), then P4 position balance —
    // a shift position with unmet demand still generally wins (more open
    // slots); the night_exit_ok duty is an option, never forced
    const score = ([pid, posSlots]: [number, Slot[]]): [number, number, number] => [
      Math.max(0, demand(g, pid, posSlots)
        - [...level1.values()].filter((p) => p === pid).length) > 0 ? 0 : 1,
      -posSlots.filter((sl) => !isBlocked(g, sid, sl.period, nightOk(pid))).length,
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
    const bestPos = ctx.positions.get(best[0])!;
    st.level1 = best[0]; level1.set(sid, best[0]);
    st.level1Rationale.push({
      code: isShiftPosition(bestPos) ? 'exit_shift_fill' : 'exit_night_toranut',
      params: { position: bestPos.name },
    });
  }

  // fill order: role-gated / commander-heavy first
  const order = ['קצין מוצב', 'סיור', 'התקפי', 'מגן', 'עמדות הגנה', 'חפק', 'תורנים'];

  // pick-order stamp (owner request 2026-07-19): every demand-fill rationale
  // carries the sequence number of its pick, so the report lists soldiers in
  // the EXACT order the code took them (not soldier-id order)
  let pickSeq = 0;
  const stamped = (e: RationaleEntry): RationaleEntry =>
    ({ ...e, params: { ...(e.params ?? {}), seq: ++pickSeq } });

  // ── Pass A: HARD role quotas across ALL positions — commanders (H6/item
  // 12), then qualified drivers (H6d) — BEFORE any soft/fairness fill, so an
  // earlier position's general fill can never starve a later position of its
  // required commanders/drivers. (candidate_pool demand — קצין מוצב — is
  // reserved even earlier, in the closed-list pre-pass above.)
  for (const posName of order) {
    const c = posCtx(posName);
    if (!c) continue;
    const { pid, pos, slots, eligible, atStart, assigned, take } = c;
    const totalNeed = demand(g, pid, slots);
    let need = totalNeed - assigned();
    // group positions (config.group_size, e.g. התקפי 2×(מפקד+3)): one
    // commander per group, not just per commander-first slot start
    const groupSize: number | undefined = pos.config?.group_size;
    let cmdNeed = Math.max(commanderQuota(slots),
      groupSize ? Math.ceil(totalNeed / groupSize) : 0)
      - [...state.values()].filter((st) => st.level1 === pid && st.soldier.isCommander).length;
    if (cmdNeed > 0 && need > 0) {
      const rankedCmd = rankGroup(g, [...state.values()].filter((x) => eligible(x) && x.soldier.isCommander),
                                  pid, atStart);
      for (const st of rankedCmd) {
        if (cmdNeed <= 0 || need <= 0) break;
        // why THIS commander over the others — the first cascade key that
        // beat the next still-free commander in ranked order
        const runner = rankedCmd.find((x) => x !== st && x.level1 === null);
        take(st); need--; cmdNeed--;
        st.level1Rationale.push(stamped({ code: 'commander_quota', params: { position: posName } }));
        st.level1Rationale.push(decisiveEntry(g, st, runner, pid, atStart));
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
      const rankedDrv = rankGroup(g, [...state.values()].filter((x) => eligible(x) && isDriver(x)),
                                  pid, atStart);
      for (const st of rankedDrv) {
        if (drvNeed <= 0 || need <= 0) break;
        const runner = rankedDrv.find((x) => x !== st && x.level1 === null);
        take(st); need--; drvNeed--;
        st.level1Rationale.push(stamped({ code: 'driver_quota', params: { position: posName, qual: driverQual } }));
        st.level1Rationale.push(decisiveEntry(g, st, runner, pid, atStart));
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
          const rankedSame = rankGroup(g, same, pid);
          for (const st of rankedSame) {
            if (need <= 0) break;
            const runner = rankedSame.find((x) => x !== st && x.level1 === null);
            pick(st);
            st.level1Rationale.push(stamped(decisiveEntry(g, st, runner, pid)));
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
        for (const st of rankGroup(g, free.filter((x) => x.level1 === null
            && x.soldier.platoon === cm.soldier.platoon), pid, atStart)) {
          if (room <= 0 || need <= 0) break;
          pick(st); room--;
          st.level1Rationale.push(stamped({
            code: 'platoon_group',
            params: { commander: cm.soldier.name, platoon: cm.soldier.platoon },
          }));
        }
      }
    }
    // general ranked fill: each pick records the DECISIVE cascade key — the
    // first key on which it beat the next still-free candidate in ranked order
    const ranked = rankGroup(g, free.filter((x) => x.level1 === null), pid, atStart);
    for (const st of ranked) {
      if (need <= 0) break;
      const runner = ranked.find((x) => x !== st && x.level1 === null);
      pick(st);
      st.level1Rationale.push(stamped(decisiveEntry(g, st, runner, pid, atStart)));
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
      const leftovers = rankGroup(g, [...state.values()].filter((st) =>
        st.level1 === null && !fullyBlocked(g, st.soldier.id)
        && allowedIn(g, st.soldier, 'מגן')
        && magenSlots.some((sl) => canHold(g, st, magenId!, sl.period))), magenId);
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
