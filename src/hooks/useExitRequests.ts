import { useCallback, useEffect, useState } from 'react';
import type { ExitRequest, ExitRequestsResponse } from '../../api/_handlers/exit-requests';

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
    fromDate: string, from: string, toDate: string, to: string, note: string,
  ): Promise<string | null> => {
    try {
      const res = await fetch('/api/exit-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, fromDate, from, toDate, to, email, note: note.trim() || undefined }),
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

// ── Admin hook ───────────────────────────────────────────────────────────────

/** Result of an admin mutation: server Hebrew `error` on failure, otherwise
 *  success with an optional Hebrew `warning` (e.g. the day is already generated). */
export interface AdminMutationResult { error?: string; warning?: string }

/** All soldiers' exit requests in a schedule-day range, with admin CRUD. */
export function useAdminExitRequests(from: string, to: string) {
  const [requests, setRequests] = useState<ExitRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/exit-requests?from=${from}&to=${to}`, { cache: 'no-store' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'שגיאה');
      setRequests((body as ExitRequestsResponse).requests);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'שגיאה בטעינת בקשות היציאה');
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => { void load(); }, [load]);

  /** POST (no id) or PATCH (with id) a request with free-form
   *  'YYYY-MM-DD HH:MM' timestamps. */
  const save = useCallback(async (payload: {
    id?: number; name: string; start: string; end: string; note?: string; email?: string;
  }): Promise<AdminMutationResult> => {
    const isEdit = payload.id != null;
    try {
      const res = await fetch('/api/exit-requests', {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isEdit
          ? { id: payload.id, start: payload.start, end: payload.end, note: payload.note }
          : { admin: true, name: payload.name, start: payload.start, end: payload.end, note: payload.note, email: payload.email }),
      });
      const body = await res.json();
      if (!res.ok) return { error: (body.error as string) ?? 'שגיאה בשמירת הבקשה' };
      await load();
      return { warning: body.warning as string | undefined };
    } catch (e) {
      return { error: e instanceof Error ? e.message : 'שגיאה בשמירת הבקשה' };
    }
  }, [load]);

  /** DELETE with force=1 (admin override — deletes even when the day is generated). */
  const removeForce = useCallback(async (id: number): Promise<AdminMutationResult> => {
    try {
      const res = await fetch(`/api/exit-requests?id=${id}&force=1`, { method: 'DELETE' });
      const body = await res.json();
      if (!res.ok) return { error: (body.error as string) ?? 'שגיאה במחיקת הבקשה' };
      await load();
      return { warning: body.warning as string | undefined };
    } catch (e) {
      return { error: e instanceof Error ? e.message : 'שגיאה במחיקת הבקשה' };
    }
  }, [load]);

  return { requests, loading, error, save, removeForce, reload: load };
}
