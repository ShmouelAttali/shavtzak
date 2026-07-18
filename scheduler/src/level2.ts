// Level 2 (SPEC §7): fill the concrete slots inside each Level-1 position
// group — seat-rule plans, staff_all_roles crews, then the general ranked
// fill with the pull-from-מנוחה and H1 replacement-pair completion paths.
// Also owns buildRationale(), the structured "why picked" snapshot.

import { Minutes, fmtHM, overlaps } from './time.js';
import { Slot } from './model.js';
import { RationaleEntry } from './rationale.js';
import { normalizeName as nrm, hasQualification } from './text.js';
import { Gen, SoldierState, allowedIn, assign } from './state.js';
import { fits, restInfo, fitText, fitTexts, FitReason, FIT_RATIONALE } from './rest.js';
import { rank, rotationPenalty, nightsOf, loadOf } from './rank.js';
import { tryReplacementPair } from './pairs.js';
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

export function fillLevel2(g: Gen, plan1: Level1Plan): void {
  const { ctx, state, issues, level1 } = g;
  const { slotsByPosition, seatPlan, seatRuleBySub } = plan1;
  const restId = ctx.positionByName.get('מנוחה')!;

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
          const fd = fits(g, d, firstHalf, false, false, nightExempt);
          const fa = fits(g, a, secondHalf, false, false, nightExempt);
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
        const fit = fits(g, st, slot.period, false, false, nightExempt);
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
    const sorted = [...slots].sort((a, b) => a.period[0] - b.period[0]);
    // H6d hard driver rule (config.driver_qual): every crew must include a
    // qualified driver — the seat right after the commander seat is a driver
    // seat until the crew has one
    const driverQual: string | undefined = ctx.positions.get(pid)!.config?.driver_qual;
    const isDriver = (st: SoldierState) => !!driverQual
      && hasQualification(st.soldier.quals, st.soldier.role, driverQual);
    for (const slot of sorted) {
      const slotReadiness = ctx.positions.get(slot.positionId)!.missionClass === 'readiness';
      const slotNightExempt = ctx.positions.get(slot.positionId)!.config?.night_exempt ?? false;
      const takenThisSlot = new Set<number>();   // H7: no duplicate soldier in a crew
      for (let seat = 1; seat <= slot.seats; seat++) {
        const commanderSeat = slot.commanderFirstSeat && seat === 1;
        const driverSeat = !!driverQual && seat === (slot.commanderFirstSeat ? 2 : 1)
          && ![...takenThisSlot].some((id) => isDriver(state.get(id)!));
        const forNight = overlaps(slot.period, g.night);
        const evals = group
          .filter((st) => !takenThisSlot.has(st.soldier.id))
          .filter((st) => !driverSeat || isDriver(st))
          .map((st) => ({ st, fit: fits(g, st, slot.period, commanderSeat, slotReadiness, slotNightExempt) }));
        const primary = evals.filter((e) => e.fit.ok && !e.fit.fallback).map((e) => e.st);
        const fallback = evals.filter((e) => e.fit.ok && e.fit.fallback);
        // pre-pick snapshot of the primary group's fairness keys (the exact
        // formulas rank() uses) — comparative rationale must not drift with
        // later state
        const groupNights = primary.map((st) => nightsOf(st, forNight));
        const groupLoads = primary.map(loadOf);
        // positions with commander seats (סיור/התקפי): a regular seat prefers
        // non-commanders so the group's few commanders stay available for the
        // remaining commander seats (e.g. the 06:00 patrol) — soft: when only
        // commanders fit, one is still taken
        const preserveCommanders = !commanderSeat && slots.some((s) => s.commanderFirstSeat);
        const primaryPreferred = preserveCommanders
          ? primary.filter((st) => !st.soldier.isCommander) : primary;
        let picked = rank(g, primaryPreferred, pid, forNight, slot.period[0], slot.subPositionId)[0]
          ?? (preserveCommanders
            ? rank(g, primary, pid, forNight, slot.period[0], slot.subPositionId)[0] : undefined);
        let pickedFrom: 'primary' | 'rest' | 'fallback' = 'primary';
        let viol: string[] = [];
        if (!picked) {
          // prefer a fully-rested soldier from מנוחה over an in-group בדוחק pick
          const resters = [...state.values()].filter((st) => st.level1 === restId
            && allowedIn(g, st.soldier, posName)
            && (!commanderSeat || st.soldier.isCommander)
            && (!driverSeat || isDriver(st)));
          const fitting = resters.filter((st) => {
            const f = fits(g, st, slot.period, commanderSeat, slotReadiness, slotNightExempt);
            return f.ok && !f.fallback;
          });
          const pulled = rank(g, fitting, pid, forNight, slot.period[0], slot.subPositionId)[0];
          if (pulled) {
            pulled.level1 = pid;
            level1.set(pulled.soldier.id, pid);
            group.push(pulled);
            picked = pulled;
            pickedFrom = 'rest';
            viol = ['הושלם ממנוחה'];
          }
        }
        if (!picked && !slotReadiness && !driverSeat) {
          const paired = tryReplacementPair(g, {
            slot, seat, pid, posName, commanderSeat, forNight, slotNightExempt,
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
          issues.push(`${posName} ${fmtHM(slot.period[0])}-${fmtHM(slot.period[1])} מושב ${seat}${commanderSeat ? ' (מפקד)' : driverSeat ? ' (נהג)' : ''}: לא אויש`);
          continue;
        }
        takenThisSlot.add(picked.soldier.id);
        const fit = fits(g, picked, slot.period, commanderSeat, slotReadiness, slotNightExempt);
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
