import { useMemo, useState } from 'react';
import type { DraftAssignmentMeta, DraftRosterEntry } from '../../api/draft';
import { isCommanderRole } from '../../scheduler/src/crewOrder';
import { SoldierPicker, type PickerFilter, type SoldierOption } from './SoldierSelect';

/** The clicked assignment: identified exactly like the draft `meta` map —
 *  day + soldier + the slot's rendered time label. */
export interface ReplaceState {
  day: string;
  name: string;
  time: string;
  soldierId: number | null;      // null = the name has no DB row (shouldn't happen)
  meta?: DraftAssignmentMeta;
  published: boolean;
  /** soldier name -> what he is doing that day (day_assignments bucket) */
  busyNote: Record<string, string>;
  /** soldier name -> the overlapping BLOCKING seat he already holds; picking
   *  him asks whether to vacate it (src/lib/draftConflicts.ts) */
  conflictNote?: Record<string, string>;
}

/** Commander rationale codes: the seat this soldier holds is a commander seat
 *  (or he was taken in the position's Level-1 commander quota). */
const COMMANDER_CODES = new Set(['commander_seat', 'commander_quota', 'chain_commander', 'magen_commander']);

/** The driver qualification this seat needs (H6d — 'נהג דוד' / 'נהג טיגריס'),
 *  read off the generator's own rationale, or null when this is not a driver
 *  seat. */
export function driverQual(meta?: DraftAssignmentMeta): string | null {
  for (const e of meta?.rationale ?? []) {
    if (e.code === 'driver_seat' || e.code === 'driver_quota') {
      const q = e.params?.qual;
      return typeof q === 'string' && q ? q : 'נהג';
    }
  }
  return null;
}

export function isCommanderSlot(meta?: DraftAssignmentMeta): boolean {
  return (meta?.rationale ?? []).some((e) => COMMANDER_CODES.has(e.code));
}

/** Candidate list for the picker: everyone except the soldier being replaced,
 *  narrowed by whichever seat filters are ON. `qual`/`commanderOnly` null-off
 *  means "no such filter" — a checked filter with no qualified soldier left
 *  legitimately yields an empty list (the officer unchecks it to see all). */
export function replacementOptions(
  roster: DraftRosterEntry[],
  opts: {
    excludeId?: number | null;
    qual?: string | null;          // require this qualification
    commanderOnly?: boolean;       // require a commander role
    busyNote?: Record<string, string>;
    conflictNote?: Record<string, string>;
  } = {},
): SoldierOption[] {
  const { excludeId = null, qual = null, commanderOnly = false,
          busyNote = {}, conflictNote = {} } = opts;
  return roster
    .filter((s) => s.id !== excludeId)
    .filter((s) => !qual || s.quals.some((q) => q.includes(qual)))
    .filter((s) => !commanderOnly || isCommanderRole(s.role))
    .map((s) => ({
      id: s.id, name: s.name, role: s.role, platoon: s.platoon,
      schedulable: s.schedulable, note: busyNote[s.name], warn: conflictNote[s.name],
    }));
}

/** Replace the soldier sitting in one assignment. Driver/commander seats
 *  default to showing only qualified candidates (owner request) — unchecking
 *  the box falls back to the whole roster. */
export function ReplaceSoldierPopup({ info, roster, busy, error, onReplace, onClose }: {
  info: ReplaceState;
  roster: DraftRosterEntry[];
  busy: boolean;
  error: string | null;
  onReplace: (toSoldierId: number) => void;
  onClose: () => void;
}) {
  const qual = driverQual(info.meta);
  const commander = isCommanderSlot(info.meta);
  const [onlyDrivers, setOnlyDrivers] = useState(true);
  const [onlyCommanders, setOnlyCommanders] = useState(true);

  const options = useMemo<SoldierOption[]>(() => replacementOptions(roster, {
    excludeId: info.soldierId,
    qual: qual && onlyDrivers ? qual : null,
    commanderOnly: commander && onlyCommanders,
    busyNote: info.busyNote,
    conflictNote: info.conflictNote,
  }), [roster, info.soldierId, info.busyNote, info.conflictNote, qual, onlyDrivers, commander, onlyCommanders]);

  const filters: PickerFilter[] = [];
  if (qual) {
    filters.push({
      key: 'driver', label: `הצג רק ${qual === 'נהג' ? 'נהגים' : qual}`,
      checked: onlyDrivers, onChange: setOnlyDrivers,
    });
  }
  if (commander) {
    filters.push({
      key: 'commander', label: 'הצג רק מפקדים',
      checked: onlyCommanders, onChange: setOnlyCommanders,
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 px-4 pb-6 sm:pb-0"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm bg-white rounded-2xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        dir="rtl"
      >
        <div className="px-4 pt-4 pb-3 text-center space-y-0.5">
          <p className="text-lg font-bold text-gray-800">{info.name}</p>
          <p className="text-sm text-gray-500">
            החלפה בשיבוץ {info.time === 'יומי' ? 'היומי' : info.time}
          </p>
        </div>

        {/* A published day IS editable (owner 2026-07-26) — one seat can be
            fixed without unpublishing; only regenerate / מחק טיוטה stay frozen.
            The note is a reminder that this change is live. */}
        {info.published && (
          <p className="px-4 pb-2 text-center text-xs text-orange-700 bg-orange-50 py-2">
            היום פורסם — השינוי ייכנס לשבצ"ק שפורסם
          </p>
        )}
        {info.soldierId === null || !info.time ? (
          <p className="px-4 pb-4 text-center text-sm text-red-700 bg-red-50 py-3">
            {info.soldierId === null
              ? 'החייל אינו מזוהה במסד הנתונים — לא ניתן להחליף'
              : 'לא ניתן לזהות את המשמרת — רענן ונסה שוב'}
          </p>
        ) : (
          <div className="border-t border-gray-100">
            {error && (
              <p className="px-4 py-2 text-sm text-red-700 bg-red-50 text-center">{error}</p>
            )}
            {busy ? (
              <p className="px-4 py-6 text-center text-sm text-gray-400">
                <span className="animate-spin inline-block">↺</span> מחליף...
              </p>
            ) : (
              <SoldierPicker options={options} onPick={onReplace} filters={filters} autoFocus />
            )}
          </div>
        )}

        <div className="p-3 border-t border-gray-100">
          <button
            onClick={onClose}
            className="w-full rounded-xl border border-gray-200 py-2 text-sm text-gray-500 hover:bg-gray-50"
          >
            סגור
          </button>
        </div>
      </div>
    </div>
  );
}
