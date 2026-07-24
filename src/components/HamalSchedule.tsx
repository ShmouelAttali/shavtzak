import { useMemo, useState } from 'react';
import type { HamalRosterEntry } from '../../api/hamal';
import { useHamal } from '../hooks/useHamal';
import { DateRangePicker, todayIso, addDaysIso, heDate } from './DateRangePicker';

function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to && out.length < 14; d = addDaysIso(d, 1)) out.push(d);
  return out;
}

/** One day's חמל crew: pick from the whole roster, saved immediately. */
function DayCard({ day, roster, picks, onToggle, saving, disabled }: {
  day: string;
  roster: HamalRosterEntry[];
  picks: Set<number>;
  onToggle: (day: string, soldierId: number, on: boolean) => void;
  saving: boolean;
  disabled: boolean;
}) {
  const [q, setQ] = useState('');
  const selected = roster.filter((s) => picks.has(s.id));
  const filtered = useMemo(() => {
    const needle = q.trim();
    if (!needle) return roster;
    return roster.filter((s) => s.name.includes(needle) || s.role.includes(needle));
  }, [roster, q]);

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <h2 className="text-lg font-bold text-slate-800">
          {heDate(day)} <span className="text-sm font-normal text-gray-500">(14:00 → 14:00 למחרת)</span>
        </h2>
        <span className="rounded-full bg-blue-100 text-blue-700 px-2.5 py-0.5 text-xs font-semibold">
          {selected.length} בחמל
        </span>
        {saving && <span className="text-xs text-gray-400"><span className="animate-spin inline-block">↺</span> שומר...</span>}
      </div>

      {/* Current picks */}
      {selected.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((s) => (
            <button
              key={s.id}
              disabled={disabled}
              onClick={() => onToggle(day, s.id, false)}
              className="rounded-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-2.5 py-1 text-sm font-medium flex items-center gap-1"
              title="הסר מהחמל"
            >
              {s.name} <span className="text-blue-200">✕</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="text-sm text-gray-400">אין שיבוץ ידני — החמל יאויש אוטומטית לפי התפקיד</div>
      )}

      {/* Roster picker */}
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="חיפוש חייל..."
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
        dir="rtl"
      />
      <div className="max-h-64 overflow-y-auto rounded-lg border border-gray-100 divide-y divide-gray-50">
        {filtered.map((s) => {
          const on = picks.has(s.id);
          return (
            <label
              key={s.id}
              className={`flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer ${on ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
            >
              <input
                type="checkbox"
                checked={on}
                disabled={disabled}
                onChange={(e) => onToggle(day, s.id, e.target.checked)}
              />
              <span className="font-medium text-slate-700">{s.name}</span>
              {s.role && <span className="text-xs text-gray-400">{s.role}</span>}
              {s.platoon && <span className="text-xs text-gray-300">מחלקה {s.platoon}</span>}
              {!s.schedulable && <span className="text-xs text-orange-400">(לא זמין)</span>}
            </label>
          );
        })}
        {filtered.length === 0 && <div className="px-3 py-3 text-sm text-gray-400">לא נמצאו חיילים</div>}
      </div>
    </section>
  );
}

export function HamalSchedule() {
  const [from, setFrom] = useState(todayIso());
  const [multiDay, setMultiDay] = useState(false);
  const [to, setTo] = useState(todayIso());
  const effectiveTo = multiDay && to >= from ? to : from;
  const { data, loading, error, saving, save } = useHamal(from, effectiveTo);

  const roster = data?.roster ?? [];
  const picksByDay = useMemo(() => {
    const m = new Map<string, Set<number>>();
    for (const d of data?.days ?? []) m.set(d.day, new Set(d.picks.map((p) => p.soldierId)));
    return m;
  }, [data]);

  const days = daysBetween(from, effectiveTo);

  const handleToggle = (day: string, soldierId: number, on: boolean) => {
    const current = new Set(picksByDay.get(day) ?? []);
    if (on) current.add(soldierId); else current.delete(soldierId);
    void save(day, [...current]);
  };

  return (
    <div className="space-y-5">
      <div className="rounded-xl bg-blue-50 border border-blue-100 px-4 py-3 text-sm text-blue-800" dir="rtl">
        שיבוץ ידני לחמל. הבחירה נשמרת מיד ומחליפה את האיוש האוטומטי לאותו יום —
        ביום עם שיבוץ ידני, מחולל השבצ"ק לא יאייש את החמל לפי התפקיד.
      </div>

      <DateRangePicker from={from} to={to} setFrom={setFrom} setTo={setTo} multiDay={multiDay} setMultiDay={setMultiDay}>
        {loading && <span className="text-sm text-gray-400"><span className="animate-spin inline-block">↺</span></span>}
      </DateRangePicker>

      {error && <div className="rounded-xl bg-red-50 p-4 text-center text-red-700 text-sm">{error}</div>}

      {days.map((day) => (
        <DayCard
          key={day}
          day={day}
          roster={roster}
          picks={picksByDay.get(day) ?? new Set()}
          onToggle={handleToggle}
          saving={saving === day}
          disabled={saving !== null || loading}
        />
      ))}
    </div>
  );
}
