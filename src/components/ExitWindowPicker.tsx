import { FROM_TIMES, TO_TIMES } from '../constants/exitRequests';
import { todayIso, heDate } from './DateRangePicker';

// date helpers live in DateRangePicker — re-exported for the exit tabs
export { todayIso, heDate };

// ── Literal datetime math (naive local, minutes since epoch) ────────────────
// An exit window is a literal From date+time → To date+time; the schedule day
// is only relevant to the ≥8h-per-cycle rule (cycles start at 14:00).
const DAY = 24 * 60;
const toMinutes = (date: string, time: string): number => {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  return (Date.UTC(y, m - 1, d) / 86400000) * DAY + hh * 60 + mm;
};
/** Start (14:00) of the schedule day containing minute `m` (mirrors the API). */
const scheduleDayStart = (m: number): number => {
  const anchor = 14 * 60;
  return m - ((((m - anchor) % DAY) + DAY) % DAY);
};
/** True when the window leaves under 8h available in some 14:00→14:00 cycle. */
function leavesUnderEightHours(s: number, e: number): boolean {
  for (let ds = scheduleDayStart(s); ds < e; ds += DAY) {
    if (Math.min(e, ds + DAY) - Math.max(s, ds) > 16 * 60) return true;
  }
  return false;
}

export interface WindowInfo {
  hoursOut: number;
  /** the return is not strictly after the leave */
  invalid: boolean;
  /** leaves under 8h available in some cycle — must be a vacation day instead */
  tooLong: boolean;
}
export function windowInfo(fromDate: string, from: string, toDate: string, to: string): WindowInfo {
  const s = toMinutes(fromDate, from);
  const e = toMinutes(toDate, to);
  const invalid = e <= s;
  return {
    hoursOut: invalid ? 0 : (e - s) / 60,
    invalid,
    tooLong: !invalid && leavesUnderEightHours(s, e),
  };
}

/** Literal 'YYYY-MM-DD HH:MM' start/end of the window. */
export function windowTimestamps(fromDate: string, from: string, toDate: string, to: string): { start: string; end: string } {
  return { start: `${fromDate} ${from}`, end: `${toDate} ${to}` };
}

const selectCls = 'rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800 shadow-sm focus:border-blue-500 focus:outline-none';

/** From/To date + shift-boundary time pickers — the ONE exit-window selector,
 *  shared by the soldier and admin tabs. Cross-date requests are expressed via
 *  distinct From/To dates. */
export function ExitWindowPicker({ fromDate, from, toDate, to, onFromDate, onFrom, onToDate, onTo }: {
  fromDate: string; from: string; toDate: string; to: string;
  onFromDate: (d: string) => void; onFrom: (f: string) => void;
  onToDate: (d: string) => void; onTo: (t: string) => void;
}) {
  // Changing the From date keeps the To date in sync ONLY while they were equal
  // (don't clobber a To the user set later); always clamp a To that fell behind.
  const changeFromDate = (v: string) => {
    if (!v) return;
    const wasEqual = toDate === fromDate;
    onFromDate(v);
    if (wasEqual || toDate < v) onToDate(v);
  };
  return (
    <>
      <div className="space-y-1">
        <label className="block text-sm font-medium text-gray-600">תאריך יציאה</label>
        <input
          type="date"
          value={fromDate}
          onChange={(e) => changeFromDate(e.target.value)}
          className={selectCls}
        />
      </div>
      <div className="space-y-1">
        <label className="block text-sm font-medium text-gray-600">יציאה מ־</label>
        <select
          value={from}
          onChange={(e) => onFrom(e.target.value)}
          className={selectCls}
        >
          {FROM_TIMES.map((t: string) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <label className="block text-sm font-medium text-gray-600">תאריך חזרה</label>
        <input
          type="date"
          value={toDate}
          min={fromDate}
          onChange={(e) => e.target.value && onToDate(e.target.value < fromDate ? fromDate : e.target.value)}
          className={selectCls}
        />
      </div>
      <div className="space-y-1">
        <label className="block text-sm font-medium text-gray-600">חזרה עד</label>
        <select
          value={to}
          onChange={(e) => onTo(e.target.value)}
          className={selectCls}
        >
          {TO_TIMES.map((t: string) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </div>
    </>
  );
}

/** The hours summary + validation banners under the picker. */
export function ExitWindowSummary({ fromDate, from, toDate, to }: {
  fromDate: string; from: string; toDate: string; to: string;
}) {
  const { hoursOut, invalid, tooLong } = windowInfo(fromDate, from, toDate, to);
  return (
    <>
      {invalid ? (
        <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          זמן החזרה חייב להיות אחרי זמן היציאה
        </div>
      ) : (
        <div className="text-sm text-gray-700">
          סה"כ {hoursOut} שעות מחוץ לבסיס
        </div>
      )}
      {tooLong && (
        <div className="rounded-lg bg-yellow-50 px-3 py-2 text-sm text-yellow-700">
          היציאה משאירה פחות מ-8 שעות זמינות ביממת שיבוץ — יש להגיש יום חופש
        </div>
      )}
    </>
  );
}
