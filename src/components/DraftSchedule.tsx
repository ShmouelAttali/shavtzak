import { useMemo, useState } from 'react';
import type { Soldier } from '../types';
import type { DraftDay, DraftFinding } from '../../api/draft';
import { useDraft } from '../hooks/useDraft';
import { GroupsView, SoldierCtx, NameClickCtx, MyNameCtx, DraftMetaCtx, RationaleClickCtx, SoldierInfo } from './Shavtzak';
import { SoldierPopup, PopupState } from './SoldierPopup';
import { RationalePopup, RationalePopupState } from './RationalePopup';

// ── date helpers (YYYY-MM-DD, local) ────────────────────────────────────────
function todayIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function addDaysIso(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  const pad = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function heDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}
function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to && out.length < 14; d = addDaysIso(d, 1)) out.push(d);
  return out;
}

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  draft: { label: 'טיוטה ריקה', cls: 'bg-gray-100 text-gray-600' },
  generated: { label: 'טיוטה', cls: 'bg-blue-100 text-blue-700' },
  approved: { label: 'מאושר', cls: 'bg-green-100 text-green-700' },
  published: { label: 'פורסם', cls: 'bg-green-200 text-green-800' },
};

function ValidationPanel({ findings }: { findings: DraftFinding[] }) {
  const [open, setOpen] = useState(false);
  const errors = findings.filter((f) => f.severity === 'error');
  const warnings = findings.filter((f) => f.severity === 'warning');
  if (!findings.length) {
    return <div className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">✓ הולידציה עברה ללא הערות</div>;
  }
  return (
    <div className={`rounded-lg border ${errors.length ? 'border-red-200 bg-red-50' : 'border-yellow-200 bg-yellow-50'}`}>
      <button onClick={() => setOpen(!open)} className="w-full px-3 py-2 text-right text-sm font-semibold flex justify-between items-center">
        <span className={errors.length ? 'text-red-700' : 'text-yellow-700'}>
          {errors.length ? `❌ ${errors.length} שגיאות` : ''}{errors.length && warnings.length ? ' · ' : ''}
          {warnings.length ? `⚠ ${warnings.length} אזהרות` : ''}
        </span>
        <span className="text-gray-400">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <ul className="px-4 pb-3 space-y-1 text-sm">
          {errors.map((f, i) => <li key={`e${i}`} className="text-red-700">❌ {f.message}</li>)}
          {warnings.map((f, i) => <li key={`w${i}`} className="text-yellow-700">⚠ {f.message}</li>)}
        </ul>
      )}
    </div>
  );
}

function RestList({ day }: { day: DraftDay }) {
  const [open, setOpen] = useState(false);
  const resting = day.dayAssignments['מנוחה'] ?? [];
  if (!resting.length) return null;
  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      <button onClick={() => setOpen(!open)} className="w-full px-3 py-2 text-right text-sm font-semibold text-gray-600 flex justify-between items-center">
        <span>מנוחה ({resting.length})</span>
        <span className="text-gray-400">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="px-4 pb-3 flex flex-wrap gap-x-3 gap-y-1 text-sm text-gray-700">
          {resting.map((n) => <span key={n}>{n}</span>)}
        </div>
      )}
    </div>
  );
}

function DayViolations({ day }: { day: DraftDay }) {
  const entries = Object.entries(day.meta).filter(([, m]) => m.violations.length);
  if (!entries.length) return null;
  return (
    <div className="rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-sm text-orange-800 space-y-0.5">
      <div className="font-semibold">שיבוצים עם הערות:</div>
      {entries.map(([key, m]) => {
        const [name, time] = key.split('|');
        return <div key={key}>⚠ {name} ({time}): {m.violations.join(' | ')}</div>;
      })}
    </div>
  );
}

