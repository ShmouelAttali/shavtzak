import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getPool } from '../_db.js';

// GET /api/admins?email=x -> { isShavtzakAdmin, isHamalMember }
// isShavtzakAdmin: point lookup against shavtzak_admins (grants the scheduler tabs).
// isHamalMember: the email belongs to a soldier whose role is a חמל staff role —
// derived from the חמל position's config.staff_all_roles (no separate members
// table, no hardcoded role literal). A חמל member is NOT a scheduler admin: this
// only unlocks the חמל tab. Requires soldiers.email to be populated (from the
// roster sheet) and the soldiers(lower(email)) index for the lookup.
// The join must be pinned to THE חמל position — resolved by the same
// `staff_all_roles ? 'חמל'` marker api/hamal.ts uses — because מפלג declares
// staff_all_roles too, so an unscoped join handed the חמל tab to רס"פ/סרס"פ/מנהלה.
export interface AdminResponse { isShavtzakAdmin: boolean; isHamalMember: boolean }

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET') return res.status(405).json({ error: 'method not allowed' });
  const email = String(req.query.email ?? '').trim().toLowerCase();
  if (!email) return res.status(400).json({ error: 'email required' });
  try {
    // Both checks in ONE round trip — two exists() subqueries over the same
    // lowercased email. lower() on BOTH sides: api/roster.ts writes
    // shavtzak_admins lowercased, but a hand-inserted row need not be. That
    // forfeits the email PK index — irrelevant on a table of a few admins, and
    // the soldiers side already had to use the soldiers(lower(email)) index.
    const { rows } = await getPool().query(
      `select
         exists (select 1 from shavtzak_admins a where lower(a.email) = $1) as is_admin,
         exists (select 1 from soldiers s
                 join positions p on (p.config -> 'staff_all_roles') ? s.role
                                 and (p.config -> 'staff_all_roles') ? 'חמל'
                 where lower(s.email) = $1 and s.archived_at is null) as is_hamal`,
      [email]);
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    const out: AdminResponse = {
      isShavtzakAdmin: rows[0].is_admin === true,
      isHamalMember: rows[0].is_hamal === true,
    };
    return res.status(200).json(out);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e instanceof Error ? e.message : 'server error' });
  }
}
