import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getPool } from './_db.js';

// GET /api/admins?email=x -> { isShavtzakAdmin: boolean }
// Point lookup against shavtzak_admins (scheduler DB) — grants visibility of
// the scheduler tabs without requiring a command role in the sheet.
export interface AdminResponse { isShavtzakAdmin: boolean }

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET') return res.status(405).json({ error: 'method not allowed' });
  const email = String(req.query.email ?? '').trim().toLowerCase();
  if (!email) return res.status(400).json({ error: 'email required' });
  try {
    const { rowCount } = await getPool().query(
      `select 1 from shavtzak_admins where email = $1`, [email]);
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    const out: AdminResponse = { isShavtzakAdmin: (rowCount ?? 0) > 0 };
    return res.status(200).json(out);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e instanceof Error ? e.message : 'server error' });
  }
}
