import { useMemo, useState } from 'react';
import type { ComplianceFinding, FairnessRow, SpreadStat } from '../../api/_handlers/fairness';
import { useFairness } from '../hooks/useFairness';

function todayIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const pad = (n: number) => String(n).padStart(2, '0');
const isoOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const heDate = (iso: string) => { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; };
const heDay = (iso: string) => { const [, m, d] = iso.split('-'); return `${d}/${m}`; };

/** Fairness weeks are Sunday-anchored: window END = next-or-same Sunday of the
 *  picked date (on a Sunday the window ends today — the completed week). */
function sundayEnd(dateIso: string): string {
  const d = new Date(`${dateIso}T12:00:00`);
  d.setDate(d.getDate() + ((7 - d.getDay()) % 7));   // Sunday = 0
  return isoOf(d);
}

/** [end-7 יום א' 14:00, end יום א' 14:00) */
function windowLabel(endIso: string): string {
  const start = new Date(`${endIso}T12:00:00`);
  start.setDate(start.getDate() - 7);
  return `יום א' ${heDate(isoOf(start))} 14:00 ← יום א' ${heDate(endIso)} 14:00`;
}

// ── Rule cards: one card per SPEC criterion, exceptions-only ────────────────
interface CardDef { rules: string[]; title: string; subtitle: string }

const CARD_DEFS: CardDef[] = [
  { rules: ['rest'], title: 'מנוחה בין משימות',
    subtitle: 'פער בין משימות עוקבות: פחות מ-4 שעות = הפרה, 4–8 שעות = אזהרה (R1)' },
  { rules: ['daily_cap'], title: 'תקרת שעות יומית',
    subtitle: 'עד 8 שעות משימה ביום 14:00→14:00; שעות כוננות אינן נספרות (R4)' },
  { rules: ['consecutive_nights'], title: 'לילות רצופים',
    subtitle: 'לילה = משמרת החופפת 00:00–06:00; שני לילות ברצף = אזהרה, שלושה ומעלה = הפרה (R6)' },
  { rules: ['static_streak'], title: 'רצף ימי עמדה',
    subtitle: 'אחרי יומיים סטטיים רצופים נדרש יום דינמי; יום עמדה שלישי ברצף = אזהרה (T3)' },
  { rules: ['availability'], title: 'זמינות',
    subtitle: 'אין שיבוץ בזמן אי-זמינות — חופש, יציאה או לא מגויס (H1)' },
  { rules: ['overlap', 'double_readiness'], title: 'כפילויות',
    subtitle: 'אין חפיפה בין משימות ואין שתי כוננויות במקביל (H3)' },
  { rules: ['chain', 'carmel_staffing'], title: 'שרשור כרמל/גשש',
    subtitle: 'צוות כרמל/גשש מאויש מהצוות שירד מהמשימה הממופה; איוש כרמל 3+1 (T4)' },
  { rules: ['seat_rules'], title: 'מושבים ייעודיים',
    subtitle: 'מושבי חפ"ק מאוישים אך ורק מרשימת המועמדים הייעודית שלהם (H6b)' },
  { rules: ['allowed_positions', 'unknown_soldier'], title: 'הגבלות שיבוץ',
    subtitle: 'חייל מוגבל-עמדות משובץ רק בעמדותיו; אין שיבוץ למי שאינו לשיבוץ (H6c/H2)' },
  { rules: ['coverage'], title: 'איוש עמדות',
    subtitle: 'כל מושב בכל משמרת מאויש במלואו — אין מושבים ריקים' },
  { rules: ['unassigned'], title: 'כיסוי שיבוץ',
    subtitle: 'כל חייל זמין מקבל שיבוץ יומי (משימה או מנוחה)' },
];

const SHOW_LIMIT = 5;

