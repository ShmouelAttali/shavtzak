import { useState } from 'react';
import { FROM_TIMES, TO_TIMES } from '../constants/exitRequests';
import { useExitRequests } from '../hooks/useExitRequests';
import { ExitWindowPicker, ExitWindowSummary, windowInfo, todayIso, heDate } from './ExitWindowPicker';

export function ExitRequests({ soldierName, email }: { soldierName: string; email: string }) {
  const { requests, loading, error, add, remove } = useExitRequests(soldierName, email);
  const [fromDate, setFromDate] = useState(todayIso());
  const [toDate, setToDate] = useState(todayIso());
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

  const { invalid, tooLong } = windowInfo(fromDate, from, toDate, to);

  const submit = async () => {
    setFormError(null);
    setSubmitting(true);
    const err = await add(fromDate, from, toDate, to, note);
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
          <ExitWindowPicker
            fromDate={fromDate} from={from} toDate={toDate} to={to}
            onFromDate={setFromDate}
            onFrom={setFrom}
            onToDate={setToDate}
            onTo={setTo}
          />
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
        <ExitWindowSummary fromDate={fromDate} from={from} toDate={toDate} to={to} />
        {formError && (
          <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{formError}</div>
        )}
        <button
          onClick={() => void submit()}
          disabled={submitting || tooLong || invalid}
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
                {r.end.slice(0, 10) !== r.start.slice(0, 10) && (
                  <span className="text-xs text-gray-400"> ({heDate(r.end.slice(0, 10))})</span>
                )}
              </span>
              {r.note && <span className="text-sm text-gray-500">{r.note}</span>}
              <button
                onClick={() => void cancel(r.id)}
                disabled={removing === r.id || r.generated}
                title={r.generated ? 'השבצ"ק כבר נוצר — פנה לאחראי' : undefined}
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
