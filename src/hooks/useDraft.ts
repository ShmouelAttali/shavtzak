import { useCallback, useEffect, useRef, useState } from 'react';
import type { DraftResponse, GenerateResponse } from '../../api/_handlers/draft';

/** URL of the stored generation report for a day (or a range). */
export function reportUrl(from: string, to?: string): string {
  return to && to !== from
    ? `/api/report?from=${from}&to=${to}`
    : `/api/report?day=${from}`;
}

/** A seat locked by an in-flight edit: day + the grid's `${name}|${time}` key. */
export const seatKey = (day: string, nameTime: string) => `${day}|${nameTime}`;

/** The `${name}|${time}` seats of ONE day, out of the flat pending-seat set. */
export function seatsForDay(pending: Set<string>, day: string): Set<string> {
  const prefix = `${day}|`;
  const out = new Set<string>();
  for (const k of pending) if (k.startsWith(prefix)) out.add(k.slice(prefix.length));
  return out;
}

/** Draft schedule days from the scheduler DB + generation / publish triggers. */
export function useDraft(from: string, to: string) {
  const [data, setData] = useState<DraftResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState<string | null>(null); // day in progress
  const [busyDay, setBusyDay] = useState<string | null>(null);        // publish/unpublish in progress
  // Seat-level busy set (replacements): several may be in flight at once, so a
  // single "busy" flag would block the officer's next edit — see seatKey().
  const [pendingSeats, setPendingSeats] = useState<Set<string>>(new Set());
  const loadSeq = useRef(0);

  const load = useCallback(async () => {
    if (!from || !to) return;
    const seq = ++loadSeq.current;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/draft?from=${from}&to=${to}`, { cache: 'no-store' });
      const body = await res.json();
      if (seq !== loadSeq.current) return;   // a newer load is in flight — its answer wins
      if (!res.ok) throw new Error(body.error ?? 'שגיאה');
      setData(body as DraftResponse);
    } catch (e) {
      if (seq === loadSeq.current) setError(e instanceof Error ? e.message : 'שגיאה בטעינת טיוטה');
    } finally {
      if (seq === loadSeq.current) setLoading(false);
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
   *  another. Resolves to an error message on failure, null on success.
   *  `force` = the officer approved vacating the incoming soldier's
   *  overlapping seats (see src/lib/draftConflicts.ts).
   *  `seats` (`${name}|${time}` keys) are locked for the round trip — the ONLY
   *  thing this blocks, so other seats stay editable meanwhile. */
  const replaceSoldier = useCallback(async (req: {
    day: string; time: string; fromSoldierId: number; toSoldierId: number;
    force?: boolean; seats?: string[];
  }): Promise<string | null> => {
    const { day, time, fromSoldierId, toSoldierId, force = false, seats = [] } = req;
    const keys = seats.map((s) => seatKey(day, s));
    setPendingSeats((prev) => new Set([...prev, ...keys]));
    try {
      const res = await fetch('/api/draft', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ day, time, fromSoldierId, toSoldierId, force }),
      });
      const body = await res.json();
      if (!res.ok) return body.error ?? 'שגיאה בהחלפה';
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : 'שגיאה בהחלפה';
    } finally {
      await load();                       // refreshed rows land before the lock lifts
      setPendingSeats((prev) => {
        const next = new Set(prev);
        for (const k of keys) next.delete(k);
        return next;
      });
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

  return { data, loading, error, generating, busyDay, pendingSeats, reload: load, generateRange, publish, unpublish, deleteDraft, replaceSoldier };
}
