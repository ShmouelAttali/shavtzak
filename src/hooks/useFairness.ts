import { useCallback, useEffect, useState } from 'react';
import type { FairnessResponse } from '../../api/fairness';

/** Per-soldier fairness counters for the 7-day window ending at `date`. */
export function useFairness(date: string) {
  const [data, setData] = useState<FairnessResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!date) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/fairness?date=${date}`, { cache: 'no-store' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'שגיאה');
      setData(body as FairnessResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'שגיאה בטעינת נתוני הוגנות');
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => { void load(); }, [load]);

  return { data, loading, error, reload: load };
}
