import { memo, useMemo, useState } from 'react';
import type { HamalDay, HamalRosterEntry, HamalWindow } from '../../api/hamal';
import { useHamal, type ShiftPayload } from '../hooks/useHamal';
import { DateRangePicker, todayIso, addDaysIso, heDate } from './DateRangePicker';
import { SoldierSelect } from './SoldierSelect';
import { normalizeTiling, moveBoundary, addShift, removeShift, type HamalTileShift } from '../lib/hamalTiling';

function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to && out.length < 14; d = addDaysIso(d, 1)) out.push(d);
  return out;
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// The חמל runs on its OWN 10:00→10:00 cycle (defaults 10:00-18:00 / 18:00-02:00
// / 02:00-10:00), NOT the 14:00 schedule-day anchor. A shift starting before
// 10:00 belongs to the next calendar day (the tail of the חמל day).
const HAMAL_DAY_START = '10:00';
const isNextDay = (start: string) => start < HAMAL_DAY_START && start !== HAMAL_DAY_START;

/** LTR-isolated clock range so times always read start→end inside the RTL card
 *  (otherwise "10:00–18:00" would visually flip to "18:00–10:00"). */
function TimeRange({ start, end }: { start: string; end: string }) {
  return <span dir="ltr" className="font-bold text-slate-700 tabular-nums">{start}–{end}</span>;
}

/** One shift = one table row. The shift's START is read-only — the first shift is
 *  fixed at 10:00 and every other start mirrors the previous shift's end. The END
 *  is the primary boundary control: editing it moves the shared boundary with the
 *  next shift (except the LAST shift, whose 10:00 end is fixed). A single-select
 *  combobox picks the one soldier. */
function ShiftRow({ shift, index, isLast, roster, onSelectSoldier, onChangeEnd, onRemove, disabled }: {
  shift: HamalTileShift;
  index: number;
  isLast: boolean;
  roster: HamalRosterEntry[];
  onSelectSoldier: (index: number, soldierId: number | null) => void;
  onChangeEnd: (index: number, end: string) => void;
  onRemove: (index: number) => void;
  disabled: boolean;
}) {
  const [editingEnd, setEditingEnd] = useState(false);
  const [endDraft, setEndDraft] = useState(shift.end);

  const saveEnd = () => {
    if (!TIME_RE.test(endDraft)) return;
    setEditingEnd(false);
    onChangeEnd(index, endDraft);
  };

  return (
    <tr className="border-t border-gray-100">
      <td className="py-2 pl-2 align-top whitespace-nowrap">
        <div className="flex items-center gap-1">
          <TimeRange start={shift.start} end={shift.end} />
          {isNextDay(shift.start) && <span className="text-xs font-normal text-gray-400">(למחרת)</span>}
          {editingEnd ? (
            <span className="flex items-center gap-1">
              <span className="text-xs text-gray-400">סיום:</span>
              <input type="time" value={endDraft} onChange={(e) => setEndDraft(e.target.value)}
                className="rounded border border-gray-300 px-1.5 py-0.5 text-sm" />
              <button onClick={saveEnd} disabled={disabled}
                className="rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-2 py-0.5 text-xs">שמור</button>
              <button onClick={() => { setEditingEnd(false); setEndDraft(shift.end); }}
                className="rounded bg-gray-200 hover:bg-gray-300 px-2 py-0.5 text-xs">ביטול</button>
            </span>
          ) : (
            !isLast && (
              <button onClick={() => { setEndDraft(shift.end); setEditingEnd(true); }}
                disabled={disabled} title="שנה שעת סיום (מזיז את הגבול עם המשמרת הבאה)"
                className="rounded px-1.5 py-0.5 text-sm text-gray-500 hover:bg-gray-200 disabled:opacity-50">✎</button>
            )
          )}
          <button onClick={() => onRemove(index)} disabled={disabled} title="הסר משמרת"
            className="rounded px-1.5 py-0.5 text-sm text-red-500 hover:bg-red-50 disabled:opacity-50">✕</button>
        </div>
      </td>
      <td className="py-2 align-top w-full">
        <SoldierSelect
          roster={roster}
          selectedId={shift.soldierId}
          onSelect={(id) => onSelectSoldier(index, id)}
          onClear={() => onSelectSoldier(index, null)}
          disabled={disabled}
        />
      </td>
    </tr>
  );
}

/** One day's per-shift חמל crew. The shifts always tile the 10:00→10:00 day
 *  exactly (contiguous, no gaps/overlaps); all edits run through the pure
 *  hamalTiling helper and are persisted as the full contiguous window list.
 *  Memoized so editing one day doesn't re-render every other day's lists. */
