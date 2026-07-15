import { useCallback, useEffect, useState } from 'react';
import type { DraftResponse, GenerateResponse } from '../../api/draft';

/** Draft schedule days from the scheduler DB + generation trigger. */
export function useDraft(from: string, to: string) {
  const [data, setData] = useState<DraftResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState<string | null>(null); // day in progress

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

  /** Generate days sequentially (one POST per day — server time limits). */
  const generateRange = useCallback(async (days: string[]): Promise<GenerateResponse[]> => {
    const results: GenerateResponse[] = [];
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
      setError(e instanceof Error ? e.message : 'שגיאה ביצירת שבצ"ק');
    } finally {
      setGenerating(null);
      await load();
    }
    return results;
  }, [load]);

  return { data, loading, error, generating, reload: load, generateRange };
}
