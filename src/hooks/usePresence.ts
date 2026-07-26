import { useCallback, useEffect, useState } from 'react';
import type { PresenceDayInput, PresenceResponse } from '../../api/presence';

// Data hook for the נוכחות tab. Reads the whole roster × day-range matrix for
// the picked window; saving is per SOLDIER (one PUT per touched soldier, the
// endpoint's declarative per-day replace) followed by a refetch, so the page
// always shows what the DB actually holds.

export function usePresence(from: string, to: string) {
  const [data, setData] = useState<PresenceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/presence?from=${from}&to=${to}`, { cache: 'no-store' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'שגיאה');
      setData(body as PresenceResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'שגיאה בטעינת הנוכחות');
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => { void load(); }, [load]);

  /** PUT one soldier's touched days. true = every soldier saved. */
  const save = useCallback(async (
    edits: { soldierId: number; days: PresenceDayInput[] }[],
  ): Promise<boolean> => {
    setSaving(true); setError(null);
    try {
      for (const e of edits) {
        if (!e.days.length) continue;
        const res = await fetch('/api/presence', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ soldier_id: e.soldierId, days: e.days }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? 'שגיאה');
      }
      await load();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'שגיאה בשמירת הנוכחות');
      return false;
    } finally {
      setSaving(false);
    }
  }, [load]);

  return { data, loading, saving, error, setError, reload: load, save };
}