const DayCard = memo(function DayCard({ day, roster, dayData, defaults, onSave, saving, disabled }: {
  day: string;
  roster: HamalRosterEntry[];
  dayData: HamalDay;
  defaults: HamalWindow[];
  onSave: (day: string, shifts: ShiftPayload[]) => void;
  saving: boolean;
  disabled: boolean;
}) {
  const [addStart, setAddStart] = useState('10:00');
  const [addEnd, setAddEnd] = useState('18:00');

  // Derive the per-shift tiling from the server data (one soldier per shift) and
  // normalize it to a contiguous partition — so a legacy/non-contiguous stored
  // day is shown (and edited) as a clean tiling.
  const tiling = useMemo<HamalTileShift[]>(
    () => normalizeTiling(dayData.shifts.map((s) => ({ start: s.start, end: s.end, soldierId: s.picks[0]?.soldierId ?? null }))),
    [dayData.shifts],
  );
  const totalPicks = tiling.filter((s) => s.soldierId != null).length;

  // send a contiguous tiling to the server as the whole-day window list
  const commit = (tiles: HamalTileShift[]) =>
    onSave(day, tiles.map((t) => ({ start: t.start, end: t.end, soldierIds: t.soldierId == null ? [] : [t.soldierId] })));

  const selectSoldier = (index: number, soldierId: number | null) =>
    commit(tiling.map((s, i) => (i === index ? { ...s, soldierId } : s)));
  const changeEnd = (index: number, end: string) => commit(moveBoundary(tiling, index, end));
  const remove = (index: number) => {
    if (tiling.length <= 1) return; // never leave a day with no shifts
    if (tiling[index].soldierId != null && !window.confirm('להסיר משמרת עם חייל משובץ?')) return;
    commit(removeShift(tiling, index));
  };
  const add = () => {
    if (!TIME_RE.test(addStart) || !TIME_RE.test(addEnd)) return;
    commit(addShift(tiling, addStart, addEnd));
  };
  // revert to the 3 default windows, carrying over the soldier from any window
  // whose times still match a default (the extra shifts' picks drop away).
  const resetToDefaults = () => {
    const byKey = new Map(tiling.map((s) => [`${s.start}-${s.end}`, s.soldierId]));
    onSave(day, defaults.map((w) => {
      const sid = byKey.get(`${w.start}-${w.end}`) ?? null;
      return { start: w.start, end: w.end, soldierIds: sid == null ? [] : [sid] };
    }));
  };

  const addNextDay = addEnd <= addStart; // "עד" earlier than "מ" ⇒ the window ends next day

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
          {tiling.map((sh, i) => (
            <ShiftRow key={`${sh.start}-${sh.end}-${i}`} shift={sh} index={i} isLast={i === tiling.length - 1}
              roster={roster} onSelectSoldier={selectSoldier} onChangeEnd={changeEnd} onRemove={remove} disabled={disabled} />
          ))}
        </tbody>
      </table>

      <div className="flex items-center gap-2 flex-wrap border-t border-gray-100 pt-3" dir="rtl">
        <span className="text-sm text-gray-500">הוסף משמרת:</span>
        <span className="text-sm text-gray-500">מ</span>
        <input type="time" value={addStart} onChange={(e) => setAddStart(e.target.value)}
          className="rounded border border-gray-300 px-1.5 py-0.5 text-sm" />
        <span className="text-sm text-gray-500">עד</span>
        <input type="time" value={addEnd} onChange={(e) => setAddEnd(e.target.value)}
          className="rounded border border-gray-300 px-1.5 py-0.5 text-sm" />
        {addNextDay && <span className="text-xs text-gray-400">(למחרת)</span>}
        <button onClick={add} disabled={disabled}
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
        יום החמל מתחיל ב־10:00 ומכסה 24 שעות עד 10:00 למחרת, והמשמרות מְרַצְּפוֹת
        אותו ברצף מלא — ללא פערים או חפיפות (ברירת מחדל: 10:00–18:00, 18:00–02:00,
        02:00–10:00). שינוי שעת הסיום של משמרת מזיז את הגבול המשותף עם המשמרת
        הבאה (מקצר משמרת אחת ומאריך את שכנתה); הוספת משמרת מרצפת את היממה מחדש,
        והסרת משמרת ממזגת אותה אל שכנתה — כך היממה תמיד מכוסה במלואה. שעת ההתחלה
        של כל משמרת נגזרת מסיום קודמתה ואינה ניתנת לעריכה, וכך גם ה־10:00 של
        תחילת וסיום היממה. לכל משמרת בוחרים חייל אחד מתוך רשימה נפתחת עם חיפוש;
        הבחירה נשמרת מיד ומשתקפת בשבצ״ק, וחייל שנבחר לחמל שמור ליום שלם ולא ישובץ
        בעמדה אחרת.
      </div>

      <DateRangePicker from={from} to={to} setFrom={setFrom} setTo={setTo} multiDay={multiDay} setMultiDay={setMultiDay}>
        {loading && <span className="text-sm text-gray-400"><span className="animate-spin inline-block">↺</span></span>}
      </DateRangePicker>

      {error && <div className="rounded-xl bg-red-50 p-4 text-center text-red-700 text-sm">{error}</div>}

      {days.map((day) => (
        <DayCard key={day} day={day} roster={roster}
          dayData={dayByDate.get(day) ?? fallback(day)} defaults={defaults}
          onSave={save} saving={isSaving(day)} disabled={false} />
      ))}
    </div>
  );
}
