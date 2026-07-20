// The generator pipeline (SPEC §7). All logic lives in the focused modules —
// this file only wires them together:
//   load.ts    — read the day's Context from the DB (the only read-path SQL)
//   state.ts   — SoldierState + the mutable Gen bag + assign()
//   level1.ts  — partition soldiers into positions (locks, H6b seats,
//                staff_all_roles, continuity, demand fill, מנוחה/בבית)
//   chains.ts  — T4 overlays (כרמל, כונן גשש) from descending crews
//   level2.ts  — fill concrete slots (rank, pull-from-מנוחה, H1 pairs,
//                בדוחק fallback) + buildRationale
//   rank.ts / rest.ts / pairs.ts — the shared decision primitives
//   persist.ts — the only write-path SQL
import { loadContext } from './load.js';
import { GenerateResult, ReportMeta } from './model.js';
import { buildGen, fullyBlocked, Gen } from './state.js';
import { runLevel1, reserveSeatCandidates, demand, Level1Plan } from './level1.js';
import { fillLevel2, repairShortRests } from './level2.js';
import { runChain } from './chains.js';
import { partialWindow } from './pairs.js';
import { overlaps } from './time.js';

// Re-exported so cli.ts / api/draft.ts keep importing { generate, persist };
// trackerPickOrder is re-exported for its unit tests.
export { persist } from './persist.js';
export { trackerPickOrder } from './chains.js';
export type { GenerateResult } from './model.js';

/** Max seats per shift, per position (flex sizing mutates Slot.seats in
 *  place — snapshotted before/after Level 1 for the report's narrative). */
function maxSeatsByPosition(g: Gen): Map<number, number> {
  const m = new Map<number, number>();
  for (const s of g.ctx.slots) m.set(s.positionId, Math.max(m.get(s.positionId) ?? 0, s.seats));
  return m;
}

/** Baseline per-position demand BEFORE flex sizing mutates seat counts —
 *  mirrors runLevel1's slot grouping (scheduled, non-rest, non-overlay). */
function baselineDemand(g: Gen): Record<string, number> {
  const chainTargets = new Set(g.ctx.chainRules.map((r) => r.targetPosition));
  const byPos = new Map<number, typeof g.ctx.slots>();
  for (const slot of g.ctx.slots) {
    const p = g.ctx.positions.get(slot.positionId)!;
    if (!p.isScheduled || p.missionClass === 'rest' || chainTargets.has(p.id)) continue;
    byPos.set(slot.positionId, [...(byPos.get(slot.positionId) ?? []), slot]);
  }
  return Object.fromEntries([...byPos].map(([pid, slots]) => [pid, demand(g, pid, slots)]));
}

/** Report side-channel (src/report.ts): derived from Context + Level-1
 *  outputs AFTER generation — no generator module is touched for it. */
function buildReportMeta(g: Gen, plan: Level1Plan, seatsBefore: Map<number, number>,
                         demandBefore: Record<string, number>): ReportMeta {
  const { ctx } = g;
  const chainTargets = new Set(ctx.chainRules.map((r) => r.targetPosition));
  const seatsAfter = maxSeatsByPosition(g);
  const flex: ReportMeta['flex'] = [];
  for (const [pid, before] of seatsBefore) {
    const after = seatsAfter.get(pid) ?? before;
    if (after !== before) flex.push({ positionId: pid, before, after });
  }
  return {
    soldiers: [...ctx.soldiers.values()].map((s) => {
      const f = ctx.fairness.get(s.id);
      return {
        id: s.id, name: s.name, platoon: s.platoon, role: s.role,
        nights7d: f?.nightCount7d ?? 0,
        weightedHours7d: f?.weightedHours7d ?? 0,
        positionCounts: f?.positionCounts ?? {},
        allowedPositions: s.allowedPositions,
      };
    }),
    positions: [...ctx.positions.values()].map((p) => ({
      id: p.id, name: p.name, missionClass: p.missionClass,
      daily: !!p.config.daily, chainOverlay: chainTargets.has(p.id),
      staffAllRoles: !!p.config.staff_all_roles,
    })),
    blocked: Object.fromEntries([...ctx.blocked]),
    exits: Object.fromEntries([...ctx.exits]),
    locks: [
      ...[...ctx.lockedDay].map(([sid, pid]) => ({
        soldierId: sid, positionName: ctx.positions.get(pid)?.name ?? String(pid),
        kind: 'day' as const,
      })),
      ...ctx.lockedShift.map((l) => ({
        soldierId: l.soldierId,
        positionName: ctx.positions.get(l.positionId)?.name ?? String(l.positionId),
        kind: 'shift' as const,
      })),
    ],
    pools: [...ctx.positions.values()]
      .filter((p) => p.config?.candidate_pool)
      .map((p) => {
        // membership = position_candidates rows with sub NULL; names ride
        // along from the load-time join (display only)
        const members = (p.candidates ?? []).filter((c) => c.subPositionId === null);
        return {
          position: p.name,
          members: members.map((c) => c.name),
          unavailable: members.filter((c) => {
            const st = g.state.get(c.soldierId);
            return !st || fullyBlocked(g, st.soldier.id);
          }).map((c) => c.name),
        };
      }),
    seatReserved: [...g.seatRestrict.keys()].map(String),
    level1Rationale: Object.fromEntries([...g.state.values()]
      .filter((st) => st.level1Rationale.length)
      .map((st) => [st.soldier.id, st.level1Rationale])),
    demand: Object.fromEntries([...plan.slotsByPosition]
      .map(([pid, slots]) => [pid, demand(g, pid, slots)])),
    demandBefore,
    flex,
    magenCommander: ctx.magenCommander?.name,
    subNames: Object.fromEntries(ctx.slots
      .filter((s) => s.subPositionId !== null)
      .map((s) => [s.subPositionId!, s.subName ?? ''])),
    restPositionId: ctx.positionByName.get('מנוחה'),
    homePositionId: ctx.positionByName.get('בבית'),
  };
}

