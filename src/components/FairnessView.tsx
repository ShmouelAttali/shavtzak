import { useMemo, useState } from 'react';
import type { FairnessRow, SpreadStat } from '../../api/fairness';
import { useFairness } from '../hooks/useFairness';

function todayIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The exact window soldier_fairness(date) checks: [date-7 14:00, date 14:00) */
function windowLabel(dateIso: string): string {
  const he = (iso: string) => {
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
  };
  const start = new Date(`${dateIso}T12:00:00`);
  start.setDate(start.getDate() - 7);
  const pad = (n: number) => String(n).padStart(2, '0');
  const startIso = `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`;
  return `${he(startIso)} 14:00 ← ${he(dateIso)} 14:00`;
}

type SortKey = keyof Pick<FairnessRow,
  'name' | 'platoon' | 'nightCount7d' | 'weightedHours7d' | 'missionHours7d'
  | 'readinessHours7d' | 'nightCountTotal' | 'trackerHoursTotal'>;

const COLUMNS: { key: SortKey; label: string; numeric?: boolean }[] = [
  { key: 'name', label: 'שם' },
  { key: 'platoon', label: 'מחלקה' },
  { key: 'nightCount7d', label: 'לילות 7 ימים', numeric: true },
  { key: 'weightedHours7d', label: 'שעות משוקללות 7י', numeric: true },
  { key: 'missionHours7d', label: 'שעות משימה 7י', numeric: true },
  { key: 'readinessHours7d', label: 'שעות כוננות 7י', numeric: true },
  { key: 'nightCountTotal', label: 'לילות סה"כ', numeric: true },
  { key: 'trackerHoursTotal', label: 'גשש סה"כ', numeric: true },
];

function SpreadCard({ title, s }: { title: string; s: SpreadStat }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-center">
      <div className="text-xs text-gray-500 mb-1">{title}</div>
      <div className="text-xl font-bold text-slate-800">{s.avg}<span className="text-xs font-normal text-gray-400"> ממוצע</span></div>
      <div className="mt-1 text-xs text-gray-500">
        טווח {s.min}–{s.max} · סטיית תקן {s.stddev}
      </div>
    </div>
  );
}

function topPositions(counts: Record<string, number>): string {
  return Object.entries(counts)
    .filter(([name]) => name !== 'מנוחה')
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name, n]) => `${name}×${n}`)
    .join(', ');
}

