import { useEffect, useMemo, useState } from 'react';
import type { MutableRefObject } from 'react';
import type { TabLeaveGuard } from '../types';
import type { RosterInput, RosterResponse, RosterSoldier } from '../../api/_handlers/roster';
import { useRoster } from '../hooks/useRoster';
import { filterRoster, qualStuckInRole, EMPTY_FILTERS } from '../lib/rosterFilter';
import type { RosterFilters } from '../lib/rosterFilter';
import { RosterFilterBar } from './RosterFilters';
import { heDate } from './DateRangePicker';

// מצבת חיילים tab (admin): the DB roster with every scheduler-relevant field —
// roster columns, הסמכות + רובאי, the H6c whitelist and the closed candidate
// lists. Read-only table + per-row edit popup; removal is soft (archive) and
// reversible from the חיילים שהוסרו view. תפקיד and מחלקה are CLOSED dropdowns
// over the GET payload's catalogs (the API rejects anything else) — a typo in
// either used to break generator role/platoon matching silently.

const inputCls = 'rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm text-slate-800 focus:border-blue-500 focus:outline-none';
const saveBtnCls = 'rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white px-4 py-1.5 text-sm font-semibold';
const ghostBtnCls = 'rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600 px-4 py-1.5 text-sm font-medium';

const EMPTY_SOLDIER: RosterInput = {
  id: null, personalNumber: '', fullName: '', platoon: '', role: '', rifleLevel: null,
  phone: '', email: '', isSchedulable: true, notes: '', archived: false, isAdmin: false,
  quals: [], allowedPositionIds: [], candidacies: [],
};

function toInput(s: RosterSoldier): RosterInput {
  return {
    id: s.id, personalNumber: s.personalNumber, fullName: s.fullName, platoon: s.platoon,
    role: s.role, rifleLevel: s.rifleLevel, phone: s.phone, email: s.email,
    isSchedulable: s.isSchedulable, notes: s.notes, archived: s.archivedAt != null,
    isAdmin: s.isAdmin, quals: [...s.quals], allowedPositionIds: [...s.allowedPositionIds],
    candidacies: s.candidacies.map((c) => ({ ...c })),
  };
}

const Badge = ({ children, tone = 'gray' }: { children: React.ReactNode; tone?: 'gray' | 'blue' | 'amber' }) => (
  <span className={`inline-block rounded px-1.5 py-0.5 text-xs whitespace-nowrap ${
    tone === 'blue' ? 'bg-blue-50 text-blue-700'
      : tone === 'amber' ? 'bg-amber-50 text-amber-700'
        : 'bg-gray-100 text-gray-600'}`}>{children}</span>
);

// ── edit popup ───────────────────────────────────────────────────────────────

