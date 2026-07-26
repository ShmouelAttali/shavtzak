import { useEffect, useState, type MutableRefObject } from 'react';
import type { TabLeaveGuard } from '../types';
import { useDayStructure, type DraftGroup, type DraftPosition, type DraftShift } from '../hooks/useDayStructure';
import { heDate } from './DateRangePicker';

// ── מבנה יומי tab: per-day shift-structure editor (admin-only) ────────────────
// Edits ONE schedule day's shift structure — add/remove/rename a position group
// (= positions row) and its positions (= sub_positions), change shift times/seats
// — with NO cross-shift validation (unlike חמל tiling) and NO soldier lists. NO
// autosave: an explicit Save (top + bottom, enabled only when dirty) PUTs the
// whole day; "אפס ליום רגיל" resets it. Leaving the tab / reloading / changing the
// date while dirty prompts save/discard/cancel.

/** Current schedule day (14:00→14:00): before 14:00 it's still yesterday's. */
function currentScheduleDay(): string {
  const d = new Date();
  if (d.getHours() < 14) d.setDate(d.getDate() - 1);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** LTR-isolated clock range so times read start→end inside the RTL card. */
function TimeRange({ start, end }: { start: string; end: string }) {
  return <span dir="ltr" className="font-bold text-slate-700 tabular-nums">{start}–{end}</span>;
}

function OriginPill({ origin }: { origin: DraftShift['origin'] }) {
  if (origin === 'resized') return <span className="rounded-full bg-amber-100 text-amber-700 px-2 py-0.5 text-[11px] font-semibold">מותאם</span>;
  if (origin === 'added' || origin === 'new') return <span className="rounded-full bg-blue-100 text-blue-700 px-2 py-0.5 text-[11px] font-semibold">נוסף</span>;
  return null;
}

const timeCls = 'rounded border border-gray-300 px-1.5 py-0.5 text-sm';

function ShiftRow({ shift, onChange, onRemove }: {
  shift: DraftShift;
  onChange: (patch: Partial<Pick<DraftShift, 'start' | 'end' | 'seats'>>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-center gap-2 flex-wrap border-t border-gray-100 pt-2" dir="rtl">
      <TimeRange start={shift.start} end={shift.end} />
      <span dir="ltr" className="flex items-center gap-1">
        <input type="time" value={shift.start} onChange={(e) => onChange({ start: e.target.value })} className={timeCls} />
        <span className="text-gray-400">–</span>
        <input type="time" value={shift.end} onChange={(e) => onChange({ end: e.target.value })} className={timeCls} />
      </span>
      <label className="flex items-center gap-1 text-sm text-gray-500">
        עמדות
        <input type="number" min={1} value={shift.seats}
          onChange={(e) => onChange({ seats: Math.max(1, Number(e.target.value) || 1) })}
          className="w-16 rounded border border-gray-300 px-1.5 py-0.5 text-sm" />
      </label>
      <OriginPill origin={shift.origin} />
      <button onClick={onRemove} title="הסר משמרת"
        className="rounded px-1.5 py-0.5 text-sm text-red-500 hover:bg-red-50">✕</button>
    </div>
  );
}

function PositionBlock({ pos, actions }: {
  pos: DraftPosition;
  actions: {
    rename: (name: string) => void; remove: () => void;
    addShift: () => void; removeShift: (suid: string) => void;
    updateShift: (suid: string, patch: Partial<Pick<DraftShift, 'start' | 'end' | 'seats'>>) => void;
  };
}) {
  return (
    <div className="rounded-lg bg-gray-50 border border-gray-100 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <input value={pos.name ?? ''} onChange={(e) => actions.rename(e.target.value)}
          placeholder="תפקיד (ריק = ללא)"
          className="rounded border border-gray-200 px-2 py-1 text-sm font-semibold text-slate-700 flex-1 min-w-0" />
        <button onClick={actions.remove} title="הסר תפקיד"
          className="rounded px-2 py-1 text-xs text-red-500 hover:bg-red-50">הסר תפקיד</button>
      </div>
      <div className="space-y-1">
        {pos.shifts.map((s) => (
          <ShiftRow key={s.uid} shift={s}
            onChange={(patch) => actions.updateShift(s.uid, patch)}
            onRemove={() => actions.removeShift(s.uid)} />
        ))}
      </div>
      <button onClick={actions.addShift}
        className="rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 px-2.5 py-1 text-xs font-medium">+ משמרת</button>
    </div>
  );
}

function GroupCard({ group, ds }: { group: DraftGroup; ds: ReturnType<typeof useDayStructure> }) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
      <div className="flex items-center gap-2">
        <input value={group.name} onChange={(e) => ds.renameGroup(group.uid, e.target.value)}
          placeholder="שם קבוצה"
          className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-base font-bold text-slate-800 flex-1 min-w-0" />
        <button onClick={() => ds.removeGroup(group.uid)} title="הסר קבוצה"
          className="rounded-lg px-2.5 py-1.5 text-xs text-red-500 hover:bg-red-50 font-medium">הסר קבוצה</button>
      </div>
      <div className="space-y-2">
        {group.positions.map((p) => (
          <PositionBlock key={p.uid} pos={p} actions={{
            rename: (name) => ds.renamePosition(group.uid, p.uid, name),
            remove: () => ds.removePosition(group.uid, p.uid),
            addShift: () => ds.addShift(group.uid, p.uid),
            removeShift: (suid) => ds.removeShift(group.uid, p.uid, suid),
            updateShift: (suid, patch) => ds.updateShift(group.uid, p.uid, suid, patch),
          }} />
        ))}
      </div>
      <button onClick={() => ds.addPosition(group.uid)}
        className="rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1 text-sm font-medium">+ תפקיד</button>
    </section>
  );
}

