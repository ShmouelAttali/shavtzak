import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getPool } from './_db.js';

// GET /api/admins?email=x -> { isShavtzakAdmin, isHamalMember }
// Point lookup against shavtzak_admins (scheduler tabs) and hamal_members (the
// חמל tab) — grants tab visibility without requiring a command role in the
// sheet. The two lists are distinct: a חמל member is NOT a scheduler admin.
export interface AdminResponse { isShavtzakAdmin: boolean; isHamalMember: boolean }

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET') return res.status(405).json({ error: 'method not allowed' });
  const email = String(req.query.email ?? '').trim().toLowerCase();
  if (!email) return res.status(400).json({ error: 'email required' });
  try {
    const [admin, hamal] = await Promise.all([
      getPool().query(`select 1 from shavtzak_admins where email = $1`, [email]),
      getPool().query(`select 1 from hamal_members where email = $1`, [email]),
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
