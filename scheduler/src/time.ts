// Naive local-time model (matches the DB's `timestamp without time zone`).
// All timestamps are minutes since an arbitrary epoch, derived from ISO strings.

export type Minutes = number;

export const DAY = 24 * 60;

/** 'YYYY-MM-DD' + 'HH:MM' -> minutes since epoch (naive local). */
export function toMin(date: string, time = '00:00'): Minutes {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  // Days since 1970-01-01 via Date.UTC (no TZ effects on the math).
  const days = Date.UTC(y, m - 1, d) / 86400000;
  return days * DAY + hh * 60 + mm;
}

export function minToIso(min: Minutes): string {
  const days = Math.floor(min / DAY);
  const rest = min - days * DAY;
  const dt = new Date(days * 86400000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}` +
    ` ${pad(Math.floor(rest / 60))}:${pad(rest % 60)}:00`;
}

export function minToDate(min: Minutes): string {
  return minToIso(min).slice(0, 10);
}

/** Parse Postgres tsrange text: ["2026-07-15 22:00:00","2026-07-16 06:00:00") */
export function parseRange(r: string): [Minutes, Minutes] {
  const m = r.match(/[\[(]"?([\d-]+)[ T]([\d:]+)"?,"?([\d-]+)[ T]([\d:]+)"?[)\]]/);
  if (!m) throw new Error(`bad tsrange: ${r}`);
  return [toMin(m[1], m[2].slice(0, 5)), toMin(m[3], m[4].slice(0, 5))];
}

export function addDays(date: string, n: number): string {
  return minToDate(toMin(date) + n * DAY);
}

/** Schedule day D = [D 14:00, D+1 14:00) */
export function dayStart(day: string): Minutes { return toMin(day, '14:00'); }

/** Weekday of a calendar date (0 = Sunday). */
export function weekdayOf(day: string): number {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Sunday starts the schedule week: continuity and the fairness counters
 *  reset (owner decision 2026-07-19 — fairness is judged per week only). */
export const isSunday = (day: string): boolean => weekdayOf(day) === 0;

/** The Sunday opening the schedule week containing `day` (the day itself
 *  when it is a Sunday — i.e. a Sunday's fairness window is empty). */
export function weekStart(day: string): string {
  return addDays(day, -weekdayOf(day));
}

/** Start (14:00) of the schedule day containing minute `m` —
 *  mirrors schedule_day_of() in db/schema.sql. */
export function scheduleDayStart(m: Minutes): Minutes {
  const anchor = 14 * 60;
  return m - ((((m - anchor) % DAY) + DAY) % DAY);
}
export function dayEnd(day: string): Minutes { return dayStart(day) + DAY; }

/** Night of schedule day D = [D+1 00:00, D+1 06:00) */
export function nightRange(day: string): [Minutes, Minutes] {
  return [toMin(day) + DAY, toMin(day) + DAY + 6 * 60];
}

/** Night window of the schedule day containing minute `m`
 *  (14:00 anchor + 10h = 00:00, + 16h = 06:00 of the following morning). */
export function nightRangeAt(m: Minutes): [Minutes, Minutes] {
  const sds = scheduleDayStart(m);
  return [sds + 10 * 60, sds + 16 * 60];
}

/** Calendar timestamp of a template time inside schedule day D:
 *  times >= 14:00 fall on D itself, earlier times on the next morning. */
export function slotStart(day: string, time: string): Minutes {
  const [hh] = time.split(':').map(Number);
  return toMin(day, time.slice(0, 5)) + (hh < 14 ? DAY : 0);
}

export function overlaps(a: [Minutes, Minutes], b: [Minutes, Minutes]): boolean {
  return a[0] < b[1] && b[0] < a[1];
}

export function hours(a: [Minutes, Minutes]): number {
  return (a[1] - a[0]) / 60;
}

export function fmtHM(min: Minutes): string {
  const rest = ((min % DAY) + DAY) % DAY;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(rest / 60))}:${pad(rest % 60)}`;
}
