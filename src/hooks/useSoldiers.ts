import { useEffect, useState } from 'react';
import type { SheetData } from '../types';

export function useSoldiers() {
  const [data, setData] = useState<SheetData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/soldiers')
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
  }, []);

  return { data, loading, error };
}
