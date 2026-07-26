import { useEffect, useMemo, useState } from 'react';
import type { MutableRefObject } from 'react';
import type { TabLeaveGuard } from '../types';
import type { PresenceDayInput } from '../../api/_handlers/presence';
import { usePresence } from '../hooks/usePresence';
import { filterRoster, EMPTY_FILTERS } from '../lib/rosterFilter';
import type { RosterFilters } from '../lib/rosterFilter';
import { PRESENT, addDays, dayOfWeek, dayRange, isFullDayKind } from '../lib/presencePlan';
import { RosterFilterBar } from './RosterFilters';
import { SoldierPicker } from './SoldierSelect';
import { heDate, todayIso } from './DateRangePicker';

// נוכחות tab (admin): the DB's presence matrix — who is חופש / מחלה / לא מגויס /
// שחרור / גיוס on which CALENDAR day — and the editor for it. Since 2026-07-26
// this is the SOURCE OF TRUTH for presence (the sheet import no longer rebuilds
// `unavailability`).
//
// Only FULL-DAY statuses are editable; the partial kinds that came from the
// sheet (יציאה בבוקר, חזרה בערב, …) and the short-exit rows are shown greyed
// and read-only — clicking them still replaces the whole day.
//
// Two views over the same staged edits: a per-soldier list with a
// "מ־X עד־Y סמן כ־" bulk action, and a per-date matrix whose cells open a
// small state popup. Nothing is written until שמירה (leave guard on dirty).

const HE_DOW = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'];

const STATE_CLS: Record<string, string> = {
  'נוכח': 'bg-emerald-50 text-emerald-700',
  'חופש': 'bg-blue-100 text-blue-800',
  'מחלה': 'bg-rose-100 text-rose-800',
  'לא מגויס': 'bg-slate-200 text-slate-700',
  'שחרור': 'bg-purple-100 text-purple-800',
  'גיוס': 'bg-amber-100 text-amber-800',
};
/** Partial (display-only) kinds: readable but visibly not an editable state. */
const PARTIAL_CLS = 'bg-white text-gray-400 italic';
const cellCls = (status: string) =>
  STATE_CLS[status] ?? (status === PRESENT ? STATE_CLS[PRESENT] : PARTIAL_CLS);

const btnCls = 'rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white px-4 py-1.5 text-sm font-semibold';
const ghostBtnCls = 'rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600 px-4 py-1.5 text-sm font-medium';
const selectCls = 'rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm font-medium text-slate-800 focus:border-blue-500 focus:outline-none';

/** Sunday-anchored week containing `iso` (Sunday … Saturday). */
function weekOf(iso: string): { from: string; to: string } {
  const from = addDays(iso, -dayOfWeek(iso));
  return { from, to: addDays(from, 6) };
}

// ── cell popup ───────────────────────────────────────────────────────────────