function SoldierEditPopup({ draft, setDraft, meta, saving, error, onSave, onClose }: {
  draft: RosterInput;
  setDraft: (d: RosterInput) => void;
  meta: RosterResponse;
  saving: boolean;
  error: string | null;
  onSave: () => void;
  onClose: () => void;
}) {
  const set = <K extends keyof RosterInput>(k: K, v: RosterInput[K]) => setDraft({ ...draft, [k]: v });

  const toggleQual = (q: string) => set('quals',
    draft.quals.includes(q) ? draft.quals.filter((x) => x !== q) : [...draft.quals, q]);

  const togglePosition = (id: number) => set('allowedPositionIds',
    draft.allowedPositionIds.includes(id)
      ? draft.allowedPositionIds.filter((x) => x !== id)
      : [...draft.allowedPositionIds, id]);

  const candKey = (positionId: number, subPositionId: number | null) => `${positionId}|${subPositionId ?? ''}`;
  const candOf = (positionId: number, subPositionId: number | null) =>
    draft.candidacies.find((c) => candKey(c.positionId, c.subPositionId) === candKey(positionId, subPositionId));
  const toggleCand = (positionId: number, subPositionId: number | null) => set('candidacies',
    candOf(positionId, subPositionId)
      ? draft.candidacies.filter((c) => candKey(c.positionId, c.subPositionId) !== candKey(positionId, subPositionId))
      : [...draft.candidacies, { positionId, subPositionId, priority: null }]);
  const setCandPriority = (positionId: number, subPositionId: number | null, priority: number | null) =>
    set('candidacies', draft.candidacies.map((c) =>
      candKey(c.positionId, c.subPositionId) === candKey(positionId, subPositionId) ? { ...c, priority } : c));

  // הסמכה that is also spelled inside the תפקיד string: unchecking it has no
  // effect, because the generator's hasQualification() reads the role too.
  const stuck = meta.qualifications.filter((q) => !draft.quals.includes(q) && qualStuckInRole(draft.role, q));

  const whitelistable = meta.positions.filter((p) => p.isScheduled && p.missionClass !== 'rest');

  // תפקיד/מחלקה are closed lists (the API rejects anything else). The stored
  // value is always in the payload's catalog, but keep it as an option anyway so
  // a select can never silently render blank over a real value.
  const withCurrent = (options: string[], current: string) =>
    current && !options.includes(current) ? [current, ...options] : options;
  const roleOptions = withCurrent(meta.roles, draft.role);
  const platoonOptions = withCurrent(meta.platoons, draft.platoon);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 px-4 py-8" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl p-6 space-y-4 w-full max-w-2xl" onClick={(e) => e.stopPropagation()} dir="rtl">
        <div className="flex items-center justify-between">
          <div className="text-lg font-bold text-slate-800">
            {draft.id == null ? 'חייל חדש' : `עריכת חייל — ${draft.fullName}`}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none">✕</button>
        </div>

        {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

        {/* roster fields */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="space-y-1">
            <div className="text-xs text-gray-500 font-medium">שם מלא</div>
            <input className={`${inputCls} w-full`} value={draft.fullName}
              onChange={(e) => set('fullName', e.target.value)} />
          </label>
          <label className="space-y-1">
            <div className="text-xs text-gray-500 font-medium">מספר אישי</div>
            <input className={`${inputCls} w-full`} value={draft.personalNumber} dir="ltr"
              onChange={(e) => set('personalNumber', e.target.value)} />
          </label>
          <label className="space-y-1">
            <div className="text-xs text-gray-500 font-medium">מחלקה</div>
            <select className={`${inputCls} w-full`} value={draft.platoon}
              onChange={(e) => set('platoon', e.target.value)}>
              {/* a new soldier starts unset; the API falls back to לא ידוע */}
              {!draft.platoon && <option value="">— בחר מחלקה —</option>}
              {platoonOptions.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            <div className="text-xs text-gray-400">מחלקה חדשה נוספת מול הדאטהבייס</div>
          </label>
          <label className="space-y-1">
            <div className="text-xs text-gray-500 font-medium">תפקיד</div>
            <select className={`${inputCls} w-full`} value={draft.role}
              onChange={(e) => set('role', e.target.value)}>
              <option value="">— ללא תפקיד —</option>
              {roleOptions.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
          <label className="space-y-1">
            <div className="text-xs text-gray-500 font-medium">רובאי</div>
            <input className={`${inputCls} w-full`} type="number" dir="ltr"
              value={draft.rifleLevel ?? ''}
              onChange={(e) => set('rifleLevel', e.target.value === '' ? null : Number(e.target.value))} />
          </label>
          <label className="space-y-1">
            <div className="text-xs text-gray-500 font-medium">פלאפון</div>
            <input className={`${inputCls} w-full`} value={draft.phone} dir="ltr"
              onChange={(e) => set('phone', e.target.value)} />
          </label>
          <label className="space-y-1 sm:col-span-2">
            <div className="text-xs text-gray-500 font-medium">מייל</div>
            <input className={`${inputCls} w-full`} value={draft.email} dir="ltr" type="email"
              onChange={(e) => set('email', e.target.value)} />
          </label>
          <label className="space-y-1 sm:col-span-2">
            <div className="text-xs text-gray-500 font-medium">הערות</div>
            <input className={`${inputCls} w-full`} value={draft.notes}
              onChange={(e) => set('notes', e.target.value)} />
          </label>
        </div>

        <div className="flex flex-wrap gap-4 border-t border-gray-100 pt-3">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={draft.isSchedulable}
              onChange={(e) => set('isSchedulable', e.target.checked)} />
            משובץ בשבצ"ק
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={draft.isAdmin} disabled={!draft.email || draft.archived}
              onChange={(e) => set('isAdmin', e.target.checked)} />
            אדמין שבצ"ק
            {!draft.email && <span className="text-xs text-gray-400">(דורש מייל)</span>}
          </label>
        </div>

        {/* qualifications */}
        <div className="border-t border-gray-100 pt-3 space-y-2">
          <div className="text-sm font-semibold text-slate-700">הסמכות</div>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {meta.qualifications.map((q) => (
              <label key={q} className="flex items-center gap-1.5 text-sm text-slate-700">
                <input type="checkbox" checked={draft.quals.includes(q)} onChange={() => toggleQual(q)} />
                {q}
              </label>
            ))}
          </div>
          {stuck.length > 0 && (
            <div className="text-xs text-amber-700">
              שים לב: {stuck.join(', ')} מופיע גם בטקסט התפקיד — המחולל יזהה את ההסמכה
              גם בלי הסימון כאן.
            </div>
          )}
        </div>

        {/* H6c whitelist */}
        <div className="border-t border-gray-100 pt-3 space-y-2">
          <div className="text-sm font-semibold text-slate-700">
            עמדות מותרות <span className="font-normal text-gray-400">(ללא סימון = מותר בכל עמדה)</span>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {whitelistable.map((p) => (
              <label key={p.id} className="flex items-center gap-1.5 text-sm text-slate-700">
                <input type="checkbox" checked={draft.allowedPositionIds.includes(p.id)}
                  onChange={() => togglePosition(p.id)} />
                {p.name}
              </label>
            ))}
          </div>
        </div>

        {/* closed candidate lists */}
        {meta.closedLists.length > 0 && (
          <div className="border-t border-gray-100 pt-3 space-y-2">
            <div className="text-sm font-semibold text-slate-700">רשימות סגורות</div>
            <div className="space-y-1">
              {meta.closedLists.map((l) => {
                const c = candOf(l.positionId, l.subPositionId);
                return (
                  <div key={`${l.positionId}|${l.subPositionId ?? ''}`} className="flex items-center gap-2 text-sm text-slate-700">
                    <label className="flex items-center gap-1.5">
                      <input type="checkbox" checked={!!c}
                        onChange={() => toggleCand(l.positionId, l.subPositionId)} />
                      {l.label}
                    </label>
                    {c && l.ordered && (
                      <label className="flex items-center gap-1 text-xs text-gray-500">
                        סדר
                        <input type="number" min={1} dir="ltr" value={c.priority ?? ''}
                          onChange={(e) => setCandPriority(l.positionId, l.subPositionId,
                            e.target.value === '' ? null : Number(e.target.value))}
                          className="w-16 rounded border border-gray-300 px-1.5 py-0.5 text-sm" />
                      </label>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 border-t border-gray-100 pt-4">
          <button onClick={onClose} disabled={saving} className={ghostBtnCls}>ביטול</button>
          <button onClick={onSave} disabled={saving} className={saveBtnCls}>
            {saving ? 'שומר…' : 'שמור'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── tab ──────────────────────────────────────────────────────────────────────

export function Roster({ guardRef }: { guardRef: MutableRefObject<TabLeaveGuard | null> }) {
  const { data, loading, saving, error, setError, saveSoldier } = useRoster();
  const [filters, setFilters] = useState<RosterFilters>(EMPTY_FILTERS);
  const [removeMode, setRemoveMode] = useState(false);
  const [draft, setDraft] = useState<RosterInput | null>(null);
  const [baseline, setBaseline] = useState('');

  const isDirty = draft != null && JSON.stringify(draft) !== baseline;

  const openEditor = (input: RosterInput) => {
    setError(null);
    setDraft(input);
    setBaseline(JSON.stringify(input));
  };
  const closeEditor = () => { setDraft(null); setBaseline(''); setError(null); };

  const commit = async (): Promise<boolean> => {
    if (!draft) return true;
    const ok = await saveSoldier(draft);
    if (ok) closeEditor();
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
    () => (data ? filterRoster(data.soldiers, filters) : []),
    [data, filters]);

  const setArchived = async (s: RosterSoldier, archived: boolean) => {
    const what = archived
      ? `להסיר את ${s.fullName} מהמצבת? השיבוצים ההיסטוריים יישמרו, וניתן לשחזר בכל עת.`
      : `להחזיר את ${s.fullName} למצבת הפעילה?`;
    if (!window.confirm(what)) return;
    await saveSoldier({ ...toInput(s), archived });
  };

  const posName = (id: number) => data?.positions.find((p) => p.id === id)?.name ?? String(id);

  return (
    <div className="space-y-5">
      <div className="rounded-xl bg-blue-50 border border-blue-100 px-4 py-3 text-sm text-blue-800" dir="rtl">
        עריכת מצבת החיילים של המחולל — פרטי החייל, הסמכות, עמדות מותרות ורשימות סגורות.
        השינויים כאן אינם נכתבים חזרה לגיליון "מצבת החיילים"; ייבוא הבא מהגיליון עשוי
        להוסיף בחזרה הסמכות שמופיעות בטקסט התפקיד או ההערות.
      </div>

      <RosterFilterBar filters={filters} setFilters={setFilters} meta={data}>
        {!filters.archived && (
          <>
            <button className={saveBtnCls} onClick={() => openEditor({ ...EMPTY_SOLDIER })}>+ חייל חדש</button>
            <button onClick={() => setRemoveMode((v) => !v)}
              className={removeMode
                ? 'rounded-lg bg-red-600 hover:bg-red-500 text-white px-4 py-1.5 text-sm font-semibold'
                : ghostBtnCls}>
              {removeMode ? 'סיים הסרה' : 'הסר חייל'}
            </button>
          </>
        )}
        {loading && <span className="text-sm text-gray-400"><span className="animate-spin inline-block">↺</span></span>}
      </RosterFilterBar>

      {removeMode && !filters.archived && (
        <div className="rounded-xl bg-amber-50 border border-amber-100 px-4 py-2 text-sm text-amber-800" dir="rtl">
          מצב הסרה: לחיצה על ✕ ליד חייל תסיר אותו מהמצבת הפעילה. אפשר לשחזר דרך "חיילים שהוסרו".
        </div>
      )}

      {error && !draft && <div className="rounded-xl bg-red-50 p-4 text-center text-red-700 text-sm">{error}</div>}

      <div className="rounded-xl bg-white p-4 shadow-sm overflow-x-auto">
        <div className="mb-2 text-xs text-gray-400">{shown.length} חיילים</div>
        <table className="w-full text-sm" dir="rtl">
          <thead>
            <tr className="text-right text-gray-500 border-b border-gray-100">
              <th className="font-medium pl-2 pb-1">שם</th>
              <th className="font-medium pl-2 pb-1">מס' אישי</th>
              <th className="font-medium pl-2 pb-1">מחלקה</th>
              <th className="font-medium pl-2 pb-1">תפקיד</th>
              <th className="font-medium pl-2 pb-1">רובאי</th>
              <th className="font-medium pl-2 pb-1">הסמכות</th>
              <th className="font-medium pl-2 pb-1">רשימות / הגבלות</th>
              <th className="font-medium pl-2 pb-1">מייל</th>
              <th className="font-medium pl-2 pb-1">סטטוס</th>
              <th className="pb-1" />
            </tr>
          </thead>
          <tbody>
            {shown.map((s) => (
              <tr key={s.id} onClick={() => openEditor(toInput(s))}
                className="border-b border-gray-50 hover:bg-blue-50/40 cursor-pointer align-top">
                <td className="pl-2 py-1.5 font-medium text-slate-800 whitespace-nowrap">{s.fullName}</td>
                <td className="pl-2 py-1.5 text-gray-500 tabular-nums" dir="ltr">{s.personalNumber}</td>
                <td className="pl-2 py-1.5 text-gray-600">{s.platoon}</td>
                <td className="pl-2 py-1.5 text-gray-600 whitespace-nowrap">{s.role}</td>
                <td className="pl-2 py-1.5 text-gray-600 tabular-nums">{s.rifleLevel ?? ''}</td>
                <td className="pl-2 py-1.5">
                  <span className="flex flex-wrap gap-1">
                    {s.quals.map((q) => <Badge key={q}>{q}</Badge>)}
                  </span>
                </td>
                <td className="pl-2 py-1.5">
                  <span className="flex flex-wrap gap-1">
                    {[...new Set(s.candidacies.map((c) => c.positionId))].map((id) => (
                      <Badge key={id} tone="blue">{posName(id)}</Badge>
                    ))}
                    {s.allowedPositionIds.length > 0 && (
                      <Badge tone="amber">
                        מוגבל: {s.allowedPositionIds.map(posName).join(', ')}
                      </Badge>
                    )}
                  </span>
                </td>
                <td className="pl-2 py-1.5 text-gray-500 text-xs" dir="ltr">{s.email}</td>
                <td className="pl-2 py-1.5">
                  <span className="flex flex-wrap gap-1">
                    {!s.isSchedulable && <Badge>לא משובץ</Badge>}
                    {s.isAdmin && <Badge tone="blue">אדמין</Badge>}
                    {s.archivedAt && <Badge tone="amber">הוסר {heDate(s.archivedAt.slice(0, 10))}</Badge>}
                  </span>
                </td>
                <td className="pl-2 py-1.5 text-left whitespace-nowrap">
                  {filters.archived ? (
                    <button onClick={(e) => { e.stopPropagation(); void setArchived(s, false); }}
                      className="rounded border border-gray-200 px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-50">
                      שחזר
                    </button>
                  ) : removeMode ? (
                    <button onClick={(e) => { e.stopPropagation(); void setArchived(s, true); }}
                      title={`הסר את ${s.fullName}`}
                      className="rounded px-2 py-0.5 text-sm font-bold text-red-600 hover:bg-red-50">
                      ✕
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
            {!loading && shown.length === 0 && (
              <tr><td colSpan={10} className="py-6 text-center text-sm text-gray-400">אין חיילים תואמים</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {draft && data && (
        <SoldierEditPopup draft={draft} setDraft={setDraft} meta={data} saving={saving}
          error={error} onSave={() => void commit()} onClose={closeEditor} />
      )}
    </div>
  );
}
