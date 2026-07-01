import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useShavtzak, todayShavtzakStr } from '../hooks/useShavtzak';
import type { ShavtzakData, StationGroup, SubType } from '../../api/shavtzak';
import type { Soldier } from '../types';

// ── Soldier lookup context ─────────────────────────────────────────────────
interface SoldierInfo { unit: string; role: string; phone: string }
const SoldierCtx    = createContext<Map<string, SoldierInfo>>(new Map());
const NameClickCtx  = createContext<(name: string, info: SoldierInfo | undefined) => void>(() => {});

const BOLD_ROLES = new Set(['מ"מ', 'מ"פ', 'סמ"פ', 'מ"כ']);
const UNIT_COLOR: Record<string, string> = {
  '1':     'text-red-500',
  '2':     'text-green-600',
  '3':     'text-amber-600',
  'מפל"ג':  'text-purple-700',
  'חמ"ל':   'text-blue-500',
};

function SoldierName({ name }: { name: string }) {
  const lookup   = useContext(SoldierCtx);
  const onCLick  = useContext(NameClickCtx);
  const info     = lookup.get(name);
  const bold     = info ? BOLD_ROLES.has(info.role) : false;
  const color    = info ? (UNIT_COLOR[info.unit] ?? 'text-gray-800') : 'text-gray-800';
  return (
    <span
      onClick={() => onCLick(name, info)}
      className={`text-sm whitespace-nowrap leading-snug select-none cursor-pointer active:opacity-70 ${color} ${bold ? 'font-bold' : 'font-medium'}`}
    >
      {name}
    </span>
  );
}

// ── Soldier popup ──────────────────────────────────────────────────────────
interface PopupState { name: string; phone: string }

