import { useState } from 'react';
import { FROM_TIMES, TO_TIMES } from '../../api/exit-requests';
import { useExitRequests } from '../hooks/useExitRequests';

// ── date helpers (YYYY-MM-DD, local) ────────────────────────────────────────
function todayIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function heDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

// Offsets in hours from the 14:00 schedule-day start.
const START_OFFSET: Record<string, number> = {
  '14:00': 0, '18:00': 4, '22:00': 8, '02:00': 12, '06:00': 16,
};
const fromOffset = (t: string) => START_OFFSET[t] ?? 0;
// As a return time, 14:00 means the end of the schedule day (next day 14:00).
const toOffset = (t: string) => (t === '14:00' ? 24 : START_OFFSET[t] ?? 0);
// Offsets ≥ 12 fall past midnight — on the next calendar day.
const timeLabel = (t: string, offset: number) => (offset >= 12 ? `${t} (למחרת)` : t);

export function ExitRequests({ soldierName, email }: { soldierName: string; email: string }) {
  const { requests, loading, error, add, remove } = useExitRequests(soldierName, email);
  const [day, setDay] = useState(todayIso());
  const [from, setFrom] = useState<string>(FROM_TIMES[0]);
  const [to, setTo] = useState<string>(TO_TIMES[0]);
  const [note, setNote] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [rowErrors, setRowErrors] = useState<Record<number, string>>({});
  const [removing, setRemoving] = useState<number | null>(null);

  if (!soldierName) {
    return (
      <div className="rounded-xl bg-white p-8 shadow-sm text-center text-gray-600">
        החשבון אינו מקושר לחייל במצבת — פנה לאחראי המערכת
      </div>
    );
  }

  const validTos: string[] = TO_TIMES.filter((t: string) => toOffset(t) > fromOffset(from));
  const effectiveTo = validTos.includes(to) ? to : validTos[0];
  const hoursOut = toOffset(effectiveTo) - fromOffset(from);
  const hoursLeft = 24 - hoursOut;
  const tooLong = hoursOut > 16;

  const onFromChange = (v: string) => {
    setFrom(v);
    const stillValid: string[] = TO_TIMES.filter((t: string) => toOffset(t) > fromOffset(v));
    if (!stillValid.includes(to)) setTo(stillValid[0]);
  };

  const submit = async () => {
    setFormError(null);
    setSubmitting(true);
    const err = await add(day, from, effectiveTo, note);
    setSubmitting(false);
    if (err) { setFormError(err); return; }
    setNote('');
  };

  const cancel = async (id: number) => {
    setRowErrors((prev) => { const { [id]: _, ...rest } = prev; return rest; });
    setRemoving(id);
    const err = await remove(id);
    setRemoving(null);
    if (err) setRowErrors((prev) => ({ ...prev, [id]: err }));
  };

  return (
    <div className="space-y-5" dir="rtl">
      {/* Request form */}
      <section className="rounded-xl bg-white p-5 shadow-sm space-y-4">
        <h2 className="text-lg font-bold text-slate-800">בקשת יציאה קצרה</h2>
        <div className="flex flex-wrap items-end gap-4">
          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-600">יממת שיבוץ</label>
            <input
              type="date"
              value={day}
              onChange={(e) => e.target.value && setDay(e.target.value)}
              className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800 shadow-sm focus:border-blue-500 focus:outline-none"
            />
          </div>
          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-600">יציאה מ־</label>
            <select
              value={from}
              onChange={(e) => onFromChange(e.target.value)}
              className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800 shadow-sm focus:border-blue-500 focus:outline-none"
            >
              {FROM_TIMES.map((t: string) => (
                <option key={t} value={t}>{timeLabel(t, fromOffset(t))}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-600">חזרה עד</label>
            <select
              value={effectiveTo}
              onChange={(e) => setTo(e.target.value)}
              className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800 shadow-sm focus:border-blue-500 focus:outline-none"
            >
              {validTos.map((t: string) => (
                <option key={t} value={t}>{timeLabel(t, toOffset(t))}</option>
              ))}
            </select>
          </div>
          <div className="flex-1 min-w-[12rem] space-y-1">
            <label className="block text-sm font-medium text-gray-600">הערה (לא חובה)</label>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="סיבת היציאה..."
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm focus:border-blue-500 focus:outline-none"
            />
          </div>
        </div>
        <div className="text-xs text-gray-400">יממת שיבוץ מתחילה ב-14:00 ומסתיימת ב-14:00 למחרת</div>
        <div className="text-sm text-gray-700">
          סה"כ {hoursOut} שעות מחוץ לבסיס, נשארות {hoursLeft} שעות זמינות ביממה
        </div>
        {tooLong && (
          <div className="rounded-lg bg-yellow-50 px-3 py-2 text-sm text-yellow-700">
            יציאה ארוכה מ-16 שעות — יש להגיש יום חופש
          </div>
        )}
        {formError && (
          <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{formError}</div>
        )}
        <button
          onClick={() => void submit()}
          disabled={submitting || tooLong}
          className="rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 px-4 py-2 text-sm font-semibold text-white"
        >
          {submitting ? '⏳ שולח...' : 'הגש בקשה'}
        </button>
      </section>

      {/* My requests */}
      <section className="rounded-xl bg-white p-5 shadow-sm space-y-3">
        <h2 className="text-lg font-bold text-slate-800">הבקשות שלי</h2>
        {loading && (
          <div className="text-sm text-gray-400"><span className="animate-spin inline-block">↺</span> טוען...</div>
        )}
        {error && (
          <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
        )}
        {!loading && !error && requests.length === 0 && (
          <div className="rounded-xl border-2 border-dashed border-gray-200 py-8 text-center text-gray-400">
            אין בקשות יציאה קרובות
          </div>
        )}
        <ul className="divide-y divide-gray-100">
          {requests.map((r) => (
            <li key={r.id} className="py-3 flex flex-wrap items-center gap-x-4 gap-y-1">
              <span className="font-semibold text-slate-800">{heDate(r.day)}</span>
              <span className="text-sm text-gray-600" dir="ltr">
                {r.start.slice(11)} → {r.end.slice(11)}
              </span>
              {r.note && <span className="text-sm text-gray-500">{r.note}</span>}
              <button
                onClick={() => void cancel(r.id)}
                disabled={removing === r.id}
                className="mr-auto rounded-lg border border-red-200 bg-red-50 hover:bg-red-100 disabled:opacity-50 px-3 py-1 text-sm font-medium text-red-700"
              >
                {removing === r.id ? '⏳' : 'ביטול'}
              </button>
              {rowErrors[r.id] && (
                <span className="w-full text-sm text-red-700">{rowErrors[r.id]}</span>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
