import type { ReactNode } from 'react';

// ── date helpers (YYYY-MM-DD, local) ────────────────────────────────────────
export function todayIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export function addDaysIso(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  const pad = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export function heDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

const btnCls = 'rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-700 hover:bg-gray-50 font-bold text-lg leading-none';
const inputCls = 'rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800 shadow-sm focus:border-blue-500 focus:outline-none';

/**
 * From/to date-range picker with per-field ‹ › steppers (extracted from the
 * draft tab — keep its behavior intact).
 *
 * - `setMultiDay` present → renders the "מספר ימים" checkbox; the `to` field
 *   is shown only while `multiDay` is true (the draft-tab behavior).
 * - `setMultiDay` omitted → no checkbox; pass `multiDay={true}` for an
 *   always-visible from/to range.
 */
export function DateRangePicker({ from, to, setFrom, setTo, multiDay, setMultiDay, children }: {
  from: string;
  to: string;
  setFrom: (v: string) => void;
  setTo: (v: string) => void;
  multiDay: boolean;
  setMultiDay?: (v: boolean) => void;
  children?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 flex-wrap" dir="ltr">
      <button onClick={() => { const v = addDaysIso(from, -1); setFrom(v); if (!multiDay) setTo(v); }}
        className={btnCls}>‹</button>
      <input type="date" value={from}
        onChange={(e) => {
          const v = e.target.value;
          if (!v) return;
          setFrom(v);
          if (!multiDay || to < v) setTo(v);
        }}
        className={inputCls} />
      <button onClick={() => { const v = addDaysIso(from, 1); setFrom(v); if (!multiDay || to < v) setTo(v); }}
        className={btnCls}>›</button>
      {multiDay && (
        <>
          <span className="text-sm text-gray-500" dir="rtl">עד</span>
          <button onClick={() => setTo(to > from ? addDaysIso(to, -1) : from)}
            className={btnCls}>‹</button>
          <input type="date" value={to} min={from}
            onChange={(e) => {
              const v = e.target.value;
              if (!v) return;
              setTo(v < from ? from : v);
            }}
            className={inputCls} />
          <button onClick={() => setTo(addDaysIso(to > from ? to : from, 1))}
            className={btnCls}>›</button>
        </>
      )}
      {setMultiDay && (
        <label className="flex items-center gap-1.5 text-sm text-gray-600 select-none" dir="rtl">
          <input type="checkbox" checked={multiDay} onChange={(e) => { setMultiDay(e.target.checked); setTo(e.target.checked ? (to > from ? to : addDaysIso(from, 1)) : from); }} />
          מספר ימים
        </label>
      )}
      {children}
    </div>
  );
}
