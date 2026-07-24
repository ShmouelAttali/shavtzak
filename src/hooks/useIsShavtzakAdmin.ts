import { useEffect, useState } from 'react';
import type { AdminResponse } from '../../api/admins';

/** Scheduler access for an email (one /api/admins lookup). isShavtzakAdmin
 *  (shavtzak_admins table) gates the scheduler tabs; isHamalMember (a soldier
 *  with a חמל role, matched by soldiers.email) gates the חמל tab, shown to
 *  admins OR חמל members. */
export function useShavtzakAccess(email: string): AdminResponse {
  const [access, setAccess] = useState<AdminResponse>({ isShavtzakAdmin: false, isHamalMember: false });

  useEffect(() => {
    if (!email) { setAccess({ isShavtzakAdmin: false, isHamalMember: false }); return; }
    let cancelled = false;
    fetch(`/api/admins?email=${encodeURIComponent(email)}`)
      .then((r) => (r.ok ? r.json() : { isShavtzakAdmin: false, isHamalMember: false }))
      .then((b: AdminResponse) => {
        if (!cancelled) setAccess({ isShavtzakAdmin: !!b.isShavtzakAdmin, isHamalMember: !!b.isHamalMember });
      })
      .catch(() => { if (!cancelled) setAccess({ isShavtzakAdmin: false, isHamalMember: false }); });
    return () => { cancelled = true; };
  }, [email]);

  return access;
}

/** True when the email appears in the scheduler DB's shavtzak_admins table. */
export function useIsShavtzakAdmin(email: string): boolean {
  return useShavtzakAccess(email).isShavtzakAdmin;
}
