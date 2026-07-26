import { useMemo, useState } from 'react';
import type { Soldier } from '../types';
import type { ExitRequest } from '../../api/_handlers/exit-requests';
import { FROM_TIMES, TO_TIMES } from '../constants/exitRequests';
import { useAdminExitRequests } from '../hooks/useExitRequests';
import { DateRangePicker, todayIso, addDaysIso, heDate } from './DateRangePicker';
import { ExitWindowPicker, ExitWindowSummary, windowInfo, windowTimestamps } from './ExitWindowPicker';

const inputCls = 'rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800 shadow-sm focus:border-blue-500 focus:outline-none';

const hm = (ts: string) => ts.slice(11); // 'YYYY-MM-DD HH:MM' → 'HH:MM'
const dateOf = (ts: string) => ts.slice(0, 10);

function TimeRange({ r }: { r: ExitRequest }) {
  const startDate = dateOf(r.start);
  const endDate = dateOf(r.end);
  const nextDay = endDate === addDaysIso(startDate, 1);
  return (
    <span className="whitespace-nowrap">
      <span dir="ltr">{hm(r.start)} → {hm(r.end)}</span>
      {endDate !== startDate && (
        <span className="text-xs text-gray-500"> {nextDay ? '(למחרת)' : `(${heDate(endDate)})`}</span>
      )}
    </span>
  );
}

interface FormState {
  id: number | null; // null = add mode, otherwise the edited request id
  name: string;
  fromDate: string;  // literal calendar date the exit starts on
  toDate: string;    // literal calendar date the exit returns on
  from: string;      // shift-boundary times, same options as the soldier tab
  to: string;
  note: string;
  /** original 'HH:MM → HH:MM' when the edited row's times are not on shift
   *  boundaries (legacy/imported rows) — saving snaps them to the selection */
  origTimes: string | null;
}

const emptyForm = (): FormState => ({
  id: null, name: '', fromDate: todayIso(), toDate: todayIso(),
  from: FROM_TIMES[1], to: TO_TIMES[1], note: '',
  origTimes: null,
});

