import { FROM_TIMES, TO_TIMES } from '../constants/exitRequests';
import { addDaysIso, todayIso, heDate } from './DateRangePicker';

// date helpers live in DateRangePicker — re-exported for the exit tabs
export { todayIso, heDate };

// Offsets in hours from the 14:00 schedule-day start.
const START_OFFSET: Record<string, number> = {
  '14:00': 0, '18:00': 4, '22:00': 8, '02:00': 12, '06:00': 16,
};
export const fromOffset = (t: string) => START_OFFSET[t] ?? 0;
// As a return time, 14:00 means the end of the schedule day (next day 14:00).
export const toOffset = (t: string) => (t === '14:00' ? 24 : START_OFFSET[t] ?? 0);
// Offsets ≥ 12 fall past midnight — on the next calendar day.
export const timeLabel = (t: string, offset: number) => (offset >= 12 ? `${t} (למחרת)` : t);

export interface WindowInfo {
  validTos: string[];
  effectiveTo: string;
  hoursOut: number;
  hoursLeft: number;
  tooLong: boolean;
}
export function windowInfo(from: string, to: string): WindowInfo {
  const validTos: string[] = TO_TIMES.filter((t: string) => toOffset(t) > fromOffset(from));
  const effectiveTo = validTos.includes(to) ? to : validTos[0];
  const hoursOut = toOffset(effectiveTo) - fromOffset(from);
  return { validTos, effectiveTo, hoursOut, hoursLeft: 24 - hoursOut, tooLong: hoursOut > 16 };
}

/** 'YYYY-MM-DD HH:MM' start/end of the window (offsets past midnight land on
 *  the next calendar day — mirrors the API's boundary→timestamp mapping). */
export function windowTimestamps(day: string, from: string, to: string): { start: string; end: string } {
  const at = (t: string, offset: number) =>
    `${offset >= 12 ? addDaysIso(day, 1) : day} ${t}`;
  return { start: at(from, fromOffset(from)), end: at(to, toOffset(to)) };
}

const selectCls = 'rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800 shadow-sm focus:border-blue-500 focus:outline-none';

/** Schedule-day + shift-boundary from/to pickers with the hours summary —
 *  the ONE exit-window selector, shared by the soldier and admin tabs. */
export function ExitWindowPicker({ day, from, to, onDay, onFrom, onTo }: {
  day: string; from: string; to: string;
  onDay: (d: string) => void; onFrom: (f: string, correctedTo: string) => void; onTo: (t: string) => void;
}) {
  const info = windowInfo(from, to);
  return (
    <>
      <div className="space-y-1">
        <label className="block text-sm font-medium text-gray-600">יממת שיבוץ</label>
        <input
          type="date"
          value={day}
          onChange={(e) => e.target.value && onDay(e.target.value)}
          className={selectCls}
        />
      </div>
      <div className="space-y-1">
        <label className="block text-sm font-medium text-gray-600">יציאה מ־</label>
        <select
          value={from}
          onChange={(e) => {
            const v = e.target.value;
            const stillValid = windowInfo(v, to);
            onFrom(v, stillValid.effectiveTo);
          }}
          className={selectCls}
        >
          {FROM_TIMES.map((t: string) => (
            <option key={t} value={t}>{timeLabel(t, fromOffset(t))}</option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <label className="block text-sm font-medium text-gray-600">חזרה עד</label>
        <select
          value={info.effectiveTo}
          onChange={(e) => onTo(e.target.value)}
          className={selectCls}
        >
          {info.validTos.map((t: string) => (
            <option key={t} value={t}>{timeLabel(t, toOffset(t))}</option>
          ))}
        </select>
      </div>
    </>
  );
}

/** The helper line + hours summary + too-long banner under the picker. */
export function ExitWindowSummary({ from, to }: { from: string; to: string }) {
  const { hoursOut, hoursLeft, tooLong } = windowInfo(from, to);
  return (
    <>
      <div className="text-xs text-gray-400">יממת שיבוץ מתחילה ב-14:00 ומסתיימת ב-14:00 למחרת</div>
      <div className="text-sm text-gray-700">
        סה"כ {hoursOut} שעות מחוץ לבסיס, נשארות {hoursLeft} שעות זמינות ביממה
      </div>
      {tooLong && (
        <div className="rounded-lg bg-yellow-50 px-3 py-2 text-sm text-yellow-700">
          יציאה ארוכה מ-16 שעות — יש להגיש יום חופש
        </div>
      )}
    </>
  );
}
