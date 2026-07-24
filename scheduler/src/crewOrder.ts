// Shared, generic crew DISPLAY ordering: commander(s) first, then the
// remaining soldiers grouped by מחלקה (platoon) — e.g. התקפי's group_size:4
// (1 מפקד + 3 same-platoon soldiers) should render as "the commander, then
// his three platoon-mates together" rather than raw seatIndex order.
//
// This is a pure PRESENTATION helper — it never affects generation/fill
// decisions, only how an already-assigned crew is rendered. Two call sites:
//   - the HTML report (report.ts) — main shift grid + chain (כרמל/גשש) crews.
//   - the viewer's draft/DB-sourced display (DraftSchedule.tsx), which
//     imports this file directly (see src/components/DraftSchedule.tsx).
// The live Google-Sheet tab (Shavtzak.tsx's buildSheetDisplayGroups) is
// UNTOUCHED — sheet rows carry no reliable platoon data and this module is
// never imported there.
//
// Intentionally import-free (mirrors rationale.ts): the frontend (Vite)
// bundles this file directly, and Vite must not have to resolve
// scheduler-style './x.js' specifiers, so the tiny name-normalization this
// needs is duplicated inline rather than importing text.ts.

/** Strip quote marks (״ " ׳ ' `), collapse whitespace, trim — same rule as
 *  text.ts's normalizeName, duplicated here to keep this file import-free. */
function nrm(s: string | null | undefined): string {
  return (s ?? '').replace(/[״"׳'`]/g, '').replace(/\s+/g, ' ').trim();
}

/** Same commander role set as report.ts's BOLD_ROLES / Shavtzak.tsx's
 *  BOLD_ROLES — מ"מ / מ"פ / סמ"פ / סמל / מ"כ (normalized, quote-free). */
export const DEFAULT_COMMANDER_ROLES: readonly string[] = ['ממ', 'מפ', 'סמפ', 'סמל', 'מכ'];

export interface CrewMember {
  /** free-text role/rank (e.g. מ"כ, רובאי) — matched against commanderRoles */
  role: string;
  /** מחלקה — grouping key for non-commander soldiers */
  platoon: string;
  /** original seat/array position — the stable tie-break within a group */
  seatIndex: number;
  /** display name — secondary stable tie-break (ties on seatIndex) */
  name: string;
}

export interface OrderCrewOptions {
  /** override the commander role set (defaults to DEFAULT_COMMANDER_ROLES) */
  commanderRoles?: readonly string[];
}

/** True when `role` matches one of the commander roles (containment, same as
 *  BOLD_ROLES's `nrm(role).includes(r)` check in report.ts/Shavtzak.tsx). */
export function isCommanderRole(
  role: string | null | undefined,
  commanderRoles: readonly string[] = DEFAULT_COMMANDER_ROLES,
): boolean {
  const r = nrm(role);
  return commanderRoles.some((cr) => r.includes(cr));
}

/**
 * Order a crew for display: commander(s) first, then the remaining soldiers
 * grouped by platoon (each platoon's members kept together; platoons appear
 * in first-encountered order). Stable throughout: soldiers within the
 * commander block and within each platoon group keep their relative
 * seatIndex/name order.
 *
 * Generic over T so any call site can carry extra fields through untouched
 * (report.ts wraps a ReportAssignment; the viewer wraps a plain name).
 */
export function orderCrew<T extends CrewMember>(
  soldiers: readonly T[],
  opts: OrderCrewOptions = {},
): T[] {
  const commanderRoles = opts.commanderRoles ?? DEFAULT_COMMANDER_ROLES;
  const bySeat = (a: T, b: T) => a.seatIndex - b.seatIndex || a.name.localeCompare(b.name, 'he');
  const sorted = [...soldiers].sort(bySeat);

  const commanders: T[] = [];
  const rest: T[] = [];
  for (const s of sorted) {
    (isCommanderRole(s.role, commanderRoles) ? commanders : rest).push(s);
  }

  // Group `rest` by platoon, preserving each platoon's first-appearance
  // order (Map iteration order == insertion order) and each member's
  // relative order within its platoon (already stable from `sorted`).
  const groups = new Map<string, T[]>();
  for (const s of rest) {
    const key = s.platoon ?? '';
    const g = groups.get(key);
    if (g) g.push(s); else groups.set(key, [s]);
  }
  const restGrouped: T[] = [];
  for (const g of groups.values()) restGrouped.push(...g);

  return [...commanders, ...restGrouped];
}
