import { useEffect, useState } from 'react';
import type { AdminResponse } from '../../api/admins';

/** True when the email appears in the scheduler DB's shavtzak_admins table. */
export function useIsShavtzakAdmin(email: string): boolean {
  const [isShavtzakAdmin, setIsShavtzakAdmin] = useState(false);

  useEffect(() => {
    if (!email) { setIsShavtzakAdmin(false); return; }
    let cancelled = false;
    fetch(`/api/admins?email=${encodeURIComponent(email)}`)
      .then((r) => (r.ok ? r.json() : { isShavtzakAdmin: false }))
      .then((b: AdminResponse) => { if (!cancelled) setIsShavtzakAdmin(!!b.isShavtzakAdmin); })
      .catch(() => { if (!cancelled) setIsShavtzakAdmin(false); });
    return () => { cancelled = true; };
  }, [email]);

  return isShavtzakAdmin;
}