export function FairnessView() {
  const [date, setDate] = useState(todayIso());
  const { data, loading, error } = useFairness(date);
  const [sort, setSort] = useState<{ key: SortKey; asc: boolean }>({ key: 'weightedHours7d', asc: false });
  const [platoons, setPlatoons] = useState<Set<string>>(new Set());
  const [hideIdle, setHideIdle] = useState(true);

  const allPlatoons = useMemo(
    () => [...new Set((data?.rows ?? []).map((r) => r.platoon))].sort((a, b) => a.localeCompare(b, 'he')),
    [data]);

  const rows = useMemo(() => {
    let out = data?.rows ?? [];
    if (platoons.size) out = out.filter((r) => platoons.has(r.platoon));
    if (hideIdle) out = out.filter((r) => r.weightedHours7d > 0 || r.nightCount7d > 0);
    const { key, asc } = sort;
    return [...out].sort((a, b) => {
      const av = a[key], bv = b[key];
      const cmp = typeof av === 'number' && typeof bv === 'number'
        ? av - bv
        : String(av).localeCompare(String(bv), 'he');
      return asc ? cmp : -cmp;
    });
  }, [data, platoons, hideIdle, sort]);

  const w = data?.spread.weightedHours;
  const rowTone = (r: FairnessRow): string => {
    if (!w || !w.stddev) return '';
    if (r.weightedHours7d > w.avg + w.stddev) return 'bg-red-50';
    if (r.weightedHours7d < w.avg - w.stddev) return 'bg-green-50';
    return '';
  };

  const toggleSort = (key: SortKey) =>
    setSort((s) => ({ key, asc: s.key === key ? !s.asc : key === 'name' || key === 'platoon' }));

  return (
    <div className="space-y-4" dir="rtl">
      {/* Controls */}
      <div className="flex items-center gap-3 flex-wrap">
        <label className="flex items-center gap-2 text-sm text-gray-600">
          חלון של 7 ימים המסתיים ב:
          <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)}
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800 shadow-sm focus:border-blue-500 focus:outline-none" />
        </label>
        <span className="rounded-lg bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-700" dir="rtl">
          חלון נבדק: {windowLabel(date)}
        </span>
        {allPlatoons.map((p) => (
          <label key={p} className="flex items-center gap-1 text-sm text-gray-600 select-none">
            <input type="checkbox" checked={!platoons.size || platoons.has(p)}
              onChange={() => setPlatoons((prev) => {
                const next = new Set(prev.size ? prev : allPlatoons);
                next.has(p) ? next.delete(p) : next.add(p);
                return next.size === allPlatoons.length ? new Set() : next;
              })} />
            {p}
          </label>
        ))}
        <label className="flex items-center gap-1 text-sm text-gray-600 select-none">
          <input type="checkbox" checked={hideIdle} onChange={(e) => setHideIdle(e.target.checked)} />
          הסתר ללא עומס
        </label>
        {loading && <span className="animate-spin inline-block text-gray-400">↺</span>}
      </div>

      {error && <div className="rounded-xl bg-red-50 p-4 text-center text-red-700 text-sm">{error}</div>}

      {/* Spread cards */}
      {data && (
        <div className="grid grid-cols-2 gap-3 max-w-xl">
          <SpreadCard title="שעות משוקללות (7 ימים)" s={data.spread.weightedHours} />
          <SpreadCard title="לילות (7 ימים)" s={data.spread.nights} />
        </div>
      )}

      {/* Table */}
      {data && (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full border-collapse text-sm" dir="rtl">
            <thead>
              <tr>
                {COLUMNS.map((c) => (
                  <th key={c.key} onClick={() => toggleSort(c.key)}
                    className="cursor-pointer select-none whitespace-nowrap border-b-2 border-gray-200 bg-gray-50 px-3 py-2 text-right font-semibold text-gray-600 hover:bg-gray-100">
                    {c.label}{sort.key === c.key ? (sort.asc ? ' ▲' : ' ▼') : ''}
                  </th>
                ))}
                <th className="border-b-2 border-gray-200 bg-gray-50 px-3 py-2 text-right font-semibold text-gray-600">עמדות נפוצות</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.soldierId} className={`${rowTone(r) || (i % 2 ? 'bg-gray-50/50' : 'bg-white')} border-b border-gray-100`}>
                  <td className="px-3 py-1.5 font-medium whitespace-nowrap">{r.name}</td>
                  <td className="px-3 py-1.5 whitespace-nowrap">{r.platoon}</td>
                  <td className="px-3 py-1.5 text-center">{r.nightCount7d}</td>
                  <td className="px-3 py-1.5 text-center font-semibold">{r.weightedHours7d}</td>
                  <td className="px-3 py-1.5 text-center">{r.missionHours7d}</td>
                  <td className="px-3 py-1.5 text-center">{r.readinessHours7d}</td>
                  <td className="px-3 py-1.5 text-center">{r.nightCountTotal}</td>
                  <td className="px-3 py-1.5 text-center">{r.trackerHoursTotal}</td>
                  <td className="px-3 py-1.5 text-xs text-gray-500">{topPositions(r.positionCounts)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-3 py-2 text-xs text-gray-400">
            {rows.length} חיילים · אדום = מעל ממוצע+סטיית תקן · ירוק = מתחת (זכאי להשלמה)
          </div>
        </div>
      )}
    </div>
  );
}
