import { useCallback, useEffect, useState } from 'react';
import type { HamalResponse, HamalWriteResponse } from '../../api/hamal';

/** חמל picks for a date range + the full DB roster for the picker, with an
 *  immediate (no-draft) save. Reflected in the main שבצק on the next load. */
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

  /** Persist a day's full pick list (replaces it) and refresh. */
  const save = useCallback(async (day: string, soldierIds: number[]) => {
    setSaving(day);
    setError(null);
    try {
      const res = await fetch('/api/hamal', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ day, soldierIds }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'שגיאה');
      // optimistic local update from the server's echo
      setData((prev) => {
        if (!prev) return prev;
        const w = body as HamalWriteResponse;
        const days = prev.days.filter((d) => d.day !== day);
        if (w.picks.length) days.push({ day, picks: w.picks });
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