function SoldierPopup({ info, onClose }: { info: PopupState; onClose: () => void }) {
  const clean = info.phone.replace(/\D/g, '');
  // Israeli numbers: 05X-XXXXXXX → 97X5XXXXXXX
  const waNum = clean.startsWith('0') ? '972' + clean.slice(1) : clean;
  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 px-4 pb-6 sm:pb-0"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xs bg-white rounded-2xl shadow-2xl p-6 space-y-4"
        onClick={e => e.stopPropagation()}
      >
        <div className="text-center">
          <p className="text-lg font-bold text-gray-800">{info.name}</p>
        </div>
        {clean ? (
          <>
          <p className="text-center text-gray-500 text-sm font-medium">{info.phone}</p>
          <div className="flex gap-3">
            <a
              href={`tel:${clean}`}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-green-500 hover:bg-green-600 active:bg-green-700 text-white px-4 py-3 text-base font-semibold transition-colors"
            >
              <span>📞</span>
              התקשר
            </a>
            <a
              href={`https://wa.me/${waNum}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#25D366] hover:bg-[#1ebe5d] active:bg-[#17a84f] text-white px-4 py-3 text-base font-semibold transition-colors"
            >
              <span>💬</span>
              וואטסאפ
            </a>
          </div>
          </>
        ) : (
          <p className="text-center text-gray-400 text-sm">אין מספר טלפון</p>
        )}
        <button
          onClick={onClose}
          className="w-full rounded-xl border border-gray-200 py-2 text-sm text-gray-500 hover:bg-gray-50"
        >
          סגור
        </button>
      </div>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────
function timeToVal(t: string): number {
  if (!t || t === 'יומי') return 9999;
  const h = parseInt(t.split(':')[0] ?? '0');
  return h < 6 ? h + 24 : h;
}

function allUniqueTimes(subTypes: SubType[]): string[] {
  const set = new Set(subTypes.flatMap(s => s.times.map(t => t.time)));
  return Array.from(set).sort((a, b) => timeToVal(a) - timeToVal(b));
}

function isYomiOnly(subTypes: SubType[]): boolean {
  return subTypes.every(s =>
    s.times.length === 1 && (!s.times[0].time || s.times[0].time === 'יומי')
  );
}

// ── Color palette ──────────────────────────────────────────────────────────
type Colors = { border: string; header: string; bg: string; rowAlt: string; colHeader: string };
const PALETTE: [string, Colors][] = [
  ['סיור',        { border: 'border-blue-300',    header: 'bg-blue-700 text-white',    bg: 'bg-white', rowAlt: 'bg-blue-50/60',    colHeader: 'bg-blue-50' }],
  ['עמדות הגנה', { border: 'border-slate-300',    header: 'bg-slate-600 text-white',   bg: 'bg-white', rowAlt: 'bg-slate-50',      colHeader: 'bg-slate-100' }],
  ['חפק',         { border: 'border-orange-300',   header: 'bg-orange-600 text-white',  bg: 'bg-white', rowAlt: 'bg-orange-50/40',  colHeader: 'bg-orange-50' }],
  ['חמ',          { border: 'border-sky-300',      header: 'bg-sky-600 text-white',     bg: 'bg-white', rowAlt: 'bg-sky-50/40',     colHeader: 'bg-sky-50' }],
  ['מגן',         { border: 'border-purple-300',   header: 'bg-purple-700 text-white',  bg: 'bg-white', rowAlt: 'bg-purple-50/40',  colHeader: 'bg-purple-50' }],
  ['זימות',       { border: 'border-teal-300',     header: 'bg-teal-700 text-white',    bg: 'bg-white', rowAlt: 'bg-teal-50/40',    colHeader: 'bg-teal-50' }],
  ['תגבורות',     { border: 'border-red-300',      header: 'bg-red-700 text-white',     bg: 'bg-white', rowAlt: 'bg-red-50/40',     colHeader: 'bg-red-50' }],
  ['נוספים',      { border: 'border-indigo-300',   header: 'bg-indigo-700 text-white',  bg: 'bg-white', rowAlt: 'bg-indigo-50/40',  colHeader: 'bg-indigo-50' }],
];

// Cycle colors for any station not matched above
const CYCLE_COLORS: Colors[] = [
  { border: 'border-cyan-300',    header: 'bg-cyan-700 text-white',    bg: 'bg-white', rowAlt: 'bg-cyan-50/40',    colHeader: 'bg-cyan-50' },
  { border: 'border-rose-300',    header: 'bg-rose-700 text-white',    bg: 'bg-white', rowAlt: 'bg-rose-50/40',    colHeader: 'bg-rose-50' },
  { border: 'border-lime-300',    header: 'bg-lime-700 text-white',    bg: 'bg-white', rowAlt: 'bg-lime-50/40',    colHeader: 'bg-lime-50' },
  { border: 'border-amber-300',   header: 'bg-amber-600 text-white',   bg: 'bg-white', rowAlt: 'bg-amber-50/40',   colHeader: 'bg-amber-50' },
  { border: 'border-violet-300',  header: 'bg-violet-700 text-white',  bg: 'bg-white', rowAlt: 'bg-violet-50/40',  colHeader: 'bg-violet-50' },
];

const colorCache = new Map<string, Colors>();
let cycleIdx = 0;

function getColors(name: string): Colors {
  if (colorCache.has(name)) return colorCache.get(name)!;
  for (const [key, val] of PALETTE) {
    if (name.includes(key)) { colorCache.set(name, val); return val; }
  }
  const c = CYCLE_COLORS[cycleIdx++ % CYCLE_COLORS.length];
  colorCache.set(name, c);
  return c;
}

// ── Layout 1: יומי-only ────────────────────────────────────────────────────
function YomiGrid({ subTypes, bg, groupName = '' }: { subTypes: SubType[]; bg: string; groupName?: string }) {
  if (subTypes.length > 1) {
    return (
      <div className={`${bg} flex`} dir="rtl">
        {subTypes.map((sub, si) => {
          const soldiers = sub.times[0]?.soldiers ?? [];
          const innerCols = soldiers.length > 5 ? 2 : 1;
          return (
            <div
              key={sub.sug}
              className={`flex-1 p-3 ${si < subTypes.length - 1 ? 'border-l border-gray-100' : ''}`}
            >
              {sub.sug && (
                <div className="text-sm font-bold text-gray-600 mb-1.5 pb-1 border-b border-gray-200">{sub.sug}</div>
              )}
              <div className="grid gap-x-4 gap-y-0.5" style={{ gridTemplateColumns: `repeat(${innerCols}, auto)` }}>
                {soldiers.map((name, i) => (
                  <SoldierName key={i} name={name} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  const first = subTypes[0];
  const soldiers = first?.times[0]?.soldiers ?? [];
  const sug = first?.sug ?? '';
  const showSug = sug && sug !== groupName;
  const cols = soldiers.length <= 6 ? 2 : soldiers.length <= 12 ? 3 : 4;
  return (
    <div className={`p-3 ${bg}`}>
      {showSug && (
        <div className="text-xs font-semibold text-gray-500 mb-1.5 pb-1 border-b border-gray-200 text-center">
          {sug}
        </div>
      )}
      <div className="grid gap-x-6 gap-y-0.5" style={{ gridTemplateColumns: `repeat(${cols}, auto)` }}>
        {soldiers.map((name, i) => (
          <SoldierName key={i} name={name} />
        ))}
      </div>
    </div>
  );
}

// ── Layout 2: single sub-type, timed → times as columns ───────────────────
function TransposedTable({ sub, bg, rowAlt, colHeader, groupName = '' }: {
  sub: SubType; bg: string; rowAlt: string; colHeader: string; groupName?: string;
}) {
  const maxRows = Math.max(...sub.times.map(t => t.soldiers.length), 0);
  return (
    <div className={`overflow-x-auto ${bg}`}>
      <table className="w-full border-collapse" dir="rtl">
        <thead>
          {sub.sug && sub.sug !== groupName && (
            <tr>
              <td
                colSpan={sub.times.length}
                className={`py-1 px-2 text-center text-xs font-semibold text-gray-500 border-b border-gray-200 ${colHeader}`}
              >
                {sub.sug}
              </td>
            </tr>
          )}
          <tr>
            {sub.times.map(slot => (
              <th key={slot.time}
                className={`py-2 px-2 sm:px-4 text-center text-sm font-semibold text-gray-700 border-b-2 border-gray-200 ${colHeader}`}>
                {slot.time || 'יומי'}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: maxRows }).map((_, rowIdx) => (
            <tr key={rowIdx} className={rowIdx % 2 === 1 ? rowAlt : ''}>
              {sub.times.map(slot => (
                <td key={slot.time} className="py-1.5 px-2 sm:px-4 text-center border-b border-gray-100">
                  {slot.soldiers[rowIdx] ? <SoldierName name={slot.soldiers[rowIdx]} /> : ''}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Layout 3: multiple sub-types, times as rows ────────────────────────────
function MultiTypeTable({ subTypes, bg, rowAlt, colHeader }: {
  subTypes: SubType[]; bg: string; rowAlt: string; colHeader: string;
}) {
  const times = allUniqueTimes(subTypes);
  const lookup: Record<string, Record<string, string[]>> = {};
  for (const sub of subTypes) {
    lookup[sub.sug] = {};
    for (const slot of sub.times) lookup[sub.sug][slot.time] = slot.soldiers;
  }
  return (
    <div className={`overflow-x-auto ${bg}`}>
      <table className="w-full border-collapse" dir="rtl">
        <thead>
          <tr>
            <th className={`py-2 px-2 sm:px-4 text-right text-sm font-semibold text-gray-500 border-b-2 border-gray-200 ${colHeader} whitespace-nowrap w-12 sm:w-16`}>
              שעה
            </th>
            {subTypes.map(sub => (
              <th key={sub.sug}
                className={`py-2 px-4 text-center text-sm font-bold text-gray-700 border-b-2 border-gray-200 ${colHeader}`}>
                {sub.sug}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {times.map((time, idx) => (
            <tr key={time} className={`border-b border-gray-100 ${idx % 2 === 1 ? rowAlt : ''}`}>
              <td className="py-2 px-4 text-sm font-bold text-gray-600 whitespace-nowrap">
                {time || 'יומי'}
              </td>
              {subTypes.map(sub => {
                const soldiers = lookup[sub.sug]?.[time] ?? [];
                return (
                  <td key={sub.sug} className="py-2 px-4 text-center">
                    {soldiers.length > 0
                      ? soldiers.map((name, i) => <div key={i}><SoldierName name={name} /></div>)
                      : <span className="text-gray-300 text-sm">—</span>}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Layout tiers ──────────────────────────────────────────────────────────
// small  → half-width box (2 per row): compact stations
// medium → half-width box (2 per row): יומי multi-sub groups (e.g. מגן, נוספים)
// wide   → full-width: complex timed tables (e.g. עמדות הגנה)

const FORCE_SMALL_NAMES = ['חמ"ל', 'חמל', 'חפק', 'רכב', 'סיור'];

// Display order within each tier (first = rightmost in RTL grid)
const SMALL_ORDER = ['סיור', 'רכב', 'חפק', 'חמ"ל', 'חמל'];

type Tier = 'small' | 'medium' | 'wide';

function getTier(group: StationGroup): Tier {
  if (FORCE_SMALL_NAMES.some(k => group.name.includes(k))) return 'small';
  const yomi = isYomiOnly(group.subTypes);
  if (yomi) return 'medium'; // יומי multi-sub → side-by-side pairs
  // timed single sub-type with few time slots → small
  if (group.subTypes.length === 1 && allUniqueTimes(group.subTypes).length <= 4) return 'small';
  return 'wide';
}

function sortByOrder(groups: StationGroup[], order: string[]): StationGroup[] {
  return [...groups].sort((a, b) => {
    const ai = order.findIndex(k => a.name.includes(k));
    const bi = order.findIndex(k => b.name.includes(k));
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });
}

// ── Group card ─────────────────────────────────────────────────────────────
function GroupCard({ group }: { group: StationGroup }) {
  const c = getColors(group.name);
  const totalSoldiers = new Set(
    group.subTypes.flatMap(s => s.times.flatMap(t => t.soldiers))
  ).size;
  const multiType = group.subTypes.length > 1;
  const yomiOnly  = isYomiOnly(group.subTypes);

  return (
    <div className={`rounded-xl border-2 overflow-hidden ${c.border}`}>
      <div className={`px-4 py-2.5 font-bold text-base flex items-center justify-between ${c.header}`}>
        <span>{group.name}</span>
        <span className="font-normal opacity-80 text-sm">{totalSoldiers} חיילים</span>
      </div>
      {yomiOnly ? (
        <YomiGrid subTypes={group.subTypes} bg={c.bg} groupName={group.name} />
      ) : multiType ? (
        <MultiTypeTable subTypes={group.subTypes} bg={c.bg} rowAlt={c.rowAlt} colHeader={c.colHeader} />
      ) : (
        <TransposedTable sub={group.subTypes[0]} bg={c.bg} rowAlt={c.rowAlt} colHeader={c.colHeader} groupName={group.name} />
      )}
    </div>
  );
}

// ── Groups renderer (shared by date view) ─────────────────────────────────
function GroupsView({ dayData }: { dayData: ShavtzakData }) {
  const smallGroups  = sortByOrder(dayData.groups.filter(g => getTier(g) === 'small'), SMALL_ORDER);
  const mediumGroups = dayData.groups.filter(g => getTier(g) === 'medium');
  const wideGroups   = dayData.groups.filter(g => getTier(g) === 'wide');

  return (
    <div className="space-y-3">
      {smallGroups.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-start">
          {smallGroups.map(g => <GroupCard key={g.name} group={g} />)}
        </div>
      )}
      {wideGroups.map(g => <GroupCard key={g.name} group={g} />)}
      {mediumGroups.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-start">
          {mediumGroups.map(g => <GroupCard key={g.name} group={g} />)}
        </div>
      )}
    </div>
  );
}

// ── Main ───────────────────────────────────────────────────────────────────
export function Shavtzak({ soldiers }: { soldiers: Soldier[] }) {
  const { data, loading, error, reload } = useShavtzak();

  const [selectedDate, setSelectedDate] = useState<string>('');
  const [popup, setPopup] = useState<PopupState | null>(null);

  // Once data arrives, default to today (or nearest past date)
  useEffect(() => {
    if (!data?.dates.length) return;
    const today = todayShavtzakStr();
    if (data.dates.includes(today)) {
      setSelectedDate(today);
    } else {
      const past = data.dates.filter(d => d <= today);
      setSelectedDate(past.length ? past[past.length - 1] : data.dates[0]);
    }
  }, [data]);

  const lookup = useMemo(() => {
    const map = new Map<string, SoldierInfo>();
    for (const s of soldiers) {
      if (s.fullName) map.set(s.fullName, { unit: s.unit, role: s.role, phone: s.phone });
    }
    return map;
  }, [soldiers]);

  const handleNameClick = (name: string, info: SoldierInfo | undefined) => {
    setPopup({ name, phone: info?.phone ?? '' });
  };

  if (loading && !data) return (
    <div className="flex items-center justify-center py-24">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
      <span className="mr-3 text-gray-600">טוען שבצק...</span>
    </div>
  );

  if (error) return (
    <div className="rounded-xl bg-red-50 p-6 text-center text-red-700">
      <p className="font-semibold">שגיאה בטעינת שבצק</p>
      <p className="mt-1 text-sm opacity-80">{error}</p>
    </div>
  );

  if (!data?.dates.length) return (
    <div className="rounded-xl border-2 border-dashed border-gray-200 py-16 text-center text-gray-400">
      <p className="text-lg">לא נמצאו נתוני שבצק</p>
    </div>
  );

  const idx     = data.dates.indexOf(selectedDate);
  const canPrev = idx > 0;
  const canNext = idx < data.dates.length - 1;
  const dayData = data.byDate[selectedDate] ?? null;

  const totalDistinct = dayData
    ? new Set(dayData.groups.flatMap(g => g.subTypes.flatMap(s => s.times.flatMap(t => t.soldiers)))).size
    : 0;

  // "DD/MM/YYYY" ↔ "YYYY-MM-DD" for <input type="date">
  const toInputVal  = (d: string) => { const [dd,mm,yyyy] = d.split('/'); return `${yyyy}-${mm}-${dd}`; };
  const fromInputVal = (s: string) => { const [yyyy,mm,dd] = s.split('-'); return `${dd}/${mm}/${yyyy}`; };

  function handlePickerChange(inputVal: string) {
    if (!inputVal || !data) return;
    const picked = fromInputVal(inputVal);
    if (data.dates.includes(picked)) {
      setSelectedDate(picked);
      return;
    }
    // Snap to nearest available date
    const sorted = [...data.dates].sort((a, b) => {
      const diff = (d: string) => Math.abs(new Date(toInputVal(d)).getTime() - new Date(inputVal).getTime());
      return diff(a) - diff(b);
    });
    if (sorted[0]) setSelectedDate(sorted[0]);
  }

  return (
    <SoldierCtx.Provider value={lookup}>
    <NameClickCtx.Provider value={handleNameClick}>
      <div className="space-y-3">
        {/* Header bar */}
        <div className="flex items-center gap-2 flex-wrap" dir="ltr">
          <button
            onClick={() => canPrev && setSelectedDate(data.dates[idx - 1])}
            disabled={!canPrev}
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-700 hover:bg-gray-50 disabled:opacity-30 font-bold text-lg leading-none"
            title="יום קודם"
          >‹</button>

          <input
            type="date"
            value={selectedDate ? toInputVal(selectedDate) : ''}
            min={data.dates[0] ? toInputVal(data.dates[0]) : undefined}
            max={data.dates[data.dates.length - 1] ? toInputVal(data.dates[data.dates.length - 1]) : undefined}
            onChange={e => handlePickerChange(e.target.value)}
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />

          <button
            onClick={() => canNext && setSelectedDate(data.dates[idx + 1])}
            disabled={!canNext}
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-700 hover:bg-gray-50 disabled:opacity-30 font-bold text-lg leading-none"
            title="יום הבא"
          >›</button>

          <span className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-bold text-white">
            {totalDistinct} חיילים
          </span>

          <button
            onClick={reload}
            disabled={loading}
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 flex items-center gap-1.5 ml-auto"
          >
            <span className={loading ? 'animate-spin inline-block' : ''}>↺</span>
            טען מחדש
          </button>
        </div>

        {/* Day content */}
        {dayData ? (
          <GroupsView dayData={dayData} />
        ) : (
          <div className="rounded-xl border-2 border-dashed border-gray-200 py-16 text-center text-gray-400">
            <p className="text-lg">אין נתונים לתאריך זה</p>
          </div>
        )}
      </div>
      {popup && <SoldierPopup info={popup} onClose={() => setPopup(null)} />}
    </NameClickCtx.Provider>
    </SoldierCtx.Provider>
  );
}