function StatePopup({ title, current, states, onPick, onClose }: {
  title: string;
  current: string;
  states: string[];
  onPick: (state: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl p-5 space-y-3 w-full max-w-xs" onClick={(e) => e.stopPropagation()} dir="rtl">
        <div className="text-sm font-bold text-slate-800">{title}</div>
        {!states.includes(current) && (
          <div className="text-xs text-gray-500">
            הסטטוס הנוכחי <span className="font-medium">{current}</span> הוא סטטוס חלקי מהגיליון —
            בחירה כאן תחליף אותו ליום שלם.
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          {states.map((s) => (
            <button key={s} onClick={() => onPick(s)}
              className={`rounded-lg px-3 py-2 text-sm font-medium text-right ${cellCls(s)} ${
                s === current ? 'ring-2 ring-blue-500' : 'hover:opacity-80'}`}>
              {s}
            </button>
          ))}
        </div>
        <button onClick={onClose} className="w-full rounded-lg py-1.5 text-sm text-gray-400 hover:bg-gray-50">ביטול</button>
      </div>
    </div>
  );
}

// ── tab ──────────────────────────────────────────────────────────────────────

export function Presence({ guardRef }: { guardRef: MutableRefObject<TabLeaveGuard | null> }) {
  const initial = weekOf(todayIso());
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [mode, setMode] = useState<'matrix' | 'soldier'>('matrix');
  const [filters, setFilters] = useState<RosterFilters>({ ...EMPTY_FILTERS });
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [picked, setPicked] = useState<number | null>(null);
  const [cell, setCell] = useState<{ soldierId: number; day: string } | null>(null);

  const { data, loading, saving, error, setError, save } = usePresence(from, to);

  const days = data?.days ?? [];
  const states = data?.states ?? [];

  // baseline: soldierId -> day -> status (as stored)
  const base = useMemo(() => {
    const m = new Map<number, Record<string, string>>();
    for (const p of data?.presence ?? []) {
      const row: Record<string, string> = {};
      (data?.days ?? []).forEach((d, i) => { row[d] = p.statuses[i]; });
      m.set(p.soldierId, row);
    }
    return m;
  }, [data]);

  const key = (soldierId: number, day: string) => `${soldierId}|${day}`;
  const baseOf = (soldierId: number, day: string) => base.get(soldierId)?.[day] ?? PRESENT;
  const statusOf = (soldierId: number, day: string) =>
    edits[key(soldierId, day)] ?? baseOf(soldierId, day);
  const isDirtyCell = (soldierId: number, day: string) => key(soldierId, day) in edits;

  /** Stage one day; an edit back to the stored value drops out of the set. */
  const stage = (soldierId: number, day: string, status: string) => {
    setEdits((prev) => {
      const next = { ...prev };
      if (status === baseOf(soldierId, day)) delete next[key(soldierId, day)];
      else next[key(soldierId, day)] = status;
      return next;
    });
  };

  const isDirty = Object.keys(edits).length > 0;

  const commit = async (): Promise<boolean> => {
    if (!isDirty) return true;
    const bySoldier = new Map<number, PresenceDayInput[]>();
    for (const [k, status] of Object.entries(edits)) {
      const [sid, day] = k.split('|');
      const list = bySoldier.get(Number(sid));
      if (list) list.push({ day, status }); else bySoldier.set(Number(sid), [{ day, status }]);
    }
    const ok = await save([...bySoldier.entries()].map(([soldierId, d]) => ({ soldierId, days: d })));
    if (ok) setEdits({});
    return ok;
  };

  // leave guard for App's tab-switch interception + page reload
  useEffect(() => {
    guardRef.current = { isDirty: () => isDirty, save: commit };
    return () => { guardRef.current = null; };
  });
  useEffect(() => {
    if (!isDirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [isDirty]);

  const shown = useMemo(
    () => (data ? filterRoster(data.roster.soldiers, filters) : []),
    [data, filters]);

  const soldierName = (id: number) =>
    data?.roster.soldiers.find((s) => s.id === id)?.fullName ?? String(id);

  return (
    <div className="space-y-5">
      <div className="rounded-xl bg-blue-50 border border-blue-100 px-4 py-3 text-sm text-blue-800" dir="rtl">
        עריכת נוכחות החיילים — מקור האמת לנוכחות הוא המערכת (ייבוא מהגיליון כבר לא דורס
        אותה). ניתן לסמן ימים מלאים בלבד; סטטוסים חלקיים שהגיעו מהגיליון מוצגים באפור
        ולחיצה עליהם מחליפה את כל היום.
      </div>

      <div className="flex flex-wrap items-center gap-3" dir="rtl">
        <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm">
          <button onClick={() => setMode('matrix')}
            className={`px-3 py-1.5 font-medium ${mode === 'matrix' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
            לפי תאריך
          </button>
          <button onClick={() => setMode('soldier')}
            className={`px-3 py-1.5 font-medium ${mode === 'soldier' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
            לפי חייל
          </button>
        </div>
        <div className="flex items-center gap-2" dir="ltr">
          <input type="date" value={from} className={selectCls}
            onChange={(e) => { const v = e.target.value; if (!v) return; setFrom(v); if (to < v) setTo(v); }} />
          <span className="text-sm text-gray-500" dir="rtl">עד</span>
          <input type="date" value={to} min={from} className={selectCls}
            onChange={(e) => { const v = e.target.value; if (!v) return; setTo(v < from ? from : v); }} />
        </div>
        <button className={ghostBtnCls} onClick={() => { const w = weekOf(todayIso()); setFrom(w.from); setTo(w.to); }}>
          השבוע
        </button>

        <div className="flex-1" />

        {isDirty && (
          <span className="text-sm text-amber-700">{Object.keys(edits).length} שינויים לא שמורים</span>
        )}
        <button className={btnCls} disabled={!isDirty || saving} onClick={() => void commit()}>
          {saving ? 'שומר…' : 'שמירה'}
        </button>
        <button className={ghostBtnCls} disabled={!isDirty || saving} onClick={() => setEdits({})}>
          בטל שינויים
        </button>
        {loading && <span className="text-sm text-gray-400"><span className="animate-spin inline-block">↺</span></span>}
      </div>

      <RosterFilterBar filters={filters} setFilters={setFilters} meta={data?.roster ?? null} showArchived={false} />

      {error && <div className="rounded-xl bg-red-50 p-4 text-center text-red-700 text-sm">{error}</div>}

      {mode === 'matrix' ? (
        <div className="rounded-xl bg-white p-4 shadow-sm overflow-x-auto">
          <div className="mb-2 text-xs text-gray-400">{shown.length} חיילים</div>
          <table className="w-full text-sm border-separate border-spacing-0" dir="rtl">
            <thead>
              <tr className="text-gray-500">
                <th className="sticky right-0 z-10 bg-white text-right font-medium pl-3 pb-2">שם</th>
                {days.map((d) => (
                  <th key={d} className="font-medium pb-2 px-1 whitespace-nowrap text-center">
                    <div className="text-xs text-gray-400">{HE_DOW[dayOfWeek(d)]}</div>
                    <div className="tabular-nums">{d.slice(8, 10)}/{d.slice(5, 7)}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((s) => (
                <tr key={s.id}>
                  <td className="sticky right-0 z-10 bg-white border-t border-gray-50 pl-3 py-1 font-medium text-slate-800 whitespace-nowrap">
                    {s.fullName}
                    <span className="mr-1.5 text-xs font-normal text-gray-400">{s.platoon}</span>
                  </td>
                  {days.map((d) => {
                    const st = statusOf(s.id, d);
                    return (
                      <td key={d} className="border-t border-gray-50 px-0.5 py-1">
                        <button onClick={() => setCell({ soldierId: s.id, day: d })}
                          title={`${s.fullName} — ${heDate(d)}`}
                          className={`w-full rounded px-1 py-1 text-xs whitespace-nowrap ${cellCls(st)} ${
                            isDirtyCell(s.id, d) ? 'ring-2 ring-amber-500' : ''} hover:opacity-80`}>
                          {st === PRESENT ? '' : st}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
              {!loading && shown.length === 0 && (
                <tr><td colSpan={days.length + 1} className="py-6 text-center text-sm text-gray-400">אין חיילים תואמים</td></tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <PerSoldier
          soldiers={shown.map((s) => ({
            id: s.id, name: s.fullName, role: s.role, platoon: s.platoon,
            schedulable: s.isSchedulable,
          }))}
          picked={picked} setPicked={setPicked}
          days={days} states={states} from={from} to={to}
          statusOf={statusOf} isDirtyCell={isDirtyCell} stage={stage}
        />
      )}

      {cell && (
        <StatePopup
          title={`${soldierName(cell.soldierId)} — ${heDate(cell.day)}`}
          current={statusOf(cell.soldierId, cell.day)}
          states={states}
          onPick={(s) => { stage(cell.soldierId, cell.day, s); setCell(null); setError(null); }}
          onClose={() => setCell(null)}
        />
      )}
    </div>
  );
}

// ── per-soldier view ─────────────────────────────────────────────────────────

function PerSoldier({ soldiers, picked, setPicked, days, states, from, to, statusOf, isDirtyCell, stage }: {
  soldiers: { id: number; name: string; role: string; platoon: string; schedulable: boolean }[];
  picked: number | null;
  setPicked: (id: number | null) => void;
  days: string[];
  states: string[];
  from: string;
  to: string;
  statusOf: (soldierId: number, day: string) => string;
  isDirtyCell: (soldierId: number, day: string) => boolean;
  stage: (soldierId: number, day: string, status: string) => void;
}) {
  const [markFrom, setMarkFrom] = useState(from);
  const [markTo, setMarkTo] = useState(to);
  const [markState, setMarkState] = useState(states[1] ?? PRESENT);

  // keep the bulk range inside the loaded window (only those days are shown)
  useEffect(() => { setMarkFrom(from); setMarkTo(to); }, [from, to]);
  useEffect(() => { if (!states.includes(markState)) setMarkState(states[1] ?? PRESENT); }, [states, markState]);

  const apply = () => {
    if (picked == null) return;
    const lo = markFrom < from ? from : markFrom;
    const hi = markTo > to ? to : markTo;
    for (const d of dayRange(lo, hi)) stage(picked, d, markState);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="rounded-xl bg-white p-4 shadow-sm">
        <div className="mb-2 text-sm font-semibold text-slate-700" dir="rtl">בחר חייל</div>
        <SoldierPicker options={soldiers} selectedId={picked} onPick={setPicked} />
      </div>

      <div className="lg:col-span-2 rounded-xl bg-white p-4 shadow-sm space-y-4" dir="rtl">
        {picked == null ? (
          <div className="py-8 text-center text-sm text-gray-400">בחר חייל מהרשימה</div>
        ) : (
          <>
            <div className="text-base font-bold text-slate-800">
              {soldiers.find((s) => s.id === picked)?.name ?? ''}
            </div>

            <div className="flex flex-wrap items-end gap-2 rounded-lg bg-gray-50 p-3">
              <label className="space-y-1">
                <div className="text-xs text-gray-500 font-medium">מתאריך</div>
                <input type="date" className={selectCls} value={markFrom} min={from} max={to}
                  onChange={(e) => e.target.value && setMarkFrom(e.target.value)} />
              </label>
              <label className="space-y-1">
                <div className="text-xs text-gray-500 font-medium">עד תאריך</div>
                <input type="date" className={selectCls} value={markTo} min={markFrom} max={to}
                  onChange={(e) => e.target.value && setMarkTo(e.target.value)} />
              </label>
              <label className="space-y-1">
                <div className="text-xs text-gray-500 font-medium">סמן כ־</div>
                <select className={selectCls} value={markState} onChange={(e) => setMarkState(e.target.value)}>
                  {states.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
              <button className={btnCls} onClick={apply}>סמן</button>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {days.map((d) => {
                const st = statusOf(picked, d);
                return (
                  <div key={d} className={`rounded-lg px-2 py-1.5 text-xs text-center min-w-[4.5rem] ${cellCls(st)} ${
                    isDirtyCell(picked, d) ? 'ring-2 ring-amber-500' : ''}`}>
                    <div className="font-medium tabular-nums">
                      {HE_DOW[dayOfWeek(d)]} {d.slice(8, 10)}/{d.slice(5, 7)}
                    </div>
                    <div className={isFullDayKind(st) || st === PRESENT ? '' : 'opacity-70'}>{st}</div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
