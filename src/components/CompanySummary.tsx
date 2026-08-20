import { useEffect, useMemo, useState } from 'react';
import type { SheetData } from '../types';
import type { ShavtzakAllData } from '../../api/_handlers/shavtzak';
import { useExits } from '../hooks/useExits';
import type { ShortExit } from '../hooks/useExits';
import { exitState, fmtExitDateTime, countCurrentlyOut } from '../lib/shortExits';
import { SoldierPopup } from './SoldierPopup';
import type { PopupState } from './SoldierPopup';

// ── Status classification ──────────────────────────────────────────────────
function classifyStatus(status: string): string {
  if (!status) return 'לא ידוע';
  if (status.includes('לא מגוייס') || status.includes('לא מגויס')) return 'לא מגוייס';
  if (status.includes('לא מגיע')) return 'לא מגיע';
  if (status.includes('יציאה בערב')) return 'יציאה בערב';
  if (status.includes('נוכח')) return 'נוכח';
  if (status.includes('שחרור') || status.includes('שחרר')) return 'שחרור';
  if (status.includes('חופש')) return 'חופש';
  return status;
}

const PRESENT_KEYS = new Set(['נוכח', 'יציאה בערב']);

const CAT_STYLE: Record<string, { bg: string; text: string; border: string; headerBg: string }> = {
  'נוכח':       { bg: 'bg-green-50',  text: 'text-green-800',  border: 'border-green-200',  headerBg: 'bg-green-100' },
  'יציאה בערב': { bg: 'bg-orange-50', text: 'text-orange-800', border: 'border-orange-200', headerBg: 'bg-orange-100' },
  'חופש':       { bg: 'bg-blue-50',   text: 'text-blue-800',   border: 'border-blue-200',   headerBg: 'bg-blue-100' },
  'שחרור':      { bg: 'bg-purple-50', text: 'text-purple-800', border: 'border-purple-200', headerBg: 'bg-purple-100' },
  'לא מגיע':    { bg: 'bg-red-50',    text: 'text-red-800',    border: 'border-red-200',    headerBg: 'bg-red-100' },
  'לא ידוע':    { bg: 'bg-gray-50',   text: 'text-gray-500',   border: 'border-gray-200',   headerBg: 'bg-gray-100' },
};

const fallbackStyle = CAT_STYLE['לא ידוע'];
const DISPLAY_CATS = ['נוכח', 'יציאה בערב', 'חופש', 'שחרור', 'לא מגיע', 'לא ידוע'];

// ── Date helpers ──────────────────────────────────────────────────────────
function parseSheetDate(d: string): Date {
  const [dd, mm, yy] = d.split('/');
  return new Date(2000 + parseInt(yy), parseInt(mm) - 1, parseInt(dd));
}
function todaySheetStr(): string {
  const d = new Date();
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getFullYear()).slice(2)}`;
}
function toInputVal(d: string): string {
  const [dd, mm, yy] = d.split('/');
  return `20${yy}-${mm}-${dd}`;
}
function fromInputVal(s: string): string {
  const [yyyy, mm, dd] = s.split('-');
  return `${dd}/${mm}/${String(yyyy).slice(2)}`;
}

// ── Datetime helpers for exits ────────────────────────────────────────────
function nowLocal(): string {
  const d = new Date();
  d.setSeconds(0, 0);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
function localPlusHours(h: number): string {
  const d = new Date();
  d.setSeconds(0, 0);
  d.setHours(d.getHours() + h);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
function isoToSheet(iso: string): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${p(d.getDate())}/${p(d.getMonth()+1)}/${String(d.getFullYear()).slice(2)} ${p(d.getHours())}:${p(d.getMinutes())}`;
  } catch { return iso; }
}

