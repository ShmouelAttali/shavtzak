import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getPool } from './_db.js';

// GET /api/admins?email=x -> { isShavtzakAdmin, isHamalMember }
// isShavtzakAdmin: point lookup against shavtzak_admins (grants the scheduler tabs).
// isHamalMember: the email belongs to a soldier whose role is a חמל staff role —
// derived from the חמל position's config.staff_all_roles (no separate members
// table, no hardcoded role literal). A חמל member is NOT a scheduler admin: this
// only unlocks the חמל tab. Requires soldiers.email to be populated (from the
// roster sheet) and the soldiers(lower(email)) index for the lookup.
export interface AdminResponse { isShavtzakAdmin: boolean; isHamalMember: boolean }

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET') return res.status(405).json({ error: 'method not allowed' });
  const email = String(req.query.email ?? '').trim().toLowerCase();
  if (!email) return res.status(400).json({ error: 'email required' });
  try {
    const [admin, hamal] = await Promise.all([
      getPool().query(`select 1 from shavtzak_admins where email = $1`, [email]),
      getPool().query(
        `select 1 from soldiers s
         join positions p on (p.config -> 'staff_all_roles') ? s.role
         where lower(s.email) = $1 limit 1`, [email]),
    ]);
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    const out: AdminResponse = {
      isShavtzakAdmin: (admin.rowCount ?? 0) > 0,
      isHamalMember: (hamal.rowCount ?? 0) > 0,
    };
    return res.status(200).json(out);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e instanceof Error ? e.message : 'server error' });
  }
}
