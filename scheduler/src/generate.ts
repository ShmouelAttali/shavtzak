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
import { GenerateResult } from './model.js';
import { buildGen } from './state.js';
import { runLevel1 } from './level1.js';
import { fillLevel2 } from './level2.js';
import { runChain } from './chains.js';

// Re-exported so cli.ts / api/draft.ts keep importing { generate, persist };
// trackerPickOrder is re-exported for its unit tests.
export { persist } from './persist.js';
export { trackerPickOrder } from './chains.js';
export type { GenerateResult } from './model.js';

export async function generate(day: string): Promise<GenerateResult> {
  const ctx = await loadContext(day);
  const g = buildGen(ctx);

  // Level 1: partition available soldiers into positions + מנוחה
  const plan = runLevel1(g);

  // Chains run in two passes around Level 2: a rule whose source crew
  // descended on a PREVIOUS day (sourceDayOffset < 0) is fully determined
  // before Level 2 runs, so it is applied FIRST — the standby row is reserved
  // (H3/H3b) and the general fill schedules around it instead of booking the
  // whole descending crew during the window. Same-day rules need Level 2's
  // fresh patrol/defense rows and run after it.
  for (const rule of ctx.chainRules.filter((r) => r.sourceDayOffset < 0)) runChain(g, rule);
  fillLevel2(g, plan);
  for (const rule of ctx.chainRules.filter((r) => r.sourceDayOffset >= 0)) runChain(g, rule);

  // Everyone works (owner rule): report every soldier who STILL rests after
  // Level 2 (its pull-from-מנוחה path may have rescued Level-1 leftovers).
  // Unchosen seat-rule candidates (surviving seatRestrict — e.g. the unpicked
  // מ"פ/סמ"פ of the חפק commander seat) rest BY DESIGN (H6b: no substitutes,
  // reserved to their seat) — not a planning failure, so not reported.
  const restId = ctx.positionByName.get('מנוחה');
  if (restId !== undefined) {
    for (const st of g.state.values()) {
      if (st.level1 === restId && !g.seatRestrict.has(st.soldier.id)) {
        g.issues.push(`${st.soldier.name} נותר במנוחה — כל חייל זמין אמור לעבוד`);
      }
    }
  }

  return { day, assignments: g.assignments, level1: g.level1, issues: g.issues };
}
