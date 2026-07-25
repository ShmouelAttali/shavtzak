import { useCallback, useEffect, useState } from 'react';
import type { HamalDay, HamalResponse, HamalWriteResponse, HamalWindow } from '../../api/hamal';

/** One shift's picks as sent to the server (whole-day atomic write). */
export interface ShiftPayload { start: string; end: string; soldierIds: number[] }

/** Order-insensitive equality of two window lists (mirror api/hamal.ts). */
function sameWindows(a: HamalWindow[], b: HamalWindow[]): boolean {
  if (a.length !== b.length) return false;
  const key = (w: HamalWindow) => `${w.start}-${w.end}`;
  const sa = a.map(key).sort();
  const sb = b.map(key).sort();
  return sa.every((k, i) => k === sb[i]);
}

/** Build the HamalDay the server WILL persist, from the payload + local roster —
 *  so the UI reflects a change instantly instead of waiting for the round-trip. */
function optimisticDay(day: string, shifts: ShiftPayload[], roster: HamalResponse['roster'], defaults: HamalWindow[]): HamalDay {
  const nameOf = (id: number) => roster.find((r) => r.id === id)?.name ?? '';
  const windows = shifts.map((s) => ({ start: s.start, end: s.end }));
  return {
    day,
    custom: !sameWindows(windows, defaults),
    shifts: shifts.map((s) => ({
      start: s.start,
      end: s.end,
      picks: s.soldierIds.map((id, i) => ({ soldierId: id, name: nameOf(id), seatIndex: i + 1 })),
    })),
  };
}

const replaceDay = (data: HamalResponse, day: HamalDay): HamalResponse => ({
  ...data,
  days: data.days.filter((d) => d.day !== day.day).concat(day).sort((a, b) => a.day.localeCompare(b.day)),
});

/** חמל per-shift picks for a date range + the role-חמל roster for the picker.
 *  Saves are OPTIMISTIC: the local state updates immediately and the PUT runs in
 *  the background, so a pick feels instant regardless of server latency. Only the
 *  day being saved shows a "saving" flag — it is NOT disabled, so the page never
 *  blocks and other days stay fully interactive. */
export function useHamal(from: string, to: string) {
  const [data, setData] = useState<HamalResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingDays, setSavingDays] = useState<Set<string>>(new Set()); // days with a write in flight

  const load = useCallback(async () => {
    if (!from || !to) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/hamal?from=${from}&to=${to}`, { cache: 'no-store' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'שגיאה');
      setData(body as HamalResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'שגיאה בטעינת חמל');
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => { void load(); }, [load]);

  /** Persist a day's full shift list. Applies the change locally FIRST (instant),
   *  then PUTs in the background; reconciles from the server echo on success and
   *  resyncs from the server on failure. */
  const save = useCallback(async (day: string, shifts: ShiftPayload[]) => {
    setError(null);
    // 1. optimistic: reflect the change immediately from local roster/defaults
    setData((prev) => (prev ? replaceDay(prev, optimisticDay(day, shifts, prev.roster, prev.defaults)) : prev));
    setSavingDays((prev) => new Set(prev).add(day));
    try {
      const res = await fetch('/api/hamal', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ day, shifts }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'שגיאה');
      // 2. reconcile with the authoritative server echo (materialized HamalDay)
      setData((prev) => (prev ? replaceDay(prev, body as HamalWriteResponse) : prev));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'שגיאה בשמירת חמל');
      await load(); // roll back to server truth
    } finally {
      setSavingDays((prev) => { const next = new Set(prev); next.delete(day); return next; });
    }
  }, [load]);

  const isSaving = useCallback((day: string) => savingDays.has(day), [savingDays]);

  return { data, loading, error, savingDays, isSaving, reload: load, save };
}
