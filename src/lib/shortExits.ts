// Pure helpers for the יציאות לזמן קצר rows of סיכום פלוגתי.
//
// A short-exit row is three sheet cells — name, זמן יציאה, זמן חזרה — with no
// "returned" flag: the row exists while the soldier is out and is deleted when
// he is back. So "is he out right now?" is derived purely from the two
// timestamps against the current clock.

export interface ShortExitTimes {
  exitTime: string;
  returnTime: string;
}

/** Parses the sheet's "dd/mm/yy HH:mm" — not reliably parseable by `new Date()`. */
export function parseSheetDateTime(s: string): Date | null {
  const m = s.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s+(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const [, dd, mm, yy, hh, min] = m;
  const year = yy.length === 2 ? 2000 + parseInt(yy, 10) : parseInt(yy, 10);
  const d = new Date(year, parseInt(mm, 10) - 1, parseInt(dd, 10), parseInt(hh, 10), parseInt(min, 10));
  return isNaN(d.getTime()) ? null : d;
}

const DAY_MS = 86_400_000;
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** אתמול / היום / מחר for a date within a day of `now`; null for anything further out. */
export function relativeDayLabel(d: Date, now: Date): string | null {
  const days = Math.round((startOfDay(d) - startOfDay(now)) / DAY_MS);
  return days === 0 ? 'היום' : days === -1 ? 'אתמול' : days === 1 ? 'מחר' : null;
}

/** "22:00 • 18/08 (אתמול)" — the date is always shown, today included. */
export function fmtExitDateTime(sheetStr: string, now: Date): string {
  if (!sheetStr) return '—';
  const d = parseSheetDateTime(sheetStr);
  if (!d) return sheetStr;
  const p = (n: number) => String(n).padStart(2, '0');
  const rel = relativeDayLabel(d, now);
  return `${p(d.getHours())}:${p(d.getMinutes())} • ${p(d.getDate())}/${p(d.getMonth() + 1)}`
    + (rel ? ` (${rel})` : '');
}

/**
 * planned — יציאה is still in the future, the soldier is on base.
 * out     — he left and is not yet due back.
 * late    — his זמן חזרה passed and the row is still here, so nobody marked him back.
 *
 * An unparseable/empty זמן יציאה counts as already out: the row only exists
 * once someone opened an exit.
 */
export type ExitState = 'planned' | 'out' | 'late';

export function exitState(exit: ShortExitTimes, now: Date): ExitState {
  const left = parseSheetDateTime(exit.exitTime);
  if (left && left.getTime() > now.getTime()) return 'planned';
  const due = parseSheetDateTime(exit.returnTime);
  if (due && due.getTime() < now.getTime()) return 'late';
  return 'out';
}

/** Soldiers actually off base right now — overdue ones included, planned ones not. */
export function countCurrentlyOut(exits: ShortExitTimes[], now: Date): number {
  return exits.filter(e => exitState(e, now) !== 'planned').length;
}
