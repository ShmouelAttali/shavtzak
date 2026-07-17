// Shared text normalization for Hebrew data keys (soldier names, position
// names, roles, sub-position/seat keys). The sheet and hand-edited DB rows mix
// quote variants (״ " ׳ ' `) and stray spaces — every comparison must go
// through ONE normalizer so the three former hand-copies can't drift.

/** Strip quote marks (״ " ׳ ' `), collapse whitespace, trim. */
export function normalizeName(s: string | null | undefined): string {
  return (s ?? '').replace(/[״"׳'`]/g, '').replace(/\s+/g, ' ').trim();
}
