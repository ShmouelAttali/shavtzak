import { useCallback, useEffect, useState } from 'react';

export interface ShortExit {
  rowIndex: number;
  name: string;
  exitTime: string;
  returnTime: string;
}

export function useExits() {
  const [exits, setExits] = useState<ShortExit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch('/api/exits', { cache: 'no-store' })
      .then(r => {
        if (!r.ok) return r.json().then((e: { error?: string }) => Promise.reject(e.error ?? 'שגיאה'));
        return r.json() as Promise<ShortExit[]>;
      })
      .then(data => { setExits(data); setLoading(false); })
      .catch((e: unknown) => {
        setError(typeof e === 'string' ? e : 'שגיאה בטעינת יציאות');
        setLoading(false);
      });
  }, []);

  useEffect(() => { load(); }, [load]);

  const addExit = useCallback(async (name: string, exitTime: string, returnTime: string) => {
    setSaving(true);
    try {
      const r = await fetch('/api/exits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, exitTime, returnTime }),
      });
      if (!r.ok) throw new Error(await r.text());
    } finally {
      setSaving(false);
      load();
    }
  }, [load]);

  const removeExit = useCallback(async (rowIndex: number) => {
    setSaving(true);
    try {
      const r = await fetch(`/api/exits?row=${rowIndex}`, { method: 'DELETE' });
      if (!r.ok) throw new Error(await r.text());
    } finally {
      setSaving(false);
      load();
    }
  }, [load]);

  return { exits, loading, error, saving, reload: load, addExit, removeExit };
}
