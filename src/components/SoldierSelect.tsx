import { useEffect, useMemo, useRef, useState } from 'react';

/** One pickable soldier. Structural — both the חמל roster
 *  (api/hamal HamalRosterEntry) and the draft roster (api/draft
 *  DraftRosterEntry) satisfy it as-is; `note` is an optional per-row hint
 *  (e.g. "בבית" / the soldier's current position that day). */
export interface SoldierOption {
  id: number;
  name: string;
  role: string;
  platoon: string;
  schedulable: boolean;
  note?: string;
}

/** A toggle rendered above the list (e.g. "הצג רק נהג דוד"). The PARENT owns
 *  the predicate and passes an already-filtered `options` — this is only the
 *  control. */
export interface PickerFilter {
  key: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

/** Search box (+ optional filter toggles) over a scrollable soldier list.
 *  The single shared picker body: the חמל tab mounts it inside the
 *  SoldierSelect dropdown, the draft tab's replacement popup mounts it
 *  inline. */
export function SoldierPicker({ options, selectedId, onPick, filters = [], autoFocus = false }: {
  options: SoldierOption[];
  selectedId?: number | null;
  onPick: (soldierId: number) => void;
  filters?: PickerFilter[];
  autoFocus?: boolean;
}) {
  const [q, setQ] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (autoFocus) inputRef.current?.focus(); }, [autoFocus]);

  const filtered = useMemo(() => {
    const needle = q.trim();
    if (!needle) return options;
    return options.filter((s) => s.name.includes(needle) || s.role.includes(needle));
  }, [options, q]);

  return (
    <>
      <div className="p-2 border-b border-gray-100 space-y-2">
        <input
          ref={inputRef}
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="חיפוש חייל..."
          dir="rtl"
          className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
        />
        {filters.map((f) => (
          <label key={f.key} className="flex items-center gap-2 text-xs text-gray-600 select-none">
            <input type="checkbox" checked={f.checked}
              onChange={(e) => f.onChange(e.target.checked)}
              className="accent-blue-600" />
            {f.label}
          </label>
        ))}
      </div>
      <div className="max-h-56 overflow-y-auto divide-y divide-gray-50">
        {filtered.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => onPick(s.id)}
            className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm text-right
              ${s.id === selectedId ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
          >
            <span className="font-medium text-slate-700">{s.name}</span>
            {s.role && <span className="text-xs text-gray-400">{s.role}</span>}
            {s.platoon && <span className="text-xs text-gray-300">מחלקה {s.platoon}</span>}
            {!s.schedulable && <span className="text-xs text-orange-400">(לא זמין)</span>}
            {s.note && <span className="text-xs text-gray-400 mr-auto">{s.note}</span>}
          </button>
        ))}
        {filtered.length === 0 && (
          <div className="px-3 py-3 text-sm text-gray-400">לא נמצאו חיילים</div>
        )}
      </div>
    </>
  );
}

/** One-line searchable single-select combobox of soldiers.
 *  Shows the selected soldier (or a placeholder); opening reveals the shared
 *  SoldierPicker. Select assigns; ✕ clears. */
export function SoldierSelect({ roster, selectedId, onSelect, onClear, disabled }: {
  roster: SoldierOption[];
  selectedId: number | null;
  onSelect: (soldierId: number) => void;
  onClear: () => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const selected = useMemo(
    () => roster.find((s) => s.id === selectedId) ?? null,
    [roster, selectedId],
  );

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

  const pick = (id: number) => { onSelect(id); setOpen(false); };

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
          <SoldierPicker options={roster} selectedId={selectedId} onPick={pick} autoFocus />
        </div>
      )}
    </div>
  );
}
