import { useCallback, useEffect, useState } from 'react';
import type { ExitRequest, ExitRequestsResponse } from '../../api/exit-requests';

// ── date helpers (YYYY-MM-DD, local) ────────────────────────────────────────
function todayIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function addDaysIso(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  const pad = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Half-day exit requests of the current soldier for the next ~30 days. */
export function useExitRequests(name: string, email: string) {
  const [requests, setRequests] = useState<ExitRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!name) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const from = todayIso();
      const to = addDaysIso(from, 30);
      const res = await fetch(
        `/api/exit-requests?from=${from}&to=${to}&name=${encodeURIComponent(name)}`,
        { cache: 'no-store' },
      );
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'שגיאה');
      setRequests((body as ExitRequestsResponse).requests);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'שגיאה בטעינת בקשות היציאה');
    } finally {
      setLoading(false);
    }
  }, [name]);

  useEffect(() => { void load(); }, [load]);

  /** POST a new request. Returns the server's Hebrew error text, or null on success. */
  const add = useCallback(async (
    day: string, from: string, to: string, note: string,
  ): Promise<string | null> => {
    try {
      const res = await fetch('/api/exit-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, day, from, to, email, note: note.trim() || undefined }),
      });
      const body = await res.json();
      if (!res.ok) return (body.error as string) ?? 'שגיאה בשליחת הבקשה';
    } catch (e) {
      return e instanceof Error ? e.message : 'שגיאה בשליחת הבקשה';
    }
    await load();
    return null;
  }, [name, email, load]);

  /** DELETE a request. Returns the server's Hebrew error text, or null on success. */
  const remove = useCallback(async (id: number): Promise<string | null> => {
    try {
      const res = await fetch(
        `/api/exit-requests?id=${id}&name=${encodeURIComponent(name)}`,
        { method: 'DELETE' },
      );
      const body = await res.json();
      if (!res.ok) return (body.error as string) ?? 'שגיאה בביטול הבקשה';
    } catch (e) {
      return e instanceof Error ? e.message : 'שגיאה בביטול הבקשה';
    }
    await load();
    return null;
  }, [name, load]);

  return { requests, loading, error, add, remove, reload: load };
}