/** Retract Level-1 bucket shortages ("X: חסרים N חיילים") that Level 2 fully
 *  repaired — replacement pairs / pull-from-מנוחה can cover every seat of a
 *  position whose Level-1 head-count came up short (e.g. תורנים on a
 *  mass-exchange day: each seat is manned by a departing+arriving pair). A
 *  bucket warning that contradicts a fully-covered grid is noise (owner
 *  2026-07-19). Quota shortages (מפקדים/נהגים) are NOT retracted — a covered
 *  seat may still be manned by a non-commander/non-driver fallback. */
export function retractCoveredShortages(issues: string[]): string[] {
  const short = /^(.+?): חסרים \d+ חיילים$/;
  return issues.filter((i) => {
    const m = i.match(short);
    if (!m) return true;
    // keep the shortage only while some seat of the position is really empty
    return issues.some((o) => o.startsWith(`${m[1]} `) && /(לא אויש|חסום)/.test(o));
  });
}

export async function generate(day: string): Promise<GenerateResult> {
  const ctx = await loadContext(day);
  const g = buildGen(ctx);
  const seatsBefore = maxSeatsByPosition(g);
  const demandBefore = baselineDemand(g);

  // Chains run in two passes around the fill: a rule whose source crew
  // descended on a PREVIOUS day (sourceDayOffset < 0) is fully determined by
  // yesterday's persisted rows — its picks don't depend on Level-1 state — so
  // it is applied BEFORE Level 1: the standby row is reserved (H3/H3b) and
  // Level 1 already sees the commitment (a chained soldier is never handed a
  // position whose windows he can't hold — e.g. the התקפי driver quota must
  // not spend a tiger driver on someone standing by for כרמל). Same-day rules
  // need Level 2's fresh patrol/defense rows and run after it.
  reserveSeatCandidates(g);   // H6b holds in the pre-Level-1 chains too
  for (const rule of ctx.chainRules.filter((r) => r.sourceDayOffset < 0)) runChain(g, rule);

  // Level 1: partition available soldiers into positions + מנוחה
  const plan = runLevel1(g);
  fillLevel2(g, plan);
  repairShortRests(g);   // before the chains — they source the FINAL crews
  for (const rule of ctx.chainRules.filter((r) => r.sourceDayOffset >= 0)) runChain(g, rule);
  g.issues = retractCoveredShortages(g.issues);

  // Everyone works (owner rule): report every soldier who STILL rests after
  // Level 2 (its pull-from-מנוחה path may have rescued Level-1 leftovers).
  // Unchosen seat-rule candidates (surviving seatRestrict — e.g. the unpicked
  // מ"פ/סמ"פ of the חפק commander seat) rest BY DESIGN (H6b: no substitutes,
  // reserved to their seat) — not a planning failure, so not reported.
  const restId = ctx.positionByName.get('מנוחה');
  if (restId !== undefined) {
    // chained overlays (כרמל/כונן גשש) are derived standbys, not a day's
    // position — a soldier whose ONLY row is such a standby still counts as
    // unassigned; any other pre-existing row is a real position assignment
    const chainTargets = new Set(ctx.chainRules.map((r) => r.targetPosition));
    for (const st of g.state.values()) {
      if (st.level1 === restId && !g.seatRestrict.has(st.soldier.id)) {
        // pre-existing rows (import/manual/locked — e.g. regenerating over a
        // published day) already give the soldier real work today: he is not
        // resting, the fresh partition just couldn't claim him (busyElsewhere)
        const worksAlready = (ctx.existing.get(st.soldier.id) ?? [])
          .some((a) => !chainTargets.has(a.positionId) && overlaps(a.period, g.dRange));
        if (worksAlready) continue;
        // a partial-day soldier (bus arrival / departure — a leaver/arriver on
        // an exchange day) is only available for part of the schedule day; if
        // no shift fit his window it's EXPECTED rest, not an everyone-works
        // violation (owner 2026-07-20). The report/validator don't flag it.
        if (partialWindow(g.ctx.blocked.get(st.soldier.id) ?? [], g.dRange)) continue;
        g.issues.push(`${st.soldier.name} נותר במנוחה — כל חייל זמין אמור לעבוד`);
      }
    }
  }

  return {
    day, assignments: g.assignments, level1: g.level1, issues: g.issues,
    report: buildReportMeta(g, plan, seatsBefore, demandBefore),
  };
}