export function AdminExits({ soldiers, email }: { soldiers: Soldier[]; email: string }) {
  const [from, setFrom] = useState(todayIso());
  const [to, setTo] = useState(addDaysIso(todayIso(), 7));
  const { requests, loading, error, save, removeForce } = useAdminExitRequests(from, to);

  const [form, setForm] = useState<FormState>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ success?: string; warning?: string; error?: string } | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);

  const names = useMemo(
    () => Array.from(new Set(soldiers.map((s) => s.fullName).filter(Boolean)))
      .sort((a, b) => a.localeCompare(b, 'he')),
    [soldiers]);

  const editing = form.id !== null;
  const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));

  const startAdd = () => { setForm(emptyForm()); setFormError(null); };
  const startEdit = (r: ExitRequest) => {
    // snap the row onto the boundary options; legacy/imported rows may carry
    // free times — keep them visible so saving doesn't silently change them
    const startHM = hm(r.start), endHM = hm(r.end);
    const from = (FROM_TIMES as readonly string[]).includes(startHM) ? startHM : FROM_TIMES[0];
    const to = (TO_TIMES as readonly string[]).includes(endHM) ? endHM : TO_TIMES[TO_TIMES.length - 1];
    const onBoundary = (FROM_TIMES as readonly string[]).includes(startHM)
      && (TO_TIMES as readonly string[]).includes(endHM);
    setForm({
      id: r.id, name: r.soldierName,
      fromDate: dateOf(r.start), toDate: dateOf(r.end), from, to,
      note: r.note ?? '',
      origTimes: onBoundary ? null : `${startHM} → ${endHM}`,
    });
    setFormError(null);
    setFlash(null);
  };

  const submit = async () => {
    const { start, end } = windowTimestamps(form.fromDate, form.from, form.toDate, form.to);
    if (!editing && !form.name) { setFormError('יש לבחור חייל'); return; }
    if (!editing && !names.includes(form.name)) {
      setFormError('החייל לא נמצא במצבת — יש לבחור שם מהרשימה'); return;
    }
    if (!form.fromDate || !form.toDate) { setFormError('יש לבחור תאריכי יציאה וחזרה'); return; }
    if (windowInfo(form.fromDate, form.from, form.toDate, form.to).invalid) {
      setFormError('זמן החזרה חייב להיות אחרי זמן היציאה'); return;
    }
    setFormError(null);
    setFlash(null);
    setSaving(true);
    const res = await save({
      id: form.id ?? undefined, name: form.name, start, end,
      note: form.note.trim() || undefined, email,
    });
    setSaving(false);
    if (res.error) { setFormError(res.error); return; }
    setFlash({ success: editing ? 'הבקשה עודכנה בהצלחה' : 'הבקשה נוספה בהצלחה', warning: res.warning });
    setForm(emptyForm());
  };

  const del = async (r: ExitRequest) => {
    if (!window.confirm(`למחוק את בקשת היציאה של ${r.soldierName} ביממת ${heDate(r.day)}?`)) return;
    setFlash(null);
    setDeleting(r.id);
    const res = await removeForce(r.id);
    setDeleting(null);
    if (res.error) setFlash({ error: res.error });
    else setFlash({ success: 'הבקשה נמחקה', warning: res.warning });
    if (form.id === r.id) setForm(emptyForm());
  };

  return (
    <div className="space-y-5" dir="rtl">
      {/* Add / edit form */}
      <section className="rounded-xl bg-white p-5 shadow-sm space-y-4">
        <h2 className="text-lg font-bold text-slate-800">
          {editing ? `עריכת בקשת יציאה — ${form.name}` : 'הוספת בקשת יציאה'}
        </h2>
        <div className="flex flex-wrap items-end gap-4">
          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-600">חייל</label>
            <input
              list="admin-exits-soldiers"
              value={form.name}
              onChange={(e) => set({ name: e.target.value })}
              disabled={editing}
              placeholder="הקלד או בחר חייל..."
              className={`${inputCls} disabled:bg-gray-50 disabled:text-gray-500 min-w-[11rem]`}
            />
            <datalist id="admin-exits-soldiers">
              {names.map((n) => <option key={n} value={n} />)}
            </datalist>
          </div>
          <ExitWindowPicker
            fromDate={form.fromDate} from={form.from} toDate={form.toDate} to={form.to}
            onFromDate={(d) => set({ fromDate: d })}
            onFrom={(f) => set({ from: f })}
            onToDate={(d) => set({ toDate: d })}
            onTo={(t) => set({ to: t })}
          />
          <div className="flex-1 min-w-[12rem] space-y-1">
            <label className="block text-sm font-medium text-gray-600">הערה (לא חובה)</label>
            <input
              type="text"
              value={form.note}
              onChange={(e) => set({ note: e.target.value })}
              placeholder="סיבת היציאה..."
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm focus:border-blue-500 focus:outline-none"
            />
          </div>
        </div>
        <ExitWindowSummary fromDate={form.fromDate} from={form.from} toDate={form.toDate} to={form.to} />
        {form.origTimes && (
          <div className="rounded-lg bg-yellow-50 px-3 py-2 text-sm text-yellow-700">
            השעות המקוריות של הבקשה ({form.origTimes}) אינן על גבולות משמרת — שמירה תעדכן אותן לשעות שנבחרו
          </div>
        )}
        {formError && (
          <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{formError}</div>
        )}
        <div className="flex items-center gap-3">
          <button
            onClick={() => void submit()}
            disabled={saving || windowInfo(form.fromDate, form.from, form.toDate, form.to).tooLong || windowInfo(form.fromDate, form.from, form.toDate, form.to).invalid}
            className="rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 px-4 py-2 text-sm font-semibold text-white"
          >
            {saving ? '⏳ שומר...' : editing ? 'שמור שינויים' : 'הוסף בקשה'}
          </button>
          {editing && (
            <button
              onClick={startAdd}
              disabled={saving}
              className="rounded-lg border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-50 px-4 py-2 text-sm font-medium text-gray-600"
            >
              בטל עריכה
            </button>
          )}
        </div>
      </section>

      {/* Flash notices (kept outside the form so delete results show too) */}
      {flash?.error && (
        <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{flash.error}</div>
      )}
      {flash?.success && (
        <div className="rounded-xl bg-green-50 px-4 py-3 text-sm text-green-700">✓ {flash.success}</div>
      )}
      {flash?.warning && (
        <div className="rounded-xl border border-yellow-300 bg-yellow-50 px-4 py-3 text-sm font-semibold text-yellow-800">
          ⚠ {flash.warning}
        </div>
      )}

      {/* Requests in range */}
      <section className="rounded-xl bg-white p-5 shadow-sm space-y-3">
        <h2 className="text-lg font-bold text-slate-800">בקשות יציאה בטווח</h2>
        <DateRangePicker from={from} to={to} setFrom={setFrom} setTo={setTo} multiDay={true}>
          {loading && <span className="text-sm text-gray-400"><span className="animate-spin inline-block">↺</span></span>}
        </DateRangePicker>
        {error && (
          <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
        )}
        {!loading && !error && requests.length === 0 && (
          <div className="rounded-xl border-2 border-dashed border-gray-200 py-8 text-center text-gray-400">
            אין בקשות יציאה בטווח שנבחר
          </div>
        )}
        {requests.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-right text-xs font-semibold text-gray-500">
                  <th className="px-2 py-2">חייל</th>
                  <th className="px-2 py-2">יממת שיבוץ</th>
                  <th className="px-2 py-2">שעות</th>
                  <th className="px-2 py-2">הערה</th>
                  <th className="px-2 py-2"></th>
                  <th className="px-2 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {requests.map((r) => (
                  <tr key={r.id} className={form.id === r.id ? 'bg-blue-50/50' : ''}>
                    <td className="px-2 py-2.5 font-semibold text-slate-800 whitespace-nowrap">{r.soldierName}</td>
                    <td className="px-2 py-2.5 text-gray-700 whitespace-nowrap">{heDate(r.day)}</td>
                    <td className="px-2 py-2.5 text-gray-600"><TimeRange r={r} /></td>
                    <td className="px-2 py-2.5 text-gray-500">{r.note ?? ''}</td>
                    <td className="px-2 py-2.5">
                      {r.generated && (
                        <span className="rounded-full bg-yellow-100 px-2.5 py-0.5 text-xs font-semibold text-yellow-800 whitespace-nowrap">
                          שבצ"ק קיים
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-2.5">
                      <div className="flex justify-end gap-2 whitespace-nowrap">
                        <button
                          onClick={() => startEdit(r)}
                          disabled={deleting === r.id}
                          className="rounded-lg border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-50 px-3 py-1 text-sm font-medium text-gray-700"
                        >
                          עריכה
                        </button>
                        <button
                          onClick={() => void del(r)}
                          disabled={deleting === r.id}
                          className="rounded-lg border border-red-200 bg-red-50 hover:bg-red-100 disabled:opacity-50 px-3 py-1 text-sm font-medium text-red-700"
                        >
                          {deleting === r.id ? '⏳' : 'מחיקה'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
