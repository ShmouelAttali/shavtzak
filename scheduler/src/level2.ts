// Level 2 (SPEC §7): fill the concrete slots inside each Level-1 position
// group — seat-rule plans, staff_all_roles crews, then the general ranked
// fill with the pull-from-מנוחה and H1 replacement-pair completion paths.
// Pure static grids (עמדות הגנה) fill per TIME WINDOW in two phases: phase 1
// picks WHO mans the window (rank() cascade, no post bias), phase 2 spreads
// the picks over the concrete posts (sub_spread — never the same post twice
// in a day). Also owns buildRationale(), the structured "why picked" snapshot.

import { Minutes, fmtHM, hours, overlaps } from './time.js';
import { Slot, Assignment } from './model.js';
import { RationaleEntry } from './rationale.js';
import { normalizeName as nrm, hasQualification } from './text.js';
import { Gen, SoldierState, allowedIn, assign, countedHours, exitExempt, isBlocked, isNightExit } from './state.js';
import { isNightExitOk } from './config.js';
import { fits, restInfo, restBefore, isCountedNight, fitText, fitTexts, FitReason, FIT_RATIONALE } from './rest.js';
import { rank, rotationPenalty, nightsOf, loadOf } from './rank.js';
import { tryReplacementPair, partialWindow } from './pairs.js';
import { Level1Plan, isSeatPair } from './level1.js';

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
function buildRationale(g: Gen, st: SoldierState, slot: Slot, pid: number, opts: {
  pickedFrom: 'primary' | 'rest' | 'fallback';
  fitReasons: FitReason[];
  commanderSeat: boolean;
  groupNights: number[]; groupLoads: number[];   // pre-pick primary snapshot
  myNights: number; myLoad: number;
}): RationaleEntry[] {
  const { ctx } = g;
  const out: RationaleEntry[] = [...st.level1Rationale];

  // rest before this shift (R1/R2/R5)
  const ri = restInfo(g, st, slot.period[0]);
  if (ri.gap === Infinity) out.push({ code: 'no_prior' });
  else if (ri.dutyRest) out.push({ code: 'duty_rest', params: { position: ri.dutyPosition ?? '' } });
  else if (ri.gap >= ctx.tunables.restIdealH * 60) {
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
  switch (rotationPenalty(g, st, pid).tag) {
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

  // one comparative fairness claim, only against a real group (>1 candidate).
  // Weekly load (P3) is NOT reported here (owner 2026-07-24): within a
  // structurally-composed group (התקפי platoon groups, מגן crew) everyone
  // serves identical hours, so load never determines WHICH soldiers form the
  // group — the old "עומס שבועי נמוך בקבוצה" (low_load) claim was misleading and
  // is no longer emitted. The P3 load KEY is untouched — it still ranks the
  // per-slot individual fill (§6.1 Level-2 cascade); only the rationale label
  // is dropped. (The low_load code/template survive for rendering pre-existing
  // persisted drafts.)
  if (opts.pickedFrom === 'primary' && opts.groupNights.length > 1) {
    const mN = median(opts.groupNights);
    if (opts.myNights <= mN) {
      out.push({ code: 'fewest_nights', params: { nights: opts.myNights, median: mN } });
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

/** Locked/manual rows already holding seats of this exact slot (same
 *  position, sub and period — the tuple the DB's seat uniqueness index
 *  guards). The generator keeps them (persist never deletes them) and must
 *  neither re-issue their seat indexes nor re-book their soldiers in the
 *  same crew. */
function lockedInSlot(g: Gen, sl: Slot) {
  return g.ctx.lockedShift.filter((l) =>
    l.positionId === sl.positionId
    && (l.subPositionId ?? null) === (sl.subPositionId ?? null)
    && l.period[0] === sl.period[0] && l.period[1] === sl.period[1]);
}

/** H9 pre-pass: pack each exit-day soldier's shifts around his exit window
 *  BEFORE the general ranked fill. His relaxed-rest picks are fallback-tier
 *  by construction, so the general fill would starve him of the very shifts
 *  he must take (a fallback never beats a rested primary). Prefers a
 *  rest-legal combination; degrades to back-to-back (exit_rest, בדוחק) only
 *  when the window leaves no legal spacing — never by touching other
 *  soldiers. */
function exitPrePass(g: Gen, plan1: Level1Plan): void {
  const { ctx, state, issues } = g;
  const restMin = ctx.tunables.restMinH * 60;
  const restIdeal = ctx.tunables.restIdealH * 60;
  for (const [sid, windows] of ctx.exits) {
    const st = state.get(sid);
    if (!st || st.level1 === null) continue;
    const pid = st.level1;
    const pos = ctx.positions.get(pid);
    const slots = plan1.slotsByPosition.get(pid);
    if (!pos || !slots || pos.config?.seat_rules || pos.config?.staff_all_roles) continue;
    // H9 מגן stickiness: a continuity crew member holds the daily 14:00–14:00
    // row itself (exit window and all) — nothing to pack around the window
    if (pos.config?.continuity) continue;
    // H9 night-exit relaxation (owner 2026-07-19): a night-exit soldier on a
    // night_exit_ok daily duty (תורנים) likewise holds the 24h row itself —
    // the general fill seats him; nothing to pack
    if (isNightExitOk(pos) && isNightExit(g, sid)) continue;
    const nightExempt = pos.config?.night_exempt ?? false;
    const outMin = windows.reduce((m, w) =>
      m + Math.max(0, Math.min(w[1], g.dRange[1]) - Math.max(w[0], g.dRange[0])), 0);
    const targetH = Math.min(ctx.tunables.dailyCapH - st.missionHoursToday, 24 - outMin / 60);
    if (targetH <= 0) continue;

    // pre-pass rows already in a slot (earlier exit soldiers) count against
    // it, and so do locked/manual rows kept in the DB
    const occupancy = (sl: Slot) => g.assignments.filter((a) =>
      a.positionId === sl.positionId && a.subPositionId === sl.subPositionId
      && a.period[0] === sl.period[0]).length + lockedInSlot(g, sl).length;
    // highest seat index not already held (generation rows or locked rows)
    const freeSeat = (sl: Slot): number => {
      const used = new Set<number>([
        ...g.assignments.filter((a) => a.positionId === sl.positionId
          && a.subPositionId === sl.subPositionId && a.period[0] === sl.period[0])
          .map((a) => a.seatIndex),
        ...lockedInSlot(g, sl).map((l) => l.seatIndex),
      ]);
      for (let s = sl.seats; s >= 1; s--) if (!used.has(s)) return s;
      return sl.seats;
    };
    const usable = slots.filter((sl) => occupancy(sl) < sl.seats
      && fits(g, st, sl.period, false, false, nightExempt).ok);

    // Combos of 1–2 non-overlapping shifts (slot templates are 4h+, so two
    // shifts reach the 8h cap). fits() can't see the combo's own first shift,
    // so the rest gaps INSIDE a combo are simulated here.
    const evalCombo = (picks: Slot[]) => {
      const inOrder = [...picks].sort((a, b) => a.period[0] - b.period[0]);
      let fallbacks = 0, shortRests = 0, packedH = 0, contiguous = false;
      const comboEnds: Minutes[] = [];
      for (const sl of inOrder) {
        let prevEnd = -Infinity;
        for (const e of [...st.gashashNightEnds, ...comboEnds]) {
          if (e <= sl.period[0] && e > prevEnd) prevEnd = e;
        }
        // gap vs the soldier's real rows via restBefore — folds the R5
        // duty-rest exemption (a raw interval scan billed a bogus 0h
        // fallback right after a full-rest daily duty)
        const gap = Math.min(sl.period[0] - prevEnd, restBefore(g, st, sl.period[0]));
        if (gap === 0 && comboEnds.length) contiguous = true;
        if (gap < restMin) fallbacks++;
        else if (gap < restIdeal && hours(sl.period) > ctx.tunables.longTaskH) fallbacks++;
        else if (gap < restIdeal) shortRests++;
        comboEnds.push(sl.period[1]);
        packedH += countedHours(g, sl.period);
      }
      const subs = new Set(inOrder.map((sl) => sl.subPositionId)).size;
      return {
        picks: inOrder, packedH, fallbacks, shortRests,
        // separated shifts rotate posts (P4b: distinct subs win); an
        // unavoidable back-to-back pair is ONE continuous stint — it stays
        // at the SAME post (owner 2026-07-20)
        subKey: contiguous ? subs : -subs,
        night: (ctx.nightStreak.get(sid) ?? 0) >= 2
          && inOrder.some((sl) => overlaps(sl.period, g.night)) ? 1 : 0,
        startSum: inOrder.reduce((s, sl) => s + sl.period[0], 0),
      };
    };
    const combos: ReturnType<typeof evalCombo>[] = [];
    for (let i = 0; i < usable.length; i++) {
      combos.push(evalCombo([usable[i]]));
      for (let j = i + 1; j < usable.length; j++) {
        if (overlaps(usable[i].period, usable[j].period)) continue;
        const c = evalCombo([usable[i], usable[j]]);
        if (c.packedH <= targetH + 0.01) combos.push(c);  // R4 cap
      }
    }
    const best = combos.sort((a, b) =>
      b.packedH - a.packedH || a.fallbacks - b.fallbacks || a.shortRests - b.shortRests
      || a.subKey - b.subKey || a.night - b.night || a.startSum - b.startSum)[0];
    if (!best) {
      issues.push(`${st.soldier.name}: יציאה קצרה — לא נמצאה משמרת פנויה מחוץ לחלון היציאה`);
      continue;
    }
    const w = windows[0];
    const winFrom = fmtHM(Math.max(w[0], g.dRange[0]));
    const winTo = fmtHM(Math.min(w[1], g.dRange[1]));
    for (const sl of best.picks) {
      const fit = fits(g, st, sl.period, false, false, nightExempt);
      if (!fit.ok) {   // shouldn't happen — combo was simulated; keep the seat safe
        issues.push(`${pos.name} ${fmtHM(sl.period[0])}: ${st.soldier.name} חסום (${fitTexts(fit.reasons).join(', ')})`);
        continue;
      }
      const rationale = buildRationale(g, st, sl, pid, {
        pickedFrom: 'primary', fitReasons: fit.reasons, commanderSeat: false,
        groupNights: [], groupLoads: [], myNights: 0, myLoad: 0,
      });
      if (fit.fallback) {
        for (const r of fit.reasons) {
          const code = FIT_RATIONALE[r.code];
          if (code) rationale.push({ code });
        }
      }
      rationale.push({ code: 'exit_packed', params: { from: winFrom, to: winTo } });
      // top-down seat index — the general fill hands out the bottom seats
      assign(g, st, sl, freeSeat(sl), false,
        fit.reasons.map((r) => fit.fallback ? `בדוחק: ${fitText(r)}` : fitText(r)),
        'auto', rationale);
    }
    if (best.packedH + 0.01 < targetH) {
      issues.push(`${st.soldier.name}: יציאה קצרה — שובצו ${best.packedH} מתוך `
        + `${targetH} שעות מחוץ לחלון היציאה`);
    }
  }
}

/** Static grid fill (עמדות הגנה — several posts sharing each time window, no
 *  commander/driver seats). Two ideas layered:
 *
 *  Pair matching (owner 2026-07-20): a soldier works TWO 4h windows a full 8h
 *  apart, so the whole crew is spaced by construction — e.g. the 6-window grid
 *  tiles into the pairs 14+02 / 18+06 / 22+10, four soldiers each. A pre-plan
 *  reserves soldiers to these exact-8h window pairs BEFORE the per-window fill;
 *  a reserved soldier is seated in each of his two windows and skipped by the
 *  windows in between, so a greedy grab can't strand him a 3rd shift or a 4h
 *  gap. Surplus/shortage/blocked seats fall through to the residual fill.
 *
 *  Per window it stays two-phase: pick WHO mans the window (post-blind), then
 *  distribute to the concrete posts by even spread (never the same post twice
 *  in a 24h round — sub_spread). Windows process chronologically so later
 *  windows' fits()/rank() see the earlier bookings. */
function fillStaticTwoPhase(g: Gen, pid: number, posName: string, sorted: Slot[],
                            group: SoldierState[], restId: number): void {
  const { ctx, state, issues, level1 } = g;
  const slotReadiness = ctx.positions.get(pid)!.missionClass === 'readiness';
  const slotNightExempt = ctx.positions.get(pid)!.config?.night_exempt ?? false;
  const slotDaily = ctx.positions.get(pid)!.config?.daily ?? false;
  const flexMin: number | undefined = ctx.positions.get(pid)!.config?.flex_seats?.min;
  const restIdeal = ctx.tunables.restIdealH * 60;
  const sticky = (st: SoldierState) => exitExempt(g, st.soldier.id, pid);
  const primaryFit = (st: SoldierState, p: [Minutes, Minutes]) => {
    const f = fits(g, st, p, false, slotReadiness, slotNightExempt, slotDaily, sticky(st));
    return f.ok && !f.fallback;
  };

  // group the slots by identical time window; `sorted` is chronological and
  // Map keeps insertion order, so the windows process chronologically
  const byWindow = new Map<string, Slot[]>();
  for (const sl of sorted) {
    const key = `${sl.period[0]}|${sl.period[1]}`;
    const arr = byWindow.get(key);
    if (arr) arr.push(sl); else byWindow.set(key, [sl]);
  }

  // ── pair pre-plan: reserve crew to exact-8h window pairs ──────────────────
  const winList = [...byWindow.entries()].map(([key, slots]) => ({ key, period: slots[0].period }));
  const byStart = new Map(winList.map((w) => [w.period[0], w]));
  const freeSeatsOf = (key: string) => {
    const slots = byWindow.get(key)!;
    return slots.reduce((s, m) => s + m.seats - g.assignments.filter((a) =>
      a.positionId === m.positionId && a.subPositionId === m.subPositionId
      && a.period[0] === m.period[0]).length, 0);
  };
  const planLeft = new Map(winList.map((w) => [w.key, freeSeatsOf(w.key)]));
  const reservedFor = new Map<number, Set<string>>();   // soldier → his two window keys
  for (const a of winList) {
    const b = byStart.get(a.period[1] + restIdeal);      // partner exactly 8h later
    if (!b) continue;
    let room = Math.min(planLeft.get(a.key)!, planLeft.get(b.key)!);
    if (room <= 0) continue;
    const forNight = overlaps(a.period, g.night);
    const cand = group.filter((st) => !reservedFor.has(st.soldier.id)
      && st.missionHoursToday === 0                       // room for two fresh 4h shifts
      && primaryFit(st, a.period) && primaryFit(st, b.period));
    for (const st of rank(g, cand, pid, forNight, a.period[0], null)) {
      if (room <= 0) break;
      reservedFor.set(st.soldier.id, new Set([a.key, b.key]));
      planLeft.set(a.key, planLeft.get(a.key)! - 1);
      planLeft.set(b.key, planLeft.get(b.key)! - 1);
      room--;
    }
  }
  const reservedElsewhere = (st: SoldierState, wkey: string) => {
    const r = reservedFor.get(st.soldier.id);
    return r !== undefined && !r.has(wkey);
  };

  for (const winSlots of byWindow.values()) {
    const members = [...winSlots].sort((a, b) => (a.subPositionId ?? 0) - (b.subPositionId ?? 0));
    const period = members[0].period;
    const wkey = `${period[0]}|${period[1]}`;
    const forNight = overlaps(period, g.night);
    // rows the exit pre-pass already put in a member occupy its top seats;
    // its soldiers count against the whole window (H7: once per window)
    const capacity = new Map<Slot, number>();
    const nextSeat = new Map<Slot, number>();
    const taken = new Set<number>();
    for (const m of members) {
      const pre = g.assignments.filter((a) => a.positionId === m.positionId
        && a.subPositionId === m.subPositionId && a.period[0] === m.period[0]);
      capacity.set(m, m.seats - pre.length);
      nextSeat.set(m, 1);
      for (const a of pre) taken.add(a.soldierId);
    }
    const totalSeats = members.reduce((s, m) => s + capacity.get(m)!, 0);

    // Phase 1 — set the times: pick the window's soldiers, post-blind
    type Pick = {
      st: SoldierState; pickedFrom: 'primary' | 'rest' | 'fallback';
      viol: string[]; groupNights: number[]; groupLoads: number[];
    };
    const picks: Pick[] = [];
    const snapshot = () => {
      const primary = group.filter((st) => !taken.has(st.soldier.id) && primaryFit(st, period));
      return { groupNights: primary.map((st) => nightsOf(st, forNight)), groupLoads: primary.map(loadOf) };
    };
    // seat the pair-reserved soldiers for this window FIRST (both his windows
    // get him; the earlier one books, the later one re-seats him spaced)
    for (const st of rank(g, group.filter((s) =>
        reservedFor.get(s.soldier.id)?.has(wkey) && !taken.has(s.soldier.id)), pid, forNight, period[0], null)) {
      if (picks.length >= totalSeats || !primaryFit(st, period)) continue;
      const snap = snapshot();
      taken.add(st.soldier.id);
      picks.push({ st, pickedFrom: 'primary', viol: [], groupNights: snap.groupNights, groupLoads: snap.groupLoads });
    }
    // residual seats: soldiers reserved for OTHER windows are held back
    while (picks.length < totalSeats) {
      const evals = group
        .filter((st) => !taken.has(st.soldier.id) && !reservedElsewhere(st, wkey))
        .map((st) => ({ st, fit: fits(g, st, period, false, slotReadiness, slotNightExempt, slotDaily, sticky(st)) }));
      const primary = evals.filter((e) => e.fit.ok && !e.fit.fallback).map((e) => e.st);
      const fallback = evals.filter((e) => e.fit.ok && e.fit.fallback);
      const { groupNights, groupLoads } = snapshot();
      // P5 מ"כ spread, window-local: picks aren't assign()ed until phase 2,
      // so rank()'s staticCommanderAt key can't see a commander already
      // picked for THIS window — prefer non-commanders once the window has
      // one (soft: when only commanders fit, one is still taken)
      const winHasCmd = [...taken].some((id) => state.get(id)?.soldier.isCommander);
      const primaryPreferred = winHasCmd
        ? primary.filter((st) => !st.soldier.isCommander) : primary;
      let picked: SoldierState | undefined = rank(g, primaryPreferred, pid, forNight, period[0], null)[0];
      let pickedFrom: 'primary' | 'rest' | 'fallback' = 'primary';
      let viol: string[] = [];
      if (!picked) {
        // prefer a fully-rested soldier from מנוחה over stacking a second
        // commander in the window (P5 spread) and over an in-group בדוחק pick
        const resters = [...state.values()].filter((st) => st.level1 === restId
          && allowedIn(g, st.soldier, posName));
        const fitting = resters.filter((st) => {
          const f = fits(g, st, period, false, slotReadiness, slotNightExempt, slotDaily, sticky(st));
          return f.ok && !f.fallback;
        });
        const pulled = rank(g, fitting, pid, forNight, period[0], null, true)[0];
        if (pulled) {
          pulled.level1 = pid;
          level1.set(pulled.soldier.id, pid);
          group.push(pulled);
          picked = pulled;
          pickedFrom = 'rest';
          // no violation note (owner, 2026-07-19): with everyone-works,
          // pulling from מנוחה is routine — the pulled_from_rest rationale
          // still records it for the popup
          viol = [];
        }
      }
      if (!picked && winHasCmd) {
        picked = rank(g, primary, pid, forNight, period[0], null)[0];
      }
      if (!picked) {
        // H1 pair completion against the first post that still has a free seat
        const member = members.find((m) => capacity.get(m)! > 0);
        if (member) {
          const paired = tryReplacementPair(g, {
            slot: member, seat: nextSeat.get(member)!, pid, posName,
            commanderSeat: false, forNight, slotNightExempt, slotReadiness, slotDaily,
            takenThisSlot: taken, group, restId,
            buildHalf: (st, half, fitReasons) => buildRationale(g, st, half, pid, {
              pickedFrom: 'primary', fitReasons, commanderSeat: false,
              groupNights: [], groupLoads: [], myNights: 0, myLoad: 0,
            }),
          });
          if (paired) {   // the pair booked both halves itself — seat spent
            capacity.set(member, capacity.get(member)! - 1);
            nextSeat.set(member, nextSeat.get(member)! + 1);
            continue;
          }
        }
      }
      if (!picked && fallback.length) {
        const f = rank(g, fallback.map((e) => e.st), pid, forNight, period[0], null)[0];
        const fe = fallback.find((e) => e.st === f)!;
        picked = f; pickedFrom = 'fallback';
        viol = fe.fit.reasons.map((r) => `בדוחק: ${fitText(r)}`);
      }
      if (!picked) {
        // a flex position's seats above the minimum are a bonus, not an error
        // (a pure static grid has no flex_seats, so a hole is always reported)
        if (flexMin === undefined || picks.length < flexMin) {
          issues.push(`${posName} ${fmtHM(period[0])}-${fmtHM(period[1])} מושב ${picks.length + 1}: לא אויש`);
        }
        break;   // no candidate for this seat — the rest stay empty too
      }
      taken.add(picked.soldier.id);
      picks.push({ st: picked, pickedFrom, viol, groupNights, groupLoads });
    }

    // Phase 2 — distribute to the posts: ONLY even spread counts — fewest
    // prior shifts on that post today; tie → first post in order. Greedy in
    // pick order can corner the LAST pick into a repeat (every repeat-free
    // post already handed out), so the matching is computed first and a
    // repeat-reducing swap pass repairs it before assigning — counts are
    // per-soldier (one appearance per window), so matching-then-assign is
    // behavior-identical to assigning inline.
    const cnt = (st: SoldierState, m: Slot) => g.assignments.filter((a) =>
      a.soldierId === st.soldier.id && a.subPositionId === m.subPositionId).length;
    // P4c cross-day spread (owner 2026-07-24): among posts tied on today's
    // even-spread count, prefer the one this soldier held LEAST over the
    // recent days — so the static grid rotates a soldier across posts across
    // the week, not only within the 24h round (that stays the today-count
    // primary key). Secondary tie-break only; never overrides within-day
    // distinctness.
    const recent = (st: SoldierState, m: Slot) => m.subPositionId != null
      ? (g.ctx.recentSubCount.get(st.soldier.id)?.get(m.subPositionId) ?? 0) : 0;
    const chosen: Slot[] = [];
    for (const p of picks) {
      let member: Slot | undefined;
      let best = Infinity, bestR = Infinity;
      for (const m of members) {
        if (capacity.get(m)! <= 0) continue;
        const n = cnt(p.st, m), r = recent(p.st, m);
        if (n < best || (n === best && r < bestR)) { best = n; bestR = r; member = m; }
      }
      if (!member) break;   // can't happen: |picks| ≤ total capacity
      capacity.set(member, capacity.get(member)! - 1);
      chosen.push(member);
    }
    for (let changed = true; changed;) {   // each swap strictly reduces repeats
      changed = false;
      for (let i = 0; i < chosen.length; i++) {
        for (let j = i + 1; j < chosen.length; j++) {
          if (cnt(picks[i].st, chosen[j]) + cnt(picks[j].st, chosen[i])
              < cnt(picks[i].st, chosen[i]) + cnt(picks[j].st, chosen[j])) {
            [chosen[i], chosen[j]] = [chosen[j], chosen[i]];
            changed = true;
          }
        }
      }
    }
    for (let i = 0; i < chosen.length; i++) {
      const p = picks[i];
      const member = chosen[i];
      const fit = fits(g, p.st, member.period, false, slotReadiness, slotNightExempt, slotDaily, sticky(p.st));
      const rationale = buildRationale(g, p.st, member, pid, {
        pickedFrom: p.pickedFrom, fitReasons: fit.reasons, commanderSeat: false,
        groupNights: p.groupNights, groupLoads: p.groupLoads,
        myNights: nightsOf(p.st, forNight), myLoad: loadOf(p.st),
      });
      if (member.subName) rationale.push({ code: 'sub_spread', params: { sub: member.subName } });
      assign(g, p.st, member, nextSeat.get(member)!, false,
        [...p.viol, ...(p.viol.length ? [] : fitTexts(fit.reasons))], 'auto', rationale);
      nextSeat.set(member, nextSeat.get(member)! + 1);
    }
  }
}

/** מגן weekly changeover (owner 2026-07-20): the whole crew is replaced at the
 *  Sunday 08:00 bus, which falls inside SATURDAY's schedule day. Each מגן seat
 *  becomes a pair split at that bus — an outgoing half (14:00→08:00, a leaver,
 *  preferring yesterday's crew like every day) and an incoming half
 *  (08:00→14:00, the fresh crew: the INCOMING week's מגן commander + his
 *  מחלקה, mixing other platoons only to complete the crew). Runs before the
 *  general fill so the leavers/arrivers aren't spent as single shifts first;
 *  remaining seats fall through to the normal מגן fill. Only active when
 *  tomorrow is a Sunday (ctx.nextMagenCommander set). */
function magenChangeoverPass(g: Gen, plan1: Level1Plan): void {
  const { ctx, state, level1 } = g;
  const cmd = ctx.nextMagenCommander;
  const magenId = ctx.positionByName.get('מגן');
  if (!cmd || magenId === undefined) return;
  const slots = plan1.slotsByPosition.get(magenId);
  if (!slots || !slots.length) return;
  const pos = ctx.positions.get(magenId)!;
  const window = slots[0].period;                        // 14:00 → 14:00
  const bus = window[0] + 18 * 60;                       // next-day 08:00
  const firstHalf: [Minutes, Minutes] = [window[0], bus];
  const secondHalf: [Minutes, Minutes] = [bus, window[1]];
  const nightExempt = pos.config?.night_exempt ?? false;
  const noFloor = pos.config?.no_rest_floor ?? false;
  const cmdPlatoon = state.get(cmd.soldierId)?.soldier.platoon;

  const free = (sid: number, half: [Minutes, Minutes]) =>
    !(ctx.existing.get(sid) ?? []).some((a) => overlaps(a.period, half))
    && !g.assignments.some((a) => a.soldierId === sid && overlaps(a.period, half));
  const halfFit = (st: SoldierState, half: [Minutes, Minutes]) =>
    fits(g, st, half, false, false, nightExempt, true, false, noFloor).ok;

  const pool = [...state.values()].filter((st) => allowedIn(g, st.soldier, 'מגן'));
  const departers = pool.filter((st) => {
    const w = partialWindow(ctx.blocked.get(st.soldier.id) ?? [], window);
    return w?.kind === 'departing' && w.at === bus && free(st.soldier.id, firstHalf) && halfFit(st, firstHalf);
  });
  const arrivers = pool.filter((st) => {
    const w = partialWindow(ctx.blocked.get(st.soldier.id) ?? [], window);
    return w?.kind === 'arriving' && w.at === bus && free(st.soldier.id, secondHalf) && halfFit(st, secondHalf);
  });
  // outgoing halves: yesterday's crew first (continuity), then fairness
  const outQ = rank(g, departers, magenId, true, firstHalf[0]).sort((a, b) =>
    Number(ctx.yesterdayPosition.get(b.soldier.id) === magenId)
    - Number(ctx.yesterdayPosition.get(a.soldier.id) === magenId));
  // incoming halves: the commander, then his מחלקה, then others — fairness within tier
  const tier = (st: SoldierState) => st.soldier.id === cmd.soldierId ? 0
    : st.soldier.platoon === cmdPlatoon ? 1 : 2;
  const inQ = rank(g, arrivers, magenId, false, secondHalf[0], null, true)
    .sort((a, b) => tier(a) - tier(b));

  const preSeats = new Set(g.assignments.filter((a) => a.positionId === magenId
    && a.period[0] === window[0]).map((a) => a.seatIndex));
  let seat = 1;
  const nextFree = () => { while (preSeats.has(seat)) seat++; return seat; };
  const pairs = Math.min(slots[0].seats - preSeats.size, outQ.length, inQ.length);
  for (let i = 0; i < pairs; i++) {
    const d = outQ[i], a = inQ[i];
    const s = nextFree(); preSeats.add(s);
    for (const st of [d, a]) if (st.level1 !== magenId) { st.level1 = magenId; level1.set(st.soldier.id, magenId); }
    const note = `חילופי מגן: החלפה ב-${fmtHM(bus)}`;
    const dRat = buildRationale(g, d, { ...slots[0], period: firstHalf }, magenId, {
      pickedFrom: 'primary', fitReasons: [], commanderSeat: false,
      groupNights: [], groupLoads: [], myNights: 0, myLoad: 0 });
    dRat.push({ code: 'handover_out', params: { handover: fmtHM(bus), partner: a.soldier.name } });
    assign(g, d, { ...slots[0], period: firstHalf }, s, false, [note], 'auto', dRat);
    const aRat = buildRationale(g, a, { ...slots[0], period: secondHalf }, magenId, {
      pickedFrom: 'primary', fitReasons: [], commanderSeat: false,
      groupNights: [], groupLoads: [], myNights: 0, myLoad: 0 });
    if (a.soldier.id === cmd.soldierId) aRat.push({ code: 'magen_commander' });
    aRat.push({ code: 'handover_in', params: { handover: fmtHM(bus), partner: d.soldier.name } });
    assign(g, a, { ...slots[0], period: secondHalf }, s, false, [note], 'auto', aRat);
  }
}

export function fillLevel2(g: Gen, plan1: Level1Plan): void {
  const { ctx, state, issues, level1 } = g;
  const { slotsByPosition, seatPlan, seatRuleBySub } = plan1;
  const restId = ctx.positionByName.get('מנוחה')!;

  exitPrePass(g, plan1);
  magenChangeoverPass(g, plan1);

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
        const posDaily = ctx.positions.get(pid)?.config?.daily ?? false;
        const posNoFloor = ctx.positions.get(pid)?.config?.no_rest_floor ?? false;
        const isCmd = ruleMap.get(subKey)?.commander ?? false;
        if (isSeatPair(pick)) {
          const { d, a, handover } = pick;
          const firstHalf: [Minutes, Minutes] = [slot.period[0], handover];
          const secondHalf: [Minutes, Minutes] = [handover, slot.period[1]];
          const fd = fits(g, d, firstHalf, false, false, nightExempt, posDaily, false, posNoFloor);
          const fa = fits(g, a, secondHalf, false, false, nightExempt, posDaily, false, posNoFloor);
          if (!fd.ok || !fa.ok) {
            const bad = !fd.ok ? d : a;
            const reasons = fitTexts((!fd.ok ? fd : fa).reasons).join(', ');
            issues.push(`${posName} ${slot.subName}: ${bad.soldier.name} חסום (${reasons}) — המושב נשאר ריק`);
            continue;
          }
          const note = `זוג מתחלף: החלפה ב-${fmtHM(handover)}`;
          assign(g, d, { ...slot, period: firstHalf }, 1, isCmd, [note], 'auto',
            [...buildRationale(g, d, { ...slot, period: firstHalf }, pid, {
              pickedFrom: 'primary', fitReasons: fd.reasons, commanderSeat: false,
              groupNights: [], groupLoads: [], myNights: 0, myLoad: 0,
            }), { code: 'handover_out', params: { handover: fmtHM(handover), partner: a.soldier.name } }]);
          assign(g, a, { ...slot, period: secondHalf }, 1, isCmd, [note], 'auto',
            [...buildRationale(g, a, { ...slot, period: secondHalf }, pid, {
              pickedFrom: 'primary', fitReasons: fa.reasons, commanderSeat: false,
              groupNights: [], groupLoads: [], myNights: 0, myLoad: 0,
            }), { code: 'handover_in', params: { handover: fmtHM(handover), partner: d.soldier.name } }]);
          continue;
        }
        const st = pick;
        const fit = fits(g, st, slot.period, false, false, nightExempt, posDaily, false, posNoFloor);
        if (!fit.ok) {
          issues.push(`${posName} ${slot.subName}: ${st.soldier.name} חסום (${fitTexts(fit.reasons).join(', ')}) — המושב נשאר ריק`);
          continue;
        }
        const rationale = buildRationale(g, st, slot, pid, {
          pickedFrom: 'primary', fitReasons: fit.reasons, commanderSeat: false,
          groupNights: [], groupLoads: [], myNights: 0, myLoad: 0,
        });
        assign(g, st, slot, 1, isCmd,
          fit.reasons.map((r) => fit.fallback ? `בדוחק: ${fitText(r)}` : fitText(r)), 'auto', rationale);
      }
      continue;
    }

    // staff_all_roles crew (חמל): everyone in the group takes a seat, no demand math
    if (ctx.positions.get(pid)!.config?.staff_all_roles) {
      const crew = rank(g, [...state.values()].filter((st) => st.level1 === pid), pid, false);
      for (const slot of [...slots].sort((a, b) => a.period[0] - b.period[0])) {
        let seat = 1;
        for (const st of crew) {
          if (seat > slot.seats) break;
          const fit = fits(g, st, slot.period, false, true);
          if (!fit.ok) continue;
          assign(g, st, slot, seat++, false, [], 'auto', buildRationale(g, st, slot, pid, {
            pickedFrom: 'primary', fitReasons: [], commanderSeat: false,
            groupNights: [], groupLoads: [], myNights: 0, myLoad: 0,
          }));
        }
      }
      continue;
    }

    const group = [...state.values()].filter((st) => st.level1 === pid);
    // Chronological order == shift PRIORITY for a scarce driver (owner
    // 2026-07-24): the earliest-starting crew is filled first, claims a driver
    // for its driver seat first, and (with driver preservation below) keeps it
    // — so on a נהג דוד shortage the noon (14:00) crew keeps its driver
    // longest, then night (22:00), and the morning (06:00) crew is the first to
    // go without. This is the Level-2 half of the priority the Level-1 driver
    // quota reserves for.
    const sorted = [...slots].sort((a, b) => a.period[0] - b.period[0]);
    // H6d hard driver rule (config.driver_qual): every crew must include a
    // qualified driver — the seat right after the commander seat is a driver
    // seat until the crew has one
    const driverQual: string | undefined = ctx.positions.get(pid)!.config?.driver_qual;
    const isDriver = (st: SoldierState) => !!driverQual
      && hasQualification(st.soldier.quals, st.soldier.role, driverQual);
    // pure static grid (multi-post windows, no commander/driver seats) —
    // two-phase per-window fill: times first, then even post spread
    const twoPhase = ctx.positions.get(pid)!.missionClass === 'static'
      && !driverQual && !slots.some((s) => s.commanderFirstSeat)
      && new Set(slots.map((s) => s.subPositionId)).size > 1;
    if (twoPhase) {
      fillStaticTwoPhase(g, pid, posName, sorted, group, restId);
      continue;
    }
    for (const slot of sorted) {
      const slotReadiness = ctx.positions.get(slot.positionId)!.missionClass === 'readiness';
      const slotNightExempt = ctx.positions.get(slot.positionId)!.config?.night_exempt ?? false;
      const slotDaily = ctx.positions.get(slot.positionId)!.config?.daily ?? false;
      const slotNoFloor = ctx.positions.get(slot.positionId)!.config?.no_rest_floor ?? false;
      // rows the exit pre-pass already put in this slot occupy its top seats;
      // locked/manual DB rows keep their exact seat indexes — the fill must
      // neither re-issue those (DB seat uniqueness) nor re-book their
      // soldiers in the same crew (H7)
      const pre = g.assignments.filter((a) => a.positionId === slot.positionId
        && a.subPositionId === slot.subPositionId && a.period[0] === slot.period[0]);
      const lockedRows = lockedInSlot(g, slot);
      const takenThisSlot = new Set<number>(
        [...pre.map((a) => a.soldierId), ...lockedRows.map((l) => l.soldierId)]);
      const usedSeats = new Set<number>(
        [...pre.map((a) => a.seatIndex), ...lockedRows.map((l) => l.seatIndex)]);
      // locked soldiers may be outside the loaded state (e.g. import rows)
      const crewHasDriver = () => [...takenThisSlot].some((id) => {
        const s = state.get(id);
        return !!s && isDriver(s);
      });
      let driverTried = false;
      for (let seat = 1; seat <= slot.seats; seat++) {
        if (usedSeats.has(seat)) continue;
        const commanderSeat = slot.commanderFirstSeat && seat === 1;
        // H6d: the first free non-commander seat is the driver seat until the
        // crew (pre-pass + locked rows included) has a qualified driver
        const driverSeat = !!driverQual && !commanderSeat && !driverTried && !crewHasDriver();
        if (driverSeat) driverTried = true;
        const forNight = overlaps(slot.period, g.night);
        // H9 exit-window exemption: a returning continuity member's exit
        // window does not block his own crew's daily row (מגן stickiness),
        // and a night-exit soldier's window does not block a night_exit_ok
        // duty (תורנים) — fits' ignoreExitWindows flag
        const sticky = (st: SoldierState) => exitExempt(g, st.soldier.id, pid);
        const evals = group
          .filter((st) => !takenThisSlot.has(st.soldier.id))
          .filter((st) => !driverSeat || isDriver(st))
          .map((st) => ({ st, fit: fits(g, st, slot.period, commanderSeat, slotReadiness, slotNightExempt, slotDaily, sticky(st), slotNoFloor) }));
        const primary = evals.filter((e) => e.fit.ok && !e.fit.fallback).map((e) => e.st);
        const fallback = evals.filter((e) => e.fit.ok && e.fit.fallback);
        // pre-pick snapshot of the primary group's fairness keys (the exact
        // formulas rank() uses) — comparative rationale must not drift with
        // later state
        const groupNights = primary.map((st) => nightsOf(st, forNight));
        const groupLoads = primary.map(loadOf);
        // positions with commander seats (סיור/התקפי): a regular seat prefers
        // non-commanders so the group's few commanders stay available for a
        // LATER shift's commander seat (e.g. the 06:00 patrol) — soft: when
        // only commanders fit, one is still taken. Same preservation for
        // qualified drivers (H6d): a regular seat prefers non-drivers, or the
        // P5 night preference would spend a SECOND scarce driver on a plain
        // seat and starve a later shift's driver seat (daily cap: one shift
        // per driver). Preservation is FUTURE-looking only — on a position's
        // last (or only) slot there is nothing to save the role for, and a
        // single-slot crew (התקפי) must seat its own quota members.
        const hasLaterSlot = slots.some((s) => s.period[0] > slot.period[0]);
        const preserveCommanders = !commanderSeat
          && slots.some((s) => s.commanderFirstSeat && s.period[0] > slot.period[0]);
        const preserveDrivers = !!driverQual && !driverSeat && hasLaterSlot;
        const notCmd = preserveCommanders
          ? primary.filter((st) => !st.soldier.isCommander) : primary;
        const primaryPreferred = preserveDrivers
          ? notCmd.filter((st) => !isDriver(st)) : notCmd;
        let picked: SoldierState | undefined =
          rank(g, primaryPreferred, pid, forNight, slot.period[0], slot.subPositionId)[0];
        let pickedFrom: 'primary' | 'rest' | 'fallback' = 'primary';
        let viol: string[] = [];
        if (!picked) {
          // prefer a fully-rested soldier from מנוחה over SPENDING a
          // preserved commander/driver on a plain seat (their scarcity is
          // what empties later commander/driver seats) and over an in-group
          // בדוחק pick
          const resters = [...state.values()].filter((st) => st.level1 === restId
            && allowedIn(g, st.soldier, posName)
            && (!commanderSeat || st.soldier.isCommander)
            && (!driverSeat || isDriver(st)));
          const fitting = resters.filter((st) => {
            const f = fits(g, st, slot.period, commanderSeat, slotReadiness, slotNightExempt, slotDaily, sticky(st), slotNoFloor);
            return f.ok && !f.fallback;
          });
          const pulled = rank(g, fitting, pid, forNight, slot.period[0], slot.subPositionId, true)[0];
          if (pulled) {
            pulled.level1 = pid;
            level1.set(pulled.soldier.id, pid);
            group.push(pulled);
            picked = pulled;
            pickedFrom = 'rest';
            // no violation note (owner, 2026-07-19): with everyone-works,
            // pulling from מנוחה is routine — the pulled_from_rest rationale
            // still records it for the popup
            viol = [];
          }
        }
        // no rested substitute — spend a preserved driver, then a commander
        if (!picked) {
          picked = (preserveDrivers && notCmd.length > primaryPreferred.length
            ? rank(g, notCmd, pid, forNight, slot.period[0], slot.subPositionId)[0] : undefined)
            ?? (preserveCommanders && primary.length > notCmd.length
              ? rank(g, primary, pid, forNight, slot.period[0], slot.subPositionId)[0] : undefined);
          if (picked) pickedFrom = 'primary';
        }
        if (!picked) {
          const paired = tryReplacementPair(g, {
            slot, seat, pid, posName, commanderSeat, forNight, slotNightExempt,
            slotReadiness, slotDaily, slotNoFloor, isDriverSeat: driverSeat ? isDriver : undefined,
            takenThisSlot, group, restId,
            buildHalf: (st, half, fitReasons) => buildRationale(g, st, half, pid, {
              pickedFrom: 'primary', fitReasons, commanderSeat,
              groupNights: [], groupLoads: [], myNights: 0, myLoad: 0,
            }),
          });
          if (paired) continue;   // seat covered by the pair — next seat
        }
        if (!picked && fallback.length) {
          const f = rank(g, fallback.map((e) => e.st), pid, forNight, slot.period[0], slot.subPositionId)[0];
          const fe = fallback.find((e) => e.st === f)!;
          picked = f; pickedFrom = 'fallback';
          viol = fe.fit.reasons.map((r) => `בדוחק: ${fitText(r)}`);
        }
        if (!picked) {
          // flex positions (מגן 10–12, סיור 3–4): seats above the flex
          // minimum are a bonus, not a requirement — an empty one is not
          // reported as long as the minimum is met
          const flexMin: number | undefined =
            ctx.positions.get(pid)!.config?.flex_seats?.min;
          const filled = g.assignments.filter((a) => a.positionId === slot.positionId
            && a.subPositionId === slot.subPositionId && a.period[0] === slot.period[0]).length
            + lockedRows.length;
          if (flexMin === undefined || filled < flexMin) {
            issues.push(`${posName} ${fmtHM(slot.period[0])}-${fmtHM(slot.period[1])} מושב ${seat}${commanderSeat ? ' (מפקד)' : driverSeat ? ' (נהג)' : ''}: לא אויש`);
          }
          continue;
        }
        takenThisSlot.add(picked.soldier.id);
        const fit = fits(g, picked, slot.period, commanderSeat, slotReadiness, slotNightExempt, slotDaily, sticky(picked), slotNoFloor);
        const rationale = buildRationale(g, picked, slot, pid, {
          pickedFrom, fitReasons: fit.reasons, commanderSeat, groupNights, groupLoads,
          myNights: nightsOf(picked, forNight), myLoad: loadOf(picked),
        });
        if (driverSeat) rationale.push({ code: 'driver_seat', params: { qual: driverQual! } });
        assign(g, picked, slot, seat, commanderSeat,
          [...viol, ...(viol.length ? [] : fitTexts(fit.reasons))], 'auto', rationale);
      }
    }
  }
}

// ─── post-fill short-rest repair ─────────────────────────────────────────────

/** A gap under the 8h ideal between two of a soldier's same-day shifts is
 *  acceptable only when unavoidable (owner 2026-07-20). After the slot fill,
 *  trade a short-rested shift for another soldier's seat in the SAME position
 *  when the trade leaves both soldiers fully legal and strictly reduces the
 *  day's short-gap count. Only plain auto seats move — commander seats,
 *  seat-rule / staff / driver-qual / daily positions and exit-day soldiers
 *  (window-bound packing) are untouched. Swapped rows are tagged rest_repair
 *  (the report renders them as a dedicated step); the short gaps that remain
 *  are genuinely unavoidable. */
export function repairShortRests(g: Gen): void {
  const restIdeal = g.ctx.tunables.restIdealH * 60;
  const restMin = g.ctx.tunables.restMinH * 60;
  const posOk = (pid: number) => {
    const p = g.ctx.positions.get(pid);
    return !!p && p.missionClass !== 'readiness' && !p.config?.seat_rules
      && !p.config?.staff_all_roles && !p.config?.driver_qual
      && !(p.config?.daily ?? false);
  };
  const rowOk = (a: Assignment) => a.source === 'auto' && !a.isCommanderSeat
    && posOk(a.positionId) && !g.ctx.exits.has(a.soldierId);
  const isNightRow = (period: [Minutes, Minutes], pid: number) => {
    const p = g.ctx.positions.get(pid);
    return overlaps(period, g.night)
      && isCountedNight(p?.missionClass ?? '', p?.config?.night_exempt);
  };
  /** blocking periods of a soldier after a hypothetical swap */
  const simPeriods = (sid: number, out?: Assignment, into?: Assignment): [Minutes, Minutes][] => {
    const ps = g.assignments
      .filter((a) => a.soldierId === sid && a.blocksOverlap && a !== out)
      .map((a) => a.period);
    if (into) ps.push(into.period);
    return ps.sort((a, b) => a[0] - b[0]);
  };
  const shortGaps = (ps: [Minutes, Minutes][]): number => {
    let n = 0;
    for (let i = 1; i < ps.length; i++) {
      if (ps[i][0] - ps[i - 1][1] < restIdeal) n++;
    }
    return n;
  };
  /** hard legality of the simulated day: no overlap, no gap under the floor */
  const legal = (ps: [Minutes, Minutes][]): boolean => {
    for (let i = 1; i < ps.length; i++) {
      const gap = ps[i][0] - ps[i - 1][1];
      if (gap < 0 || gap < restMin) return false;
    }
    return true;
  };
  const sameSubClash = (sid: number, into: Assignment, out: Assignment): boolean =>
    into.subPositionId !== null && g.assignments.some((a) => a !== out && a !== into
      && a.soldierId === sid && a.positionId === into.positionId
      && a.subPositionId === into.subPositionId);

  let guard = 24;
  outer: while (guard-- > 0) {
    for (const mine of g.assignments) {
      if (!rowOk(mine)) continue;
      const myPeriods = simPeriods(mine.soldierId);
      if (!shortGaps(myPeriods)) continue;                       // soldier is fine
      for (const theirs of g.assignments) {
        if (theirs === mine || !rowOk(theirs)) continue;
        if (theirs.positionId !== mine.positionId) continue;     // same-position trades only
        if (theirs.soldierId === mine.soldierId) continue;
        if (theirs.period[0] === mine.period[0]) continue;       // same window — no gap change
        if (hours(theirs.period) !== hours(mine.period)) continue; // keep daily caps intact
        if (isBlocked(g, mine.soldierId, theirs.period)
          || isBlocked(g, theirs.soldierId, mine.period)) continue;
        if (sameSubClash(mine.soldierId, theirs, mine)
          || sameSubClash(theirs.soldierId, mine, theirs)) continue;
        const myAfter = simPeriods(mine.soldierId, mine, theirs);
        const theirAfter = simPeriods(theirs.soldierId, theirs, mine);
        if (!legal(myAfter) || !legal(theirAfter)) continue;
        const before = shortGaps(myPeriods) + shortGaps(simPeriods(theirs.soldierId));
        const after = shortGaps(myAfter) + shortGaps(theirAfter);
        if (after >= before) continue;
        // apply: exchange the soldiers between the two rows + fix live state
        const s1 = g.state.get(mine.soldierId)!, s2 = g.state.get(theirs.soldierId)!;
        const swapInterval = (st: SoldierState, out: [Minutes, Minutes], into: [Minutes, Minutes]) => {
          const i = st.intervals.findIndex((iv) => iv[0] === out[0] && iv[1] === out[1]);
          if (i >= 0) st.intervals.splice(i, 1);
          st.intervals.push(into);
        };
        swapInterval(s1, mine.period, theirs.period);
        swapInterval(s2, theirs.period, mine.period);
        const n1 = isNightRow(mine.period, mine.positionId) ? 1 : 0;
        const n2 = isNightRow(theirs.period, theirs.positionId) ? 1 : 0;
        s1.nightsToday += n2 - n1;
        s2.nightsToday += n1 - n2;
        [mine.soldierId, theirs.soldierId] = [theirs.soldierId, mine.soldierId];
        mine.rationale.push({ code: 'rest_repair',
          params: { partner: s1.soldier.name, was: fmtHM(theirs.period[0]) } });
        theirs.rationale.push({ code: 'rest_repair',
          params: { partner: s2.soldier.name, was: fmtHM(mine.period[0]) } });
        continue outer;
      }
    }
    break;
  }
}
