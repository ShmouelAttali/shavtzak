import { useCallback, useEffect, useState } from 'react';
import type { RosterInput, RosterResponse } from '../../api/roster';

// Data hook for the מצבת חיילים tab. Unlike useDayStructure (a whole-day
// document with page-level dirty state), edits here are per-soldier: the
// modal holds the draft, and each save is one POST/PUT that echoes the full
// roster back, so the table refreshes without a second round-trip.

export function useRoster() {
  const [data, setData] = useState<RosterResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch('/api/roster', { cache: 'no-store' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'שגיאה');
      setData(body as RosterResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'שגיאה בטעינת מצבת החיילים');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  /** Create (id null/absent) or replace one soldier. true = saved. */
  const saveSoldier = useCallback(async (input: RosterInput): Promise<boolean> => {
    setSaving(true); setError(null);
    try {
      const res = await fetch('/api/roster', {
        method: input.id == null ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'שגיאה');
      setData(body as RosterResponse);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'שגיאה בשמירת החייל');
      return false;
    } finally {
      setSaving(false);
    }
  }, []);

  return { data, loading, saving, error, setError, reload: load, saveSoldier };
}
