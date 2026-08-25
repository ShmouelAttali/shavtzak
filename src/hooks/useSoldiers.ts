import { useEffect, useState } from 'react';
import type { SheetData } from '../types';

export function useSoldiers() {
  const [data, setData] = useState<SheetData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rev, setRev] = useState(0);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch('/api/soldiers', { cache: 'no-store' })
      .then((r) => {
        if (!r.ok) return r.json().then((e) => Promise.reject(e.error || 'שגיאה בטעינת נתונים'));
        return r.json() as Promise<SheetData>;
      })
      .then((d) => {
        setData(d);
        setLoading(false);
      })
      .catch((e: unknown) => {
        setError(typeof e === 'string' ? e : 'שגיאה בטעינת נתונים');
        setLoading(false);
      });
  }, [rev]);

  const reload = () => setRev(v => v + 1);

  return { data, loading, error, reload };
}