function DaySection({ day, onGenerate, generating }: {
  day: DraftDay; onGenerate: (d: string) => void; generating: string | null;
}) {
  const badge = STATUS_BADGE[day.status] ?? STATUS_BADGE.draft;
  const isEmpty = day.groups.length === 0;
  const busy = generating !== null;
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <h2 className="text-lg font-bold text-slate-800">
          {heDate(day.day)} <span className="text-sm font-normal text-gray-500">(14:00 → 14:00 למחרת)</span>
        </h2>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${badge.cls}`}>{badge.label}</span>
        {day.generatedAt && (
          <span className="text-xs text-gray-400">נוצר {new Date(day.generatedAt).toLocaleString('he-IL')}</span>
        )}
        <button
          onClick={() => onGenerate(day.day)}
          disabled={busy}
          className="mr-auto rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 px-3 py-1.5 text-sm font-semibold text-white"
        >
          {generating === day.day ? '⏳ מחולל...' : isEmpty ? 'צור שבצ"ק' : 'חולל מחדש'}
        </button>
      </div>
      {!isEmpty && <ValidationPanel findings={day.validation} />}
      {!isEmpty && <DayViolations day={day} />}
      {isEmpty ? (
        <div className="rounded-xl border-2 border-dashed border-gray-200 py-12 text-center text-gray-400">
          אין טיוטה ליום זה — לחץ "צור שבצ"ק"
        </div>
      ) : (
        <>
          <DraftMetaCtx.Provider value={day.meta}>
            <GroupsView dayData={{ date: day.day, groups: day.groups }} />
          </DraftMetaCtx.Provider>
          <RestList day={day} />
        </>
      )}
    </section>
  );
}

// ── Main ────────────────────────────────────────────────────────────────────
export function DraftSchedule({ soldiers, mySoldierName = '' }: {
  soldiers: Soldier[]; mySoldierName?: string;
}) {
  const [from, setFrom] = useState(todayIso());
  const [multiDay, setMultiDay] = useState(false);
  const [to, setTo] = useState(todayIso());
  const [popup, setPopup] = useState<PopupState | null>(null);
  const [rationalePopup, setRationalePopup] = useState<RationalePopupState | null>(null);
  const effectiveTo = multiDay && to >= from ? to : from;
  const { data, loading, error, generating, generateRange } = useDraft(from, effectiveTo);

  const lookup = useMemo(() => {
    const map = new Map<string, SoldierInfo>();
    for (const s of soldiers) {
      if (s.fullName) map.set(s.fullName, { unit: s.unit, role: s.role, phone: s.phone });
    }
    return map;
  }, [soldiers]);

  const handleNameClick = (name: string, info: SoldierInfo | undefined) =>
    setPopup({ name, phone: info?.phone ?? '' });

  const days = daysBetween(from, effectiveTo);
  const generateAll = () => {
    const existing = data?.days.some((d) => d.groups.length > 0);
    if (existing && !window.confirm('קיימת כבר טיוטה בטווח — לחולל מחדש? שיבוצים נעולים/ידניים יישמרו.')) return;
    void generateRange(days);
  };
  const generateOne = (day: string) => {
    const d = data?.days.find((x) => x.day === day);
    if (d && d.groups.length > 0 && !window.confirm(`לחולל מחדש את ${heDate(day)}? שיבוצים נעולים/ידניים יישמרו.`)) return;
    void generateRange([day]);
  };

  return (
    <SoldierCtx.Provider value={lookup}>
      <NameClickCtx.Provider value={handleNameClick}>
        <MyNameCtx.Provider value={mySoldierName}>
        <RationaleClickCtx.Provider value={(name, time, meta) => setRationalePopup({ name, time, meta })}>
          <div className="space-y-5">
            {/* Controls */}
            <div className="flex items-center gap-2 flex-wrap" dir="ltr">
              <button onClick={() => { setFrom(addDaysIso(from, -1)); if (!multiDay) setTo(addDaysIso(from, -1)); }}
                className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-700 hover:bg-gray-50 font-bold text-lg leading-none">‹</button>
              <input type="date" value={from}
                onChange={(e) => { setFrom(e.target.value); if (!multiDay) setTo(e.target.value); }}
                className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800 shadow-sm focus:border-blue-500 focus:outline-none" />
              {multiDay && (
                <>
                  <span className="text-sm text-gray-500" dir="rtl">עד</span>
                  <input type="date" value={effectiveTo} min={from}
                    onChange={(e) => setTo(e.target.value)}
                    className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800 shadow-sm focus:border-blue-500 focus:outline-none" />
                </>
              )}
              <button onClick={() => { setFrom(addDaysIso(from, 1)); if (!multiDay) setTo(addDaysIso(from, 1)); }}
                className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-700 hover:bg-gray-50 font-bold text-lg leading-none">›</button>
              <label className="flex items-center gap-1.5 text-sm text-gray-600 select-none" dir="rtl">
                <input type="checkbox" checked={multiDay} onChange={(e) => { setMultiDay(e.target.checked); if (!e.target.checked) setTo(from); }} />
                מספר ימים
              </label>
              {days.length > 1 && (
                <button onClick={generateAll} disabled={generating !== null}
                  className="rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 px-4 py-2 text-sm font-semibold text-white" dir="rtl">
                  {generating ? `⏳ מחולל ${heDate(generating)}...` : `צור שבצ"ק לכל הטווח (${days.length} ימים)`}
                </button>
              )}
              {loading && <span className="text-sm text-gray-400"><span className="animate-spin inline-block">↺</span></span>}
            </div>

            {error && (
              <div className="rounded-xl bg-red-50 p-4 text-center text-red-700 text-sm">{error}</div>
            )}

            {/* Days */}
            {days.map((day) => {
              const d = data?.days.find((x) => x.day === day)
                ?? { day, status: 'draft', generatedAt: null, validation: [], groups: [], meta: {}, dayAssignments: {} };
              return <DaySection key={day} day={d} onGenerate={generateOne} generating={generating} />;
            })}
          </div>
          {popup && <SoldierPopup info={popup} onClose={() => setPopup(null)} />}
          {rationalePopup && <RationalePopup info={rationalePopup} onClose={() => setRationalePopup(null)} />}
        </RationaleClickCtx.Provider>
        </MyNameCtx.Provider>
      </NameClickCtx.Provider>
    </SoldierCtx.Provider>
  );
}
