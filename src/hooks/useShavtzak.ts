import { useEffect, useState } from 'react';
import type { ShavtzakData } from '../../api/shavtzak';

export function useShavtzak() {
  const [data, setData] = useState<ShavtzakData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/shavtzak')
      .then(r => {
        if (!r.ok) return r.json().then((e: { error?: string }) => Promise.reject(e.error || 'שגיאה'));
        return r.json() as Promise<ShavtzakData>;
      })
      .then(d => { setData(d); setLoading(false); })
      .catch((e: unknown) => {
        setError(typeof e === 'string' ? e : 'שגיאה בטעינת שבצק');
        setLoading(false);
      });
  }, []);

  return { data, loading, error };
}
