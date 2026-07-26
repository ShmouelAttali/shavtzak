import { useCallback, useEffect, useState } from 'react';
import type { FairnessResponse } from '../../api/fairness';

/**
 * Per-soldier fairness counters for the 7-day window ending at `date`.
 * `includeDrafts` false (the default) counts only the already-scheduled
 * published work; true factors drafts in, a day's draft superseding its
 * published rows.
 */
export function useFairness(date: string, includeDrafts = false) {
  const [data, setData] = useState<FairnessResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!date) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/fairness?date=${date}${includeDrafts ? '&drafts=1' : ''}`,
        { cache: 'no-store' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'שגיאה');
      setData(body as FairnessResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'שגיאה בטעינת נתוני הוגנות');
    } finally {
      setLoading(false);
    }
  }, [date, includeDrafts]);

  useEffect(() => { void load(); }, [load]);

  return { data, loading, error, reload: load };
}
