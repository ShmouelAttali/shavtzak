import { useCallback, useEffect, useState } from 'react';
import type { HamalResponse, HamalWriteResponse } from '../../api/hamal';

/** One shift's picks as sent to the server (whole-day atomic write). */
export interface ShiftPayload { start: string; end: string; soldierIds: number[] }

/** חמל per-shift picks for a date range + the full DB roster for the picker,
 *  with an immediate (no-draft) save. Reflected in the main שבצק on next load. */
export function useHamal(from: string, to: string) {
  const [data, setData] = useState<HamalResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null); // day in progress

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

  /** Persist a day's full shift list (structure + picks, replaces it) and
   *  refresh from the server's echo. */
  const save = useCallback(async (day: string, shifts: ShiftPayload[]) => {
    setSaving(day);
    setError(null);
    try {
      const res = await fetch('/api/hamal', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ day, shifts }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'שגיאה');
      // optimistic local update from the server's echo (a materialized HamalDay)
      setData((prev) => {
        if (!prev) return prev;
        const w = body as HamalWriteResponse;
        const days = prev.days.filter((d) => d.day !== day);
        days.push(w);
        days.sort((a, b) => a.day.localeCompare(b.day));
        return { ...prev, days };
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'שגיאה בשמירת חמל');
      await load(); // resync on failure
    } finally {
      setSaving(null);
    }
  }, [load]);

  return { data, loading, error, saving, reload: load, save };
}
