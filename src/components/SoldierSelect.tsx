import { useEffect, useMemo, useRef, useState } from 'react';
import type { HamalRosterEntry } from '../../api/hamal';

/** One-line searchable single-select combobox of role-חמל soldiers.
 *  Shows the selected soldier (or a placeholder); opening reveals a search box
 *  + a filtered, scrollable list. Select assigns; ✕ clears. */
export function SoldierSelect({ roster, selectedId, onSelect, onClear, disabled }: {
  roster: HamalRosterEntry[];
  selectedId: number | null;
  onSelect: (soldierId: number) => void;
  onClear: () => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = useMemo(
    () => roster.find((s) => s.id === selectedId) ?? null,
    [roster, selectedId],
  );

  const filtered = useMemo(() => {
    const needle = q.trim();
    if (!needle) return roster;
    return roster.filter((s) => s.name.includes(needle) || s.role.includes(needle));
  }, [roster, q]);

  // close on outside click + Esc
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // focus the search box when opening
  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);

  const pick = (id: number) => { onSelect(id); setOpen(false); setQ(''); };

  return (
    <div className="relative" ref={wrapRef} dir="rtl">
      <div className="flex items-center gap-1">
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen((v) => !v)}
          className={`flex-1 min-w-0 flex items-center justify-between gap-2 rounded-lg border px-3 py-1.5 text-sm text-right disabled:opacity-50
            ${selected ? 'border-blue-300 bg-blue-50 text-slate-800' : 'border-gray-300 bg-white text-gray-400'}
            hover:border-blue-400 focus:border-blue-500 focus:outline-none`}
        >
          <span className="truncate">{selected ? selected.name : 'בחר חייל'}</span>
          <span className="text-gray-400 shrink-0">▾</span>
        </button>
        {selected && (
          <button
            type="button"
            disabled={disabled}
            onClick={onClear}
            title="הסר שיבוץ"
            className="rounded px-1.5 py-1 text-sm text-red-500 hover:bg-red-50 disabled:opacity-50"
          >✕</button>
        )}
      </div>

      {open && (
        <div className="absolute z-20 mt-1 w-full min-w-[14rem] rounded-lg border border-gray-200 bg-white shadow-lg">
          <div className="p-2 border-b border-gray-100">
            <input
              ref={inputRef}
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="חיפוש חייל..."
              dir="rtl"
              className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
            />
          </div>
          <div className="max-h-56 overflow-y-auto divide-y divide-gray-50">
            {filtered.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => pick(s.id)}
                className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm text-right
                  ${s.id === selectedId ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
              >
                <span className="font-medium text-slate-700">{s.name}</span>
                {s.role && <span className="text-xs text-gray-400">{s.role}</span>}
                {s.platoon && <span className="text-xs text-gray-300">מחלקה {s.platoon}</span>}
                {!s.schedulable && <span className="text-xs text-orange-400">(לא זמין)</span>}
              </button>
            ))}
            {filtered.length === 0 && (
              <div className="px-3 py-3 text-sm text-gray-400">לא נמצאו חיילים</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