// ── Collapsible section ───────────────────────────────────────────────────
function Collapsible({ label, count, colorClass, children }: {
  label: string; count: number; colorClass?: string; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-gray-200 overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors text-right"
      >
        <span className="font-semibold text-gray-700 text-sm">{label}</span>
        <div className="flex items-center gap-2">
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${colorClass ?? 'bg-gray-200 text-gray-700'}`}>
            {count}
          </span>
          <span className="text-gray-400 text-sm">{open ? '▲' : '▼'}</span>
        </div>
      </button>
      {open && <div className="divide-y divide-gray-100">{children}</div>}
    </div>
  );
}

// ── Shavtzak helpers ─────────────────────────────────────────────────────
function schedToShavtzakKey(d: string): string {
  const [dd, mm, yy] = d.split('/');
  return `${dd}/${mm}/20${yy}`;
}

// Converts "HH:MM" to a comparable number; hours 0-5 → 24-29 to handle overnight ordering
function timeToVal(t: string): number {
  const h = parseInt(t.split(':')[0] ?? '0', 10);
  return h < 6 ? h + 24 : h;
}

// Returns true if currentVal falls within an explicit range like "16:00-22:00" or "22:00-06:00"
function isRangeActive(timeStr: string, currentVal: number): boolean {
  const parts = timeStr.split('-');
  if (parts.length < 2 || !parts[0] || !parts[1]) return false;
  const start = timeToVal(parts[0].trim());
  const end   = timeToVal(parts[1].trim());
  if (start < end) return currentVal >= start && currentVal < end;
  // Wraps midnight: active when currentVal >= start OR currentVal < end
  return currentVal >= start || currentVal < end;
}

// Returns set of soldier names currently on an active shift at currentVal
function getCurrentlyOnDuty(shavtzakAll: ShavtzakAllData, shavtzakKey: string, currentVal: number): Set<string> {
  const names = new Set<string>();
  const dayData = shavtzakAll.byDate[shavtzakKey];
  if (!dayData) return names;

  for (const group of dayData.groups) {
    for (const sub of group.subTypes) {
      // Collect sorted start-time values for boundary inference
      const startOnlyVals = sub.times
        .filter(t => t.time && !t.time.includes('-') && t.time !== 'יומי')
        .map(t => timeToVal(t.time))
        .filter((v, i, arr) => arr.indexOf(v) === i)
        .sort((a, b) => a - b);

      for (const slot of sub.times) {
        if (!slot.time || slot.time === 'יומי') {
          // Daily assignment — always on duty
          slot.soldiers.forEach(n => names.add(n));
          continue;
        }

        let isActive = false;

        if (slot.time.includes('-')) {
          isActive = isRangeActive(slot.time, currentVal);
        } else {
          const myVal = timeToVal(slot.time);
          const myIdx = startOnlyVals.indexOf(myVal);
          if (myIdx !== -1) {
            const endVal = myIdx < startOnlyVals.length - 1
              ? startOnlyVals[myIdx + 1]!
              : startOnlyVals[0]! + 24; // last slot wraps to first slot of next day
            isActive = currentVal >= myVal && currentVal < endVal;
          }
        }

        if (isActive) slot.soldiers.forEach(n => names.add(n));
      }
    }
  }

  return names;
}

// ── Main ──────────────────────────────────────────────────────────────────
export function CompanySummary({ data, shavtzakAll }: { data: SheetData; shavtzakAll: ShavtzakAllData | null }) {
  const { soldiers, dates, dayNames } = data;
  const { exits, loading: exitsLoading, saving, addExit, removeExit } = useExits();

  const [selectedDate, setSelectedDate] = useState(() => {
    const today = todaySheetStr();
    if (dates.includes(today)) return today;
    const past = dates.filter(d => d <= today);
    return past.length ? past[past.length - 1] : dates[0] ?? '';
  });
  const [popup, setPopup] = useState<PopupState | null>(null);
  const [includeMaflag, setIncludeMaflag] = useState(false);
  const [includeHamal, setIncludeHamal]   = useState(false);

  // Wall clock, re-read every minute — drives the browsed hour and the short-exit states
  const [now, setNow] = useState(() => new Date());
  const currentHour = now.getHours();
  const [viewHour, setViewHour] = useState(() => new Date().getHours());

  // Auto-tick: once per minute; if viewHour was tracking live, advance it with the clock
  useEffect(() => {
    const id = setInterval(() => {
      setNow(prev => {
        const next = new Date();
        if (next.getHours() !== prev.getHours()) {
          setViewHour(v => (v === prev.getHours() ? next.getHours() : v));
        }
        return next;
      });
    }, 60_000);
    return () => clearInterval(id);
  }, []);

  const isLive = viewHour === currentHour;
  const viewVal = viewHour < 6 ? viewHour + 24 : viewHour;

  // Add-exit form state
  const [showAddForm, setShowAddForm] = useState(false);
  const [formName, setFormName] = useState('');
  const [formExit, setFormExit] = useState(nowLocal);
  const [formReturn, setFormReturn] = useState(() => localPlusHours(2));

  // Last "חזר לבסיס" click, kept client-side so a mistaken click can be re-added
  const [lastReturned, setLastReturned] = useState<ShortExit | null>(null);
  const [showExitsHelp, setShowExitsHelp] = useState(false);

  const phoneOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of soldiers) m.set(s.fullName, s.phone);
    return m;
  }, [soldiers]);

  // Soldiers visible in the summary (respects מפלג/חמל checkboxes)
  const visibleSoldiers = useMemo(() =>
    soldiers.filter(s => {
      const u = s.unit.replace(/"/g, '');
      if (!includeMaflag && u.includes('מפלג')) return false;
      if (!includeHamal  && u.includes('חמל'))  return false;
      return true;
    }),
    [soldiers, includeMaflag, includeHamal]
  );

  const idx     = dates.indexOf(selectedDate);
  const canPrev = idx > 0;
  const canNext = idx < dates.length - 1;
  const prevDate = idx > 0 ? dates[idx - 1] : null;

  const units = useMemo(() => {
    const set = new Set(visibleSoldiers.map(s => s.unit).filter(Boolean));
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'he'));
  }, [visibleSoldiers]);

  // All soldiers classified for selected date
  const classified = useMemo(() =>
    visibleSoldiers.map(s => ({
      soldier: s,
      status: classifyStatus(s.schedule[selectedDate] ?? ''),
      raw: s.schedule[selectedDate] ?? '',
    })),
    [visibleSoldiers, selectedDate]
  );

  // Exclude לא מגוייס from all regular counts/lists
  const active = useMemo(() => classified.filter(r => r.status !== 'לא מגוייס'), [classified]);

  const statusCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const { status } of active) c[status] = (c[status] ?? 0) + 1;
    return c;
  }, [active]);

  const effectiveCount = (statusCounts['נוכח'] ?? 0) + (statusCounts['יציאה בערב'] ?? 0);
  const activeCats = DISPLAY_CATS.filter(c => (statusCounts[c] ?? 0) > 0);

  const unitCounts = useMemo(() => {
    const map: Record<string, Record<string, number>> = {};
    for (const unit of units) map[unit] = {};
    for (const { soldier, status } of active) {
      if (!soldier.unit) continue;
      const u = map[soldier.unit] ?? {};
      u[status] = (u[status] ?? 0) + 1;
      map[soldier.unit] = u;
    }
    return map;
  }, [active, units]);

  const presentList = useMemo(() =>
    active.filter(r => PRESENT_KEYS.has(r.status))
      .sort((a, b) => a.soldier.fullName.localeCompare(b.soldier.fullName, 'he')),
    [active]
  );
  const absentList = useMemo(() =>
    active.filter(r => !PRESENT_KEYS.has(r.status))
      .sort((a, b) => a.soldier.unit.localeCompare(b.soldier.unit, 'he')),
    [active]
  );

  // Soldiers on base not on an active shift at the viewed hour
  const freeOnBase = useMemo(() => {
    if (!shavtzakAll) return [];
    const onDuty = getCurrentlyOnDuty(shavtzakAll, schedToShavtzakKey(selectedDate), viewVal);
    return presentList.filter(({ soldier }) => !onDuty.has(soldier.fullName));
  }, [presentList, shavtzakAll, selectedDate, viewVal]);

  // Changes from previous date (all visible soldiers including לא מגוייס)
  const changes = useMemo(() => {
    if (!prevDate) return [];
    return visibleSoldiers
      .map(s => ({
        soldier: s,
        today: classifyStatus(s.schedule[selectedDate] ?? ''),
        prev: classifyStatus(s.schedule[prevDate] ?? ''),
      }))
      .filter(r => r.today !== r.prev);
  }, [visibleSoldiers, selectedDate, prevDate]);

  // Group changes by today's status
  const changesByStatus = useMemo(() => {
    const map = new Map<string, typeof changes>();
    for (const c of changes) {
      const arr = map.get(c.today) ?? [];
      arr.push(c);
      map.set(c.today, arr);
    }
    return map;
  }, [changes]);

  // Weekly strip
  const weekStrip = useMemo(() =>
    dates.slice(Math.max(0, idx), Math.max(0, idx) + 10).map(date => ({
      date,
      present: visibleSoldiers.filter(s =>
        PRESENT_KEYS.has(classifyStatus(s.schedule[date] ?? '')) &&
        classifyStatus(s.schedule[date] ?? '') !== 'לא מגוייס'
      ).length,
      total: visibleSoldiers.filter(s => classifyStatus(s.schedule[date] ?? '') !== 'לא מגוייס').length,
    })),
    [dates, idx, visibleSoldiers]
  );

  async function handleAddExit() {
    if (!formName.trim()) return;
    await addExit(formName.trim(), isoToSheet(formExit), isoToSheet(formReturn));
    setShowAddForm(false);
    setFormName('');
    setFormExit(nowLocal());
    setFormReturn(localPlusHours(2));
  }

  // The sheet has no "returned" flag — marking a soldier back deletes his row.
  // We keep the deleted row in memory so a mistaken click can re-append it.
  async function handleReturned(exit: ShortExit) {
    setLastReturned(exit);
    await removeExit(exit.rowIndex);
  }

  async function handleUndoReturn() {
    const exit = lastReturned;
    if (!exit) return;
    setLastReturned(null);
    await addExit(exit.name, exit.exitTime, exit.returnTime);
  }

  if (!dates.length) return (
    <div className="rounded-xl border-2 border-dashed border-gray-200 py-16 text-center text-gray-400">
      <p className="text-lg">אין נתונים</p>
    </div>
  );

  return (
    <div className="space-y-4" dir="rtl">

      {/* Date navigation */}
      <div className="flex items-center gap-2" dir="ltr">
        <button onClick={() => canPrev && setSelectedDate(dates[idx - 1])} disabled={!canPrev}
          className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-700 hover:bg-gray-50 disabled:opacity-30 font-bold text-lg leading-none">‹</button>
        <input type="date"
          value={selectedDate ? toInputVal(selectedDate) : ''}
          min={dates[0] ? toInputVal(dates[0]) : undefined}
          max={dates[dates.length-1] ? toInputVal(dates[dates.length-1]) : undefined}
          onChange={e => {
            const picked = fromInputVal(e.target.value);
            if (dates.includes(picked)) { setSelectedDate(picked); return; }
            const sorted = [...dates].sort((a,b) =>
              Math.abs(parseSheetDate(a).getTime() - parseSheetDate(fromInputVal(e.target.value)).getTime()) -
              Math.abs(parseSheetDate(b).getTime() - parseSheetDate(fromInputVal(e.target.value)).getTime())
            );
            if (sorted[0]) setSelectedDate(sorted[0]);
          }}
          className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800 shadow-sm focus:border-blue-500 focus:outline-none"
        />
        <button onClick={() => canNext && setSelectedDate(dates[idx + 1])} disabled={!canNext}
          className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-700 hover:bg-gray-50 disabled:opacity-30 font-bold text-lg leading-none">›</button>
        <span className="text-sm text-gray-500 mr-1">{dayNames[selectedDate] ?? ''}</span>
      </div>

      {/* Unit-type filter */}
      <div className="flex items-center gap-4 text-sm text-gray-600">
        <span className="font-medium text-gray-500 text-xs">הצגה:</span>
        <label className="flex items-center gap-1.5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={includeMaflag}
            onChange={e => setIncludeMaflag(e.target.checked)}
            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          <span>כולל מפלג</span>
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={includeHamal}
            onChange={e => setIncludeHamal(e.target.checked)}
            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          <span>כולל חמל</span>
        </label>
      </div>

      {/* Effective strength banner */}
      <div className="rounded-xl bg-slate-800 text-white px-5 py-4 flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="text-xs font-medium opacity-60 mb-0.5">כוח אפקטיבי</div>
          <div className="text-4xl font-bold">{effectiveCount}</div>
          <div className="text-sm opacity-60 mt-0.5">מתוך {active.length} חיילים</div>
        </div>
        <div className="flex flex-wrap gap-1.5 justify-end">
          {activeCats.map(cat => {
            const s = CAT_STYLE[cat] ?? fallbackStyle;
            return (
              <span key={cat} className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${s.bg} ${s.text}`}>
                {cat} {statusCounts[cat]}
              </span>
            );
          })}
        </div>
      </div>

      {/* Free on base — browse by hour */}
      <div className="rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-3">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-slate-700">בבסיס ללא שיבוץ</span>
            <span className="rounded-full bg-slate-200 text-slate-700 px-2 py-0.5 text-xs font-bold">{freeOnBase.length}</span>
          </div>
          <div className="flex items-center gap-1.5" dir="ltr">
            <button
              onClick={() => setViewHour(h => (h + 23) % 24)}
              className="rounded-lg border border-slate-300 bg-white hover:bg-slate-100 w-7 h-7 flex items-center justify-center text-slate-600 font-bold text-sm leading-none"
            >‹</button>
            <span className="w-14 text-center text-sm font-semibold text-slate-800 tabular-nums">
              {String(viewHour).padStart(2, '0')}:00
            </span>
            <button
              onClick={() => setViewHour(h => (h + 1) % 24)}
              className="rounded-lg border border-slate-300 bg-white hover:bg-slate-100 w-7 h-7 flex items-center justify-center text-slate-600 font-bold text-sm leading-none"
            >›</button>
            {isLive ? (
              <span className="rounded-full bg-green-100 text-green-700 px-2 py-0.5 text-xs font-semibold">כרגע</span>
            ) : (
              <button
                onClick={() => setViewHour(currentHour)}
                className="rounded-full bg-blue-50 border border-blue-200 text-blue-600 px-2.5 py-0.5 text-xs font-semibold hover:bg-blue-100 transition-colors"
              >
                חזור לכרגע
              </button>
            )}
          </div>
        </div>
        {freeOnBase.length === 0 ? (
          <p className="text-xs text-slate-400">כל החיילים בבסיס נמצאים בשיבוץ בשעה זו</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {freeOnBase.map(({ soldier }) => (
              <span
                key={soldier.id}
                className="inline-flex items-center gap-1.5 rounded-full bg-white border border-slate-200 shadow-sm px-3 py-1 text-sm font-medium text-slate-700"
              >
                {soldier.fullName}
                <span className="text-xs text-slate-400">{soldier.unit}</span>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Short exits */}
      <div className="rounded-xl border border-gray-200 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50 border-b border-gray-200 gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-gray-700 text-sm">כרגע ביציאה קצרה</span>
            {exitsLoading
              ? <span className="text-xs text-gray-400 animate-pulse">טוען...</span>
              : <span className="rounded-full bg-amber-100 text-amber-800 px-2 py-0.5 text-xs font-bold">{countCurrentlyOut(exits, now)}</span>}
            <button
              onClick={() => setShowExitsHelp(v => !v)}
              aria-label="הסבר על הרשימה"
              className="w-5 h-5 rounded-full border border-gray-300 bg-white text-gray-500 hover:bg-gray-100 text-[11px] font-bold leading-none flex items-center justify-center"
            >
              i
            </button>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {lastReturned && (
              <button
                onClick={handleUndoReturn}
                disabled={saving}
                className="rounded-lg border border-amber-300 bg-amber-50 hover:bg-amber-100 disabled:opacity-50 text-amber-800 px-3 py-1.5 text-xs font-semibold transition-colors"
              >
                ↩ בטל לחיצה — החזר את {lastReturned.name}
              </button>
            )}
            <button
              onClick={() => { setShowAddForm(v => !v); setFormExit(nowLocal()); setFormReturn(localPlusHours(2)); }}
              className="rounded-lg bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 text-xs font-semibold transition-colors"
            >
              + הוסף יציאה קצרה
            </button>
          </div>
        </div>

        {showExitsHelp && (
          <div className="px-4 py-2.5 bg-amber-50 border-b border-amber-100 text-xs text-amber-900 leading-relaxed space-y-1">
            <p>
              <span className="font-semibold">חזר לבסיס ✓</span> מוחק את השורה מגיליון היציאות — אין סימון "חזר",
              השורה קיימת רק כל זמן שהחייל בחוץ. לחיצה בטעות ניתנת לביטול מיד לאחריה.
            </p>
            <p>
              המספר למעלה מונה את מי שנמצא <span className="font-semibold">כרגע</span> מחוץ לבסיס:
              יציאות שטרם התחילו לא נספרות, ומי שזמן החזרה שלו עבר והוא טרם סומן כחוזר — כן.
            </p>
          </div>
        )}

        {/* Add form */}
        {showAddForm && (
          <div className="px-4 py-3 bg-blue-50 border-b border-blue-100 space-y-2">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">שם החייל</label>
                <input
                  list="soldiers-datalist"
                  value={formName}
                  onChange={e => setFormName(e.target.value)}
                  placeholder="הקלד שם..."
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                />
                <datalist id="soldiers-datalist">
                  {soldiers.map(s => <option key={s.id} value={s.fullName} />)}
                </datalist>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">זמן יציאה</label>
                <input type="datetime-local" value={formExit} onChange={e => setFormExit(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 mb-1 block">זמן חזרה משוער</label>
                <input type="datetime-local" value={formReturn} onChange={e => setFormReturn(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowAddForm(false)}
                className="rounded-lg border border-gray-300 bg-white px-4 py-1.5 text-sm text-gray-600 hover:bg-gray-50">
                ביטול
              </button>
              <button onClick={handleAddExit} disabled={!formName.trim() || saving}
                className="rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-1.5 text-sm font-semibold">
                {saving ? 'שומר...' : 'הוסף יציאה'}
              </button>
            </div>
          </div>
        )}

        {/* Exits list */}
        {exits.length === 0 && !exitsLoading ? (
          <div className="px-4 py-4 text-sm text-gray-400 text-center">אין יציאות קצרות כרגע</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {exits.map(exit => {
              const state = exitState(exit, now);
              const late = state === 'late';
              return (
                <div
                  key={exit.rowIndex}
                  className={`flex items-center px-4 py-2.5 gap-3 flex-wrap ${
                    late ? 'bg-orange-50' : 'bg-white hover:bg-gray-50/50'
                  }`}
                >
                  <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
                    <button
                      onClick={() => setPopup({ name: exit.name, phone: phoneOf.get(exit.name) ?? '' })}
                      className={`font-semibold text-sm hover:text-blue-600 text-right ${late ? 'text-orange-900' : 'text-gray-800'}`}
                    >
                      {exit.name}
                    </button>
                    {late && (
                      <span className="rounded-full bg-orange-200 text-orange-900 px-2 py-0.5 text-[11px] font-bold">⚠ טרם חזר</span>
                    )}
                    {state === 'planned' && (
                      <span className="rounded-full bg-gray-100 text-gray-500 px-2 py-0.5 text-[11px] font-semibold">מתוכנן</span>
                    )}
                  </div>
                  <div className="grid grid-cols-[auto_auto] gap-x-1.5 text-xs text-gray-500">
                    <span>יציאה:</span>
                    <span className="font-medium text-gray-700">{fmtExitDateTime(exit.exitTime, now)}</span>
                    <span>חזרה:</span>
                    <span className={`font-medium ${late ? 'font-bold text-orange-800' : 'text-gray-700'}`}>
                      {fmtExitDateTime(exit.returnTime, now)}
                    </span>
                  </div>
                  <button
                    onClick={() => handleReturned(exit)}
                    disabled={saving}
                    className="shrink-0 rounded-lg bg-green-500 hover:bg-green-600 disabled:opacity-50 text-white px-3 py-1.5 text-xs font-semibold transition-colors"
                  >
                    חזר לבסיס ✓
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Changes from previous date */}
      {changes.length > 0 && prevDate && (
        <div className="rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-200">
            <span className="font-semibold text-gray-700 text-sm">שינויים מהיום הקודם</span>
            <span className="mr-2 text-xs text-gray-400">({prevDate.slice(0,5)} → {selectedDate.slice(0,5)})</span>
          </div>
          <div className="divide-y divide-gray-100">
            {DISPLAY_CATS.concat(['לא מגוייס']).filter(cat => changesByStatus.has(cat)).map(cat => {
              const group = changesByStatus.get(cat)!;
              const s = CAT_STYLE[cat] ?? fallbackStyle;
              return (
                <div key={cat} className="px-4 py-2.5">
                  <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-bold border mb-2 ${s.bg} ${s.text} ${s.border}`}>
                    {cat} ({group.length})
                  </span>
                  <div className="flex flex-wrap gap-x-4 gap-y-0.5">
                    {group.map(({ soldier, prev }) => (
                      <span key={soldier.id} className="text-sm text-gray-700">
                        {soldier.fullName}
                        <span className="text-xs text-gray-400 mr-1">(היה: {prev})</span>
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Unit breakdown table */}
      {units.length > 0 && (
        <div className="rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-gray-50">
                <th className="py-2.5 px-4 text-right font-semibold text-gray-700 border-b border-gray-200">מחלקה</th>
                {activeCats.map(cat => {
                  const s = CAT_STYLE[cat] ?? fallbackStyle;
                  return (
                    <th key={cat} className={`py-2.5 px-3 text-center font-semibold border-b border-gray-200 ${s.text} ${s.headerBg}`}>
                      {cat}
                    </th>
                  );
                })}
                <th className="py-2.5 px-3 text-center font-semibold text-gray-700 border-b border-gray-200 bg-gray-50">סה"כ</th>
              </tr>
            </thead>
            <tbody>
              {units.map((unit, i) => {
                const counts = unitCounts[unit] ?? {};
                const total = active.filter(r => r.soldier.unit === unit).length;
                return (
                  <tr key={unit} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}>
                    <td className="py-2 px-4 font-medium text-gray-800 border-b border-gray-100">מחלקה {unit}</td>
                    {activeCats.map(cat => {
                      const s = CAT_STYLE[cat] ?? fallbackStyle;
                      const count = counts[cat] ?? 0;
                      return (
                        <td key={cat} className={`py-2 px-3 text-center border-b border-gray-100 ${count > 0 ? s.text : 'text-gray-300'}`}>
                          {count > 0 ? <span className="font-bold">{count}</span> : '—'}
                        </td>
                      );
                    })}
                    <td className="py-2 px-3 text-center font-semibold text-gray-700 border-b border-gray-100">{total}</td>
                  </tr>
                );
              })}
              <tr className="bg-gray-100 font-semibold">
                <td className="py-2 px-4 text-gray-800">סה"כ</td>
                {activeCats.map(cat => {
                  const s = CAT_STYLE[cat] ?? fallbackStyle;
                  return (
                    <td key={cat} className={`py-2 px-3 text-center font-bold ${s.text}`}>{statusCounts[cat] ?? 0}</td>
                  );
                })}
                <td className="py-2 px-3 text-center font-bold text-gray-800">{active.length}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* בבסיס / לא בבסיס collapsibles */}
      <Collapsible label="בבסיס" count={presentList.length} colorClass="bg-green-100 text-green-800">
        {presentList.map(({ soldier, raw }) => {
          const s = CAT_STYLE['נוכח'];
          return (
            <div key={soldier.id} className="flex items-center justify-between px-4 py-2 bg-white hover:bg-gray-50/50">
              <div className="flex items-center gap-2">
                <span className="font-medium text-gray-800 text-sm">{soldier.fullName}</span>
                <span className="text-xs text-gray-400">מחלקה {soldier.unit}</span>
              </div>
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium border ${s.bg} ${s.text} ${s.border}`}>
                {raw || 'נוכח'}
              </span>
            </div>
          );
        })}
      </Collapsible>

      <Collapsible label="לא בבסיס" count={absentList.length} colorClass="bg-red-100 text-red-700">
        {absentList.map(({ soldier, status, raw }) => {
          const s = CAT_STYLE[status] ?? fallbackStyle;
          return (
            <div key={soldier.id} className="flex items-center justify-between px-4 py-2 bg-white hover:bg-gray-50/50">
              <div className="flex items-center gap-2">
                <span className="font-medium text-gray-800 text-sm">{soldier.fullName}</span>
                <span className="text-xs text-gray-400">מחלקה {soldier.unit}</span>
              </div>
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold border ${s.bg} ${s.text} ${s.border}`}>
                {raw || status}
              </span>
            </div>
          );
        })}
      </Collapsible>

      {/* Weekly strip */}
      {weekStrip.length > 1 && (
        <div>
          <div className="text-xs font-semibold text-gray-500 mb-2">כוח אפקטיבי — 10 ימים קרובים</div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {weekStrip.map(({ date, present, total }) => {
              const pct = total ? present / total : 0;
              const isSelected = date === selectedDate;
              const color = pct >= 0.8 ? 'text-green-700' : pct >= 0.5 ? 'text-yellow-700' : 'text-red-700';
              const barColor = pct >= 0.8 ? 'bg-green-400' : pct >= 0.5 ? 'bg-yellow-400' : 'bg-red-400';
              return (
                <button key={date} onClick={() => setSelectedDate(date)}
                  className={`flex-shrink-0 rounded-xl border-2 px-3 py-2 text-center w-16 transition-colors ${
                    isSelected ? 'border-slate-700 bg-slate-800 text-white' : 'border-gray-200 bg-white hover:border-gray-300'
                  }`}
                >
                  <div className={`text-xs font-medium mb-1 ${isSelected ? 'text-white/70' : 'text-gray-500'}`}>{date.slice(0,5)}</div>
                  <div className={`text-lg font-bold leading-none ${isSelected ? 'text-white' : color}`}>{present}</div>
                  <div className={`text-[10px] mt-0.5 ${isSelected ? 'text-white/50' : 'text-gray-400'}`}>/{total}</div>
                  {!isSelected && (
                    <div className="mt-1.5 h-1 rounded-full bg-gray-100 overflow-hidden">
                      <div className={`h-full rounded-full ${barColor}`} style={{ width: `${Math.round(pct * 100)}%` }} />
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {popup && <SoldierPopup info={popup} onClose={() => setPopup(null)} />}
    </div>
  );
}
