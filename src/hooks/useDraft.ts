import { useCallback, useEffect, useState } from 'react';
import type { DraftResponse, GenerateResponse } from '../../api/draft';

/** URL of the stored generation report for a day (or a range). */
export function reportUrl(from: string, to?: string): string {
  return to && to !== from
    ? `/api/report?from=${from}&to=${to}`
    : `/api/report?day=${from}`;
}

/** Draft schedule days from the scheduler DB + generation / publish triggers. */
export function useDraft(from: string, to: string) {
  const [data, setData] = useState<DraftResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState<string | null>(null); // day in progress
  const [busyDay, setBusyDay] = useState<string | null>(null);        // publish/unpublish in progress

  const load = useCallback(async () => {
    if (!from || !to) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/draft?from=${from}&to=${to}`, { cache: 'no-store' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'שגיאה');
      setData(body as DraftResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'שגיאה בטעינת טיוטה');
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => { void load(); }, [load]);

  /** Generate days sequentially (one POST per day — server time limits). On
   *  success the generation report opens in a new tab. */
  const generateRange = useCallback(async (days: string[]): Promise<GenerateResponse[]> => {
    const results: GenerateResponse[] = [];
    let failed = false;
    try {
      for (const day of days) {
        setGenerating(day);
        const res = await fetch('/api/draft', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ day }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(`${day}: ${body.error ?? 'שגיאה'}`);
        results.push(body as GenerateResponse);
      }
    } catch (e) {
      failed = true;
      setError(e instanceof Error ? e.message : 'שגיאה ביצירת שבצ"ק');
    } finally {
      setGenerating(null);
      await load();
    }
    if (!failed && results.length) {
      const first = results[0].day, last = results[results.length - 1].day;
      window.open(reportUrl(first, last), '_blank');
    }
    return results;
  }, [load]);

  /** Publish a generated day (status -> published). */
  const publish = useCallback(async (day: string, email: string): Promise<boolean> => {
    setBusyDay(day);
    setError(null);
    try {
      const res = await fetch('/api/publish', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ day, email }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'שגיאה בפרסום');
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'שגיאה בפרסום');
      return false;
    } finally {
      setBusyDay(null);
      await load();
    }
  }, [load]);

  /** Swap the soldier sitting in one assignment (day + time label) for
   *  another. Resolves to an error message on failure, null on success. */
  const replaceSoldier = useCallback(async (
    day: string, time: string, fromSoldierId: number, toSoldierId: number,
  ): Promise<string | null> => {
    setBusyDay(day);
    try {
      const res = await fetch('/api/draft', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ day, time, fromSoldierId, toSoldierId }),
      });
      const body = await res.json();
      if (!res.ok) return body.error ?? 'שגיאה בהחלפה';
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : 'שגיאה בהחלפה';
    } finally {
      setBusyDay(null);
      await load();
    }
  }, [load]);

  /** Revert a published day back to generated. */
  const unpublish = useCallback(async (day: string): Promise<boolean> => {
    setBusyDay(day);
    setError(null);
    try {
      const res = await fetch('/api/unpublish', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ day }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'שגיאה בביטול פרסום');
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'שגיאה בביטול פרסום');
      return false;
    } finally {
      setBusyDay(null);
      await load();
    }
  }, [load]);

  /** Throw away a day's draft (auto/chain + manual rows) — the day goes back to
   *  empty, leaving the published schedule as what stands. */
  const deleteDraft = useCallback(async (day: string): Promise<boolean> => {
    setBusyDay(day);
    setError(null);
    try {
      const res = await fetch(`/api/draft?day=${day}`, { method: 'DELETE' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'שגיאה במחיקת הטיוטה');
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'שגיאה במחיקת הטיוטה');
      return false;
    } finally {
      setBusyDay(null);
      await load();
    }
  }, [load]);

  return { data, loading, error, generating, busyDay, reload: load, generateRange, publish, unpublish, deleteDraft, replaceSoldier };
}