function RuleCard({ def, findings, noData }: { def: CardDef; findings: ComplianceFinding[]; noData: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const errors = findings.filter((f) => f.severity === 'error');
  const warnings = findings.filter((f) => f.severity === 'warning');
  const sorted = [...errors, ...warnings];
  const shown = expanded ? sorted : sorted.slice(0, SHOW_LIMIT);

  const tone = noData ? 'border-gray-200'
    : errors.length ? 'border-red-200' : warnings.length ? 'border-amber-200' : 'border-green-200';

  return (
    <div className={`rounded-xl border ${tone} bg-white p-4`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-semibold text-slate-800">{def.title}</div>
          <div className="mt-0.5 text-xs text-gray-500">{def.subtitle}</div>
        </div>
        {noData ? (
          <span className="shrink-0 rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-semibold text-gray-500">אין נתונים</span>
        ) : !sorted.length ? (
          <span className="shrink-0 rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-semibold text-green-700">✓ תקין</span>
        ) : (
          <span className="flex shrink-0 gap-1">
            {errors.length > 0 && (
              <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-700">{errors.length} הפרות</span>
            )}
            {warnings.length > 0 && (
              <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-700">{warnings.length} אזהרות</span>
            )}
          </span>
        )}
      </div>
      {shown.length > 0 && (
        <ul className="mt-3 space-y-1 border-t border-gray-100 pt-2">
          {shown.map((f, i) => (
            <li key={i} className="flex items-baseline gap-2 text-xs">
              <span className={`mt-0.5 inline-block h-2 w-2 shrink-0 self-center rounded-full ${f.severity === 'error' ? 'bg-red-500' : 'bg-amber-400'}`} />
              <span className="text-slate-700">{f.message}</span>
              <span className="mr-auto whitespace-nowrap text-gray-400">{heDay(f.day)}</span>
            </li>
          ))}
        </ul>
      )}
      {sorted.length > SHOW_LIMIT && (
        <button onClick={() => setExpanded((e) => !e)}
          className="mt-2 text-xs font-semibold text-blue-600 hover:underline">
          {expanded ? 'הצג פחות ▲' : `עוד ${sorted.length - SHOW_LIMIT}… ▼`}
        </button>
      )}
    </div>
  );
}

// ── Fairness (load-balance) cards ───────────────────────────────────────────
function SpreadCard({ title, subtitle, s, rows, value, unit }: {
  title: string; subtitle: string; s: SpreadStat; rows: FairnessRow[];
  value: (r: FairnessRow) => number; unit: string;
}) {
  const active = rows.filter((r) => r.weightedHours7d > 0 || r.nightCount7d > 0);
  const sorted = [...active].sort((a, b) => value(b) - value(a));
  const top = sorted.slice(0, 3).filter((r) => value(r) > 0);
  const bottom = sorted.slice(-3).reverse().filter((r) => !top.includes(r));
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="font-semibold text-slate-800">{title}</div>
      <div className="mt-0.5 text-xs text-gray-500">{subtitle}</div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-2xl font-bold text-slate-800">{s.avg}</span>
        <span className="text-xs text-gray-500">ממוצע · טווח {s.min}–{s.max} · סטיית תקן {s.stddev}</span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 border-t border-gray-100 pt-2 text-xs">
        <div>
          <div className="mb-1 font-semibold text-red-700">העמוסים ביותר</div>
          {top.map((r) => (
            <div key={r.soldierId} className="flex justify-between gap-2">
              <span className="truncate text-slate-700">{r.name}</span>
              <span className="text-gray-500">{value(r)}{unit}</span>
            </div>
          ))}
          {!top.length && <div className="text-gray-400">—</div>}
        </div>
        <div>
          <div className="mb-1 font-semibold text-green-700">הפנויים ביותר</div>
          {bottom.map((r) => (
            <div key={r.soldierId} className="flex justify-between gap-2">
              <span className="truncate text-slate-700">{r.name}</span>
              <span className="text-gray-500">{value(r)}{unit}</span>
            </div>
          ))}
          {!bottom.length && <div className="text-gray-400">—</div>}
        </div>
      </div>
    </div>
  );
}

// normalized names of dedicated positions; a soldier serving ONLY in these
// (e.g. seat-rule/whitelist people) is excluded from the rotation-balance stats
const DEDICATED_POSITIONS = new Set(['חפק', 'חמל', 'קצין מוצב']);
const nrmPos = (s: string) => s.replace(/[״"׳']/g, '').trim();

function PositionBalanceCard({ rows }: { rows: FairnessRow[] }) {
  const positions = useMemo(() => {
    const byPos = new Map<string, { name: string; n: number }[]>();
    for (const r of rows) {
      const counted = Object.entries(r.positionCounts).filter(([pos, n]) => pos !== 'מנוחה' && n > 0);
      if (counted.length && counted.every(([pos]) => DEDICATED_POSITIONS.has(nrmPos(pos)))) continue;
      for (const [pos, n] of counted) {
        (byPos.get(pos) ?? byPos.set(pos, []).get(pos)!).push({ name: r.name, n });
      }
    }
    return [...byPos.entries()]
      .map(([pos, list]) => {
        const max = list.reduce((a, b) => (b.n > a.n ? b : a));
        const avg = list.reduce((a, b) => a + b.n, 0) / list.length;
        return { pos, soldiers: list.length, avg: Math.round(avg * 10) / 10, max };
      })
      .sort((a, b) => b.max.n - a.max.n)
      .slice(0, 8);
  }, [rows]);

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="font-semibold text-slate-800">איזון עמדות</div>
      <div className="mt-0.5 text-xs text-gray-500">
        פיזור מספר השיבוצים לעמדה (מצטבר) — מי חוזר לאותה עמדה הרבה מעבר לממוצע.
        חיילים המשובצים רק לעמדות ייעודיות (חפ"ק/חמ"ל/קצין מוצב) אינם נספרים
      </div>
      <table className="mt-3 w-full border-t border-gray-100 pt-2 text-xs">
        <thead>
          <tr className="text-right text-gray-500">
            <th className="py-1 font-semibold">עמדה</th>
            <th className="py-1 font-semibold">חיילים</th>
            <th className="py-1 font-semibold">ממוצע</th>
            <th className="py-1 font-semibold">שיא</th>
          </tr>
        </thead>
        <tbody>
          {positions.map((p) => (
            <tr key={p.pos} className="border-t border-gray-50">
              <td className="py-1 font-medium text-slate-700">{p.pos}</td>
              <td className="py-1 text-gray-500">{p.soldiers}</td>
              <td className="py-1 text-gray-500">{p.avg}</td>
              <td className={`py-1 ${p.max.n > p.avg * 2 ? 'font-semibold text-red-700' : 'text-gray-500'}`}>
                {p.max.name} ×{p.max.n}
              </td>
            </tr>
          ))}
          {!positions.length && <tr><td className="py-1 text-gray-400">אין נתונים</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

export function FairnessView() {
  const [date, setDate] = useState(todayIso());
  // Default OFF: the baseline picture is the real, already-scheduled (published)
  // work. Turning it on factors drafts in, a day's draft superseding its
  // published rows so nothing is counted twice.
  const [includeDrafts, setIncludeDrafts] = useState(false);
  const windowEnd = sundayEnd(date);
  const { data, loading, error } = useFairness(windowEnd, includeDrafts);
  const [platoons, setPlatoons] = useState<Set<string>>(new Set());

  const allPlatoons = useMemo(
    () => [...new Set((data?.rows ?? []).map((r) => r.platoon))].sort((a, b) => a.localeCompare(b, 'he')),
    [data]);

  const rows = useMemo(() => {
    const out = data?.rows ?? [];
    return platoons.size ? out.filter((r) => platoons.has(r.platoon)) : out;
  }, [data, platoons]);

  // findings filtered by platoon (soldier-less findings always pass)
  const findings = useMemo(() => {
    const all = data?.compliance ?? [];
    if (!platoons.size) return all;
    const platoonOf = new Map((data?.rows ?? []).map((r) => [r.soldierId, r.platoon]));
    return all.filter((f) => f.soldierId == null || platoons.has(platoonOf.get(f.soldierId) ?? ''));
  }, [data, platoons]);

  const noData = (data?.checkedDays ?? []).length === 0;
  const totalErr = findings.filter((f) => f.severity === 'error').length;
  const totalWarn = findings.length - totalErr;

  return (
    <div className="space-y-4" dir="rtl">
      {/* Controls */}
      <div className="flex items-center gap-3 flex-wrap">
        <label className="flex items-center gap-2 text-sm text-gray-600">
          שבוע (א'–א') המכיל את:
          <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)}
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800 shadow-sm focus:border-blue-500 focus:outline-none" />
        </label>
        <span className="rounded-lg bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-700" dir="rtl">
          חלון נבדק: {windowLabel(windowEnd)}
        </span>
        <label
          className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm cursor-pointer select-none"
          title="כברירת מחדל נספר רק מה שכבר פורסם. בהפעלה נכללות גם הטיוטות — ביום שיש לו טיוטה, הטיוטה מחליפה את מה שפורסם (ואינה נספרת בנוסף)."
        >
          <input type="checkbox" checked={includeDrafts}
            onChange={(e) => setIncludeDrafts(e.target.checked)} />
          כלול טיוטות
        </label>
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
        {loading && <span className="animate-spin inline-block text-gray-400">↺</span>}
      </div>

      {error && <div className="rounded-xl bg-red-50 p-4 text-center text-red-700 text-sm">{error}</div>}

      {data && (
        <>
          {/* Summary strip */}
          {noData ? (
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-center text-sm font-semibold text-gray-500">
              לא נמצאו ימים משובצים בחלון הנבדק
            </div>
          ) : totalErr + totalWarn === 0 ? (
            <div className="rounded-xl border border-green-200 bg-green-50 p-4 text-center text-sm font-semibold text-green-800">
              ✓ כל כללי השיבוץ מתקיימים ({data.checkedDays.length} ימים נבדקו)
            </div>
          ) : (
            <div className={`rounded-xl border p-4 text-center text-sm font-semibold ${totalErr ? 'border-red-200 bg-red-50 text-red-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
              {totalErr > 0 && <>❌ {totalErr} הפרות</>}
              {totalErr > 0 && totalWarn > 0 && ' · '}
              {totalWarn > 0 && <>⚠️ {totalWarn} אזהרות</>}
              <span className="font-normal text-gray-500"> · {data.checkedDays.length} ימים נבדקו</span>
            </div>
          )}

          {/* Rule cards */}
          <h2 className="pt-1 text-sm font-bold text-slate-700">עמידה בכללי השיבוץ</h2>
          <div className="grid gap-3 md:grid-cols-2">
            {CARD_DEFS.map((def) => (
              <RuleCard key={def.title} def={def} noData={noData}
                findings={findings.filter((f) => def.rules.includes(f.rule))} />
            ))}
          </div>

          {/* Fairness cards */}
          <h2 className="pt-2 text-sm font-bold text-slate-700">איזון עומסים</h2>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <SpreadCard title="לילות (7 ימים)" subtitle="מספר משמרות לילה בחלון הנבדק — יעד: פיזור אחיד"
              s={data.spread.nights} rows={rows} value={(r) => r.nightCount7d} unit="" />
            <SpreadCard title="שעות משוקללות (7 ימים)" subtitle="שעות משימה + כוננות ×0.25 — יעד: פיזור אחיד"
              s={data.spread.weightedHours} rows={rows} value={(r) => r.weightedHours7d} unit="ש׳" />
            <PositionBalanceCard rows={rows} />
          </div>
        </>
      )}
    </div>
  );
}
