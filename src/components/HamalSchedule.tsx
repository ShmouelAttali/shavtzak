import { memo, useMemo, useState } from 'react';
import type { HamalDay, HamalRosterEntry, HamalShift, HamalWindow } from '../../api/hamal';
import { useHamal, type ShiftPayload } from '../hooks/useHamal';
import { DateRangePicker, todayIso, addDaysIso, heDate } from './DateRangePicker';
import { SoldierSelect } from './SoldierSelect';

function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to && out.length < 14; d = addDaysIso(d, 1)) out.push(d);
  return out;
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Shift windows starting before 14:00 belong to the next calendar day. */
const isNextDay = (start: string) => start < '14:00';

/** One shift = one table row: hours (+ edit/remove) and a single-select combobox.
 *  Legacy shifts with >1 picks show the first pick as selected; changing it
 *  rewrites the whole shift to that single soldier. */
function ShiftRow({ shift, index, roster, onSelect, onEditTimes, onRemove, disabled }: {
  shift: HamalShift;
  index: number;
  roster: HamalRosterEntry[];
  onSelect: (index: number, soldierId: number | null) => void;
  onEditTimes: (index: number, start: string, end: string) => void;
  onRemove: (index: number) => void;
  disabled: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [start, setStart] = useState(shift.start);
  const [end, setEnd] = useState(shift.end);

  const selectedId = shift.picks[0]?.soldierId ?? null;

  const saveTimes = () => {
    if (!TIME_RE.test(start) || !TIME_RE.test(end)) return;
    setEditing(false);
    onEditTimes(index, start, end);
  };

  return (
    <tr className="border-t border-gray-100">
      <td className="py-2 pl-2 align-top whitespace-nowrap">
        {editing ? (
          <div className="flex items-center gap-1">
            <input type="time" value={start} onChange={(e) => setStart(e.target.value)}
              className="rounded border border-gray-300 px-1.5 py-0.5 text-sm" />
            <span className="text-gray-400">–</span>
            <input type="time" value={end} onChange={(e) => setEnd(e.target.value)}
              className="rounded border border-gray-300 px-1.5 py-0.5 text-sm" />
            <button onClick={saveTimes} disabled={disabled}
              className="rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-2 py-0.5 text-xs">שמור</button>
            <button onClick={() => { setEditing(false); setStart(shift.start); setEnd(shift.end); }}
              className="rounded bg-gray-200 hover:bg-gray-300 px-2 py-0.5 text-xs">ביטול</button>
          </div>
        ) : (
          <div className="flex items-center gap-1">
            <span className="font-bold text-slate-700">{shift.start}–{shift.end}</span>
            {isNextDay(shift.start) && <span className="text-xs font-normal text-gray-400">(למחרת)</span>}
            <button onClick={() => { setStart(shift.start); setEnd(shift.end); setEditing(true); }}
              disabled={disabled} title="ערוך שעות"
              className="rounded px-1.5 py-0.5 text-sm text-gray-500 hover:bg-gray-200 disabled:opacity-50">✎</button>
            <button onClick={() => onRemove(index)} disabled={disabled} title="הסר משמרת"
              className="rounded px-1.5 py-0.5 text-sm text-red-500 hover:bg-red-50 disabled:opacity-50">✕</button>
          </div>
        )}
      </td>
      <td className="py-2 align-top w-full">
        <SoldierSelect
          roster={roster}
          selectedId={selectedId}
          onSelect={(id) => onSelect(index, id)}
          onClear={() => onSelect(index, null)}
          disabled={disabled}
        />
      </td>
    </tr>
  );
}

/** One day's per-shift חמל crew. Memoized so editing one day doesn't
 *  re-render every other day's combobox lists. */
const DayCard = memo(function DayCard({ day, roster, dayData, defaults, onSave, saving, disabled }: {
  day: string;
  roster: HamalRosterEntry[];
  dayData: HamalDay;
  defaults: HamalWindow[];
  onSave: (day: string, shifts: ShiftPayload[]) => void;
  saving: boolean;
  disabled: boolean;
}) {
  const [addStart, setAddStart] = useState('14:00');
  const [addEnd, setAddEnd] = useState('22:00');
  const shifts = dayData.shifts;
  const totalPicks = shifts.reduce((n, s) => n + (s.picks.length ? 1 : 0), 0);

  // build the whole-day payload from current server data (one soldier per shift)
  const payload = (): ShiftPayload[] =>
    shifts.map((s) => ({ start: s.start, end: s.end, soldierIds: s.picks.map((p) => p.soldierId) }));

  const selectSoldier = (index: number, soldierId: number | null) => {
    const p = payload();
    p[index] = { ...p[index], soldierIds: soldierId == null ? [] : [soldierId] };
    onSave(day, p);
  };
  const editTimes = (index: number, start: string, end: string) => {
    const p = payload();
    p[index] = { ...p[index], start, end };
    onSave(day, p);
  };
  const removeShift = (index: number) => {
    if (shifts[index].picks.length && !window.confirm('להסיר משמרת עם חייל משובץ?')) return;
    const p = payload().filter((_, i) => i !== index);
    if (p.length === 0) return; // never leave a day with no shifts
    onSave(day, p);
  };
  const addShift = () => {
    if (!TIME_RE.test(addStart) || !TIME_RE.test(addEnd)) return;
    onSave(day, [...payload(), { start: addStart, end: addEnd, soldierIds: [] }]);
  };
  // revert to the 3 default windows, carrying over picks from any window whose
  // times still match a default (the common "added one extra shift" case keeps
  // its default-shift crews; the extra shift's picks drop away).
  const resetToDefaults = () => {
    const byKey = new Map(shifts.map((s) => [`${s.start}-${s.end}`, s.picks.map((p) => p.soldierId)]));
    onSave(day, defaults.map((w) => ({ start: w.start, end: w.end, soldierIds: byKey.get(`${w.start}-${w.end}`) ?? [] })));
  };

  return (
    <section className={`rounded-xl border border-gray-200 bg-white p-4 space-y-3 transition-opacity ${saving ? 'opacity-60' : ''}`}>
      <div className="flex items-center gap-2 flex-wrap">
        <h2 className="text-lg font-bold text-slate-800">{heDate(day)}</h2>
        <span className="rounded-full bg-blue-100 text-blue-700 px-2.5 py-0.5 text-xs font-semibold">
          {totalPicks} בחמל
        </span>
        {dayData.custom && (
          <span className="rounded-full bg-amber-100 text-amber-700 px-2.5 py-0.5 text-xs font-semibold">
            מותאם אישית
          </span>
        )}
        {saving && <span className="text-xs text-gray-400"><span className="animate-spin inline-block">↺</span> שומר...</span>}
      </div>

      <table className="w-full text-sm" dir="rtl">
        <thead>
          <tr className="text-xs text-gray-400 text-right">
            <th className="font-medium pl-2 pb-1">משמרת</th>
            <th className="font-medium pb-1">חייל</th>
          </tr>
        </thead>
        <tbody>
          {shifts.map((sh, i) => (
            <ShiftRow key={`${sh.start}-${sh.end}-${i}`} shift={sh} index={i} roster={roster}
              onSelect={selectSoldier} onEditTimes={editTimes} onRemove={removeShift} disabled={disabled} />
          ))}
        </tbody>
      </table>

      <div className="flex items-center gap-2 flex-wrap border-t border-gray-100 pt-3">
        <span className="text-sm text-gray-500">הוסף משמרת:</span>
        <input type="time" value={addStart} onChange={(e) => setAddStart(e.target.value)}
          className="rounded border border-gray-300 px-1.5 py-0.5 text-sm" />
        <span className="text-gray-400">–</span>
        <input type="time" value={addEnd} onChange={(e) => setAddEnd(e.target.value)}
          className="rounded border border-gray-300 px-1.5 py-0.5 text-sm" />
        <button onClick={addShift} disabled={disabled}
          className="rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-3 py-1 text-sm font-medium">
          הוסף
        </button>
        {dayData.custom && (
          <button onClick={resetToDefaults} disabled={disabled}
            className="rounded-lg bg-gray-100 hover:bg-gray-200 disabled:opacity-50 text-gray-700 px-3 py-1 text-sm font-medium mr-auto">
            אחזור לברירת מחדל
          </button>
        )}
      </div>
    </section>
  );
});

export function HamalSchedule() {
  const [from, setFrom] = useState(todayIso());
  const [multiDay, setMultiDay] = useState(false);
  const [to, setTo] = useState(todayIso());
  const effectiveTo = multiDay && to >= from ? to : from;
  const { data, loading, error, isSaving, save } = useHamal(from, effectiveTo);

  const roster = data?.roster ?? [];
  const defaults = data?.defaults ?? [];
  const dayByDate = useMemo(() => {
    const m = new Map<string, HamalDay>();
    for (const d of data?.days ?? []) m.set(d.day, d);
    return m;
  }, [data]);

  const days = daysBetween(from, effectiveTo);
  const fallback = (day: string): HamalDay => ({
    day, custom: false, shifts: defaults.map((w) => ({ start: w.start, end: w.end, picks: [] })),
  });

  return (
    <div className="space-y-5">
      <div className="rounded-xl bg-blue-50 border border-blue-100 px-4 py-3 text-sm text-blue-800" dir="rtl">
        שיבוץ החמל ידני לחלוטין ולפי משמרות — המחולל אינו משבץ אותו אוטומטית.
        כל יום מחולק לשלוש משמרות ברירת מחדל (14:00–22:00, 22:00–06:00,
        06:00–14:00) והמשמרות מתחילות ריקות; ניתן להוסיף, לערוך שעות או להסיר
        משמרות לכל יום בנפרד. לכל משמרת בוחרים חייל אחד מתוך רשימה נפתחת עם חיפוש.
        הבחירה נשמרת מיד ומשתקפת בשבצ״ק; חייל שנבחר לחמל שמור ליום שלם ולא ישובץ
        בעמדה אחרת. לכל משמרת ביום חייבת להיות שעת התחלה שונה.
      </div>

      <DateRangePicker from={from} to={to} setFrom={setFrom} setTo={setTo} multiDay={multiDay} setMultiDay={setMultiDay}>
        {loading && <span className="text-sm text-gray-400"><span className="animate-spin inline-block">↺</span></span>}
      </DateRangePicker>

      {error && <div className="rounded-xl bg-red-50 p-4 text-center text-red-700 text-sm">{error}</div>}

      {days.map((day) => (
        <DayCard key={day} day={day} roster={roster}
          dayData={dayByDate.get(day) ?? fallback(day)} defaults={defaults}
          onSave={save} saving={isSaving(day)} disabled={isSaving(day)} />
      ))}
    </div>
  );
}