/** save / discard / cancel popup (AboutPopup overlay idiom). */
function ConfirmLeavePopup({ onSave, onDiscard, onCancel, saving }: {
  onSave: () => void; onDiscard: () => void; onCancel: () => void; saving: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={onCancel}>
      <div className="bg-white rounded-2xl shadow-2xl p-6 space-y-4 max-w-xs w-full" onClick={(e) => e.stopPropagation()} dir="rtl">
        <div className="text-lg font-bold text-slate-800">יש שינויים שלא נשמרו</div>
        <div className="text-sm text-gray-500">לשמור את השינויים לפני המעבר?</div>
        <div className="flex flex-col gap-2">
          <button onClick={onSave} disabled={saving}
            className="w-full rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white py-2 text-sm font-semibold">שמור ועבור</button>
          <button onClick={onDiscard} disabled={saving}
            className="w-full rounded-xl border border-gray-200 py-2 text-sm text-gray-600 hover:bg-gray-50">התעלם מהשינויים</button>
          <button onClick={onCancel} disabled={saving}
            className="w-full rounded-xl py-2 text-sm text-gray-400 hover:bg-gray-50">ביטול</button>
        </div>
      </div>
    </div>
  );
}

const saveBtnCls = 'rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:hover:bg-blue-600 text-white px-4 py-1.5 text-sm font-semibold';

export function DayStructure({ guardRef }: { guardRef: MutableRefObject<TabLeaveGuard | null> }) {
  const [day, setDay] = useState(currentScheduleDay());
  const [pendingDay, setPendingDay] = useState<string | null>(null);   // date change awaiting confirm
  const ds = useDayStructure(day);
  const { isDirty, save } = ds;

  // register the leave guard for App's tab-switch interception
  useEffect(() => {
    guardRef.current = { isDirty: () => isDirty, save };
    return () => { guardRef.current = null; };
  }, [guardRef, isDirty, save]);

  // native beforeunload prompt while dirty (page reload / close)
  useEffect(() => {
    if (!isDirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [isDirty]);

  const requestDay = (next: string) => {
    if (!next || next === day) return;
    if (isDirty) setPendingDay(next); else setDay(next);
  };
  const confirmSaveDay = async () => { const ok = await save(); if (ok && pendingDay) setDay(pendingDay); setPendingDay(null); };
  const confirmDiscardDay = () => { if (pendingDay) setDay(pendingDay); setPendingDay(null); };

  const onReset = async () => {
    if (!window.confirm('לאפס את מבנה היום למבנה הרגיל? כל השינויים ליום זה יימחקו.')) return;
    await ds.reset();
  };

  const SaveBar = () => (
    <div className="flex items-center gap-2 flex-wrap">
      <button onClick={() => void save()} disabled={!isDirty || ds.saving} className={saveBtnCls}>
        {ds.saving ? 'שומר…' : 'שמור'}
      </button>
      <button onClick={onReset} disabled={ds.saving}
        className="rounded-lg bg-gray-100 hover:bg-gray-200 disabled:opacity-40 text-gray-700 px-4 py-1.5 text-sm font-medium">
        אפס ליום רגיל
      </button>
      {isDirty && <span className="text-xs text-amber-600 font-medium">יש שינויים שלא נשמרו</span>}
    </div>
  );

  return (
    <div className="space-y-5">
      <div className="rounded-xl bg-blue-50 border border-blue-100 px-4 py-3 text-sm text-blue-800" dir="rtl">
        עריכת מבנה המשמרות ליום בודד — הוספה/הסרה/שינוי שם של קבוצה או תפקיד, ושינוי
        שעות ומספר עמדות של משמרת. השינויים חלים על היום הנבחר בלבד ואינם משפיעים על
        שאר הימים. אין בדיקת רצף/חפיפה — המחולל והבודק יסמנו בעיות כיסוי בזמן החילול.
        השמירה אינה אוטומטית: יש ללחוץ "שמור".
      </div>

      <div className="flex items-center gap-3 flex-wrap" dir="rtl">
        <label className="text-sm text-gray-600 font-medium">יום</label>
        <input type="date" value={day} onChange={(e) => requestDay(e.target.value)}
          className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800 shadow-sm focus:border-blue-500 focus:outline-none" />
        <span className="text-sm text-gray-400">{heDate(day)}</span>
        {ds.loading && <span className="text-sm text-gray-400"><span className="animate-spin inline-block">↺</span></span>}
      </div>

      <SaveBar />

      {ds.error && <div className="rounded-xl bg-red-50 p-4 text-center text-red-700 text-sm">{ds.error}</div>}

      {ds.draft.map((g) => <GroupCard key={g.uid} group={g} ds={ds} />)}

      <button onClick={ds.addGroup}
        className="rounded-xl border-2 border-dashed border-gray-300 hover:border-blue-400 hover:text-blue-600 text-gray-500 w-full py-3 text-sm font-medium">
        + קבוצה חדשה
      </button>

      <SaveBar />

      {pendingDay && (
        <ConfirmLeavePopup saving={ds.saving}
          onSave={confirmSaveDay} onDiscard={confirmDiscardDay} onCancel={() => setPendingDay(null)} />
      )}
    </div>
  );
}
