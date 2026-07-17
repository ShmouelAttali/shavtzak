// Shared text normalization for Hebrew data keys (soldier names, position
// names, roles, sub-position/seat keys). The sheet and hand-edited DB rows mix
// quote variants (״ " ׳ ' `) and stray spaces — every comparison must go
// through ONE normalizer so the three former hand-copies can't drift.

/** Strip quote marks (״ " ׳ ' `), collapse whitespace, trim. */
export function normalizeName(s: string | null | undefined): string {
  return (s ?? '').replace(/[״"׳'`]/g, '').replace(/\s+/g, ' ').trim();
}

/** Qualification match (H6b `qual`, P5 driver fit): the roster records
 *  driver/medic qualifications either in soldier_qualifications or inside the
 *  free-text role (תפקיד), so both are checked, normalized, by containment. */
export function hasQualification(quals: string[], role: string, qual: string): boolean {
  const q = normalizeName(qual);
  return [...quals, role].some((x) => normalizeName(x).includes(q));
}
