import type { ReactNode } from 'react';
import type { RosterResponse } from '../../api/_handlers/roster';
import { ROLE_COMMANDERS, QUAL_RESTRICTED, QUAL_POOL_PREFIX } from '../lib/rosterFilter';
import type { RosterFilters as Filters } from '../lib/rosterFilter';

// The roster filter bar, shared by מצבת חיילים and נוכחות so both tabs narrow
// the roster with exactly the same controls (and the same pure predicates in
// src/lib/rosterFilter.ts). Extra actions go in `children`, after the spacer.
//
// `showArchived` = false hides the פעילים/שהוסרו select (the נוכחות tab only
// ever serves active soldiers).

const inputCls = 'rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm text-slate-800 focus:border-blue-500 focus:outline-none';
const selectCls = `${inputCls} font-medium`;

export function RosterFilterBar({ filters, setFilters, meta, showArchived = true, children }: {
  filters: Filters;
  setFilters: (f: Filters) => void;
  meta: RosterResponse | null;
  showArchived?: boolean;
  children?: ReactNode;
}) {
  const poolPositionIds = [...new Set((meta?.closedLists ?? []).map((l) => l.positionId))];
  const posName = (id: number) => meta?.positions.find((p) => p.id === id)?.name ?? String(id);

  return (
    <div className="flex flex-wrap items-center gap-2" dir="rtl">
      {showArchived && (
        <select className={selectCls} value={filters.archived ? 'archived' : 'active'}
          onChange={(e) => setFilters({ ...filters, archived: e.target.value === 'archived' })}>
          <option value="active">חיילים פעילים</option>
          <option value="archived">חיילים שהוסרו</option>
        </select>
      )}
      <input className={`${inputCls} w-48`} placeholder="חיפוש שם / מס' אישי / מייל"
        value={filters.text} onChange={(e) => setFilters({ ...filters, text: e.target.value })} />
      <select className={selectCls} value={filters.role}
        onChange={(e) => setFilters({ ...filters, role: e.target.value })}>
        <option value="">כל התפקידים</option>
        <option value={ROLE_COMMANDERS}>מפקדים</option>
        {meta?.roles.map((r) => <option key={r} value={r}>{r}</option>)}
      </select>
      <select className={selectCls} value={filters.qual}
        onChange={(e) => setFilters({ ...filters, qual: e.target.value })}>
        <option value="">כל ההסמכות</option>
        {meta?.qualifications.map((q) => <option key={q} value={q}>{q}</option>)}
        {poolPositionIds.map((id) => (
          <option key={id} value={`${QUAL_POOL_PREFIX}${id}`}>ברשימת {posName(id)}</option>
        ))}
        <option value={QUAL_RESTRICTED}>מוגבלי עמדות</option>
      </select>

      <div className="flex-1" />

      {children}
    </div>
  );
}
